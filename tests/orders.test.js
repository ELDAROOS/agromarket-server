import { setTimeout as pause } from 'node:timers/promises';
import request from 'supertest';
import { beforeEach, expect, test } from 'vitest';
import app from '../app.js';
import { createToken, getAuthConfig } from '../authConfig.js';
import { pool } from '../db/pool.js';
import { uniqueEmail } from './helpers.js';

const address = 'Астана, ул. Женис, 62';
const config = getAuthConfig();
let buyer, otherBuyer, farmer, otherFarmer, honey, potato;

async function account(role) {
  const { rows: [user] } = await pool.query(
    'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4) RETURNING *',
    [role, uniqueEmail(role), 'unused-in-token-test', role],
  );
  return { ...user, token: createToken(user, config) };
}

async function product(name, owner, price, stock) {
  const { rows: [item] } = await pool.query(
    'INSERT INTO products (name, farmer_id, price, stock) VALUES ($1, $2, $3, $4) RETURNING *',
    [name, owner.id, price, stock],
  );
  return item;
}

function checkout(user, items) {
  const res = request(app).post('/api/orders');
  if (user) res.set('Authorization', `Bearer ${user.token}`);
  return res.send({ items, address });
}

function order(user, item = honey, quantity = 1) {
  return checkout(user, [{ productId: item.id, quantity }]);
}

function cancel(user, id) {
  return request(app).post(`/api/orders/${id}/cancel`).set('Authorization', `Bearer ${user.token}`);
}

function get(user, path) {
  return request(app).get(path).set('Authorization', `Bearer ${user.token}`);
}

async function stockOf(item) {
  const { rows: [row] } = await pool.query('SELECT stock FROM products WHERE id = $1', [item.id]);
  return row.stock;
}

async function counts() {
  const { rows: [row] } = await pool.query(
    `SELECT (SELECT count(*)::int FROM checkout_orders) AS orders,
            (SELECT count(*)::int FROM order_items) AS items`,
  );
  return row;
}

beforeEach(async () => {
  [buyer, otherBuyer, farmer, otherFarmer] = await Promise.all([
    account('user'), account('user'), account('farmer'), account('farmer'),
  ]);
  [honey, potato] = await Promise.all([
    product('Мёд', farmer, 3500, 6), product('Картофель', otherFarmer, 250, 1),
  ]);
});

test('создаёт заказ, считает сумму и уменьшает остатки всех позиций', async () => {
  const res = await checkout(buyer, [{ productId: honey.id, quantity: 2 }, { productId: potato.id, quantity: 1 }]);
  expect(res.status).toBe(201);
  expect(res.body).toMatchObject({ total: 7250, address, status: 'new' });
  expect(await stockOf(honey)).toBe(4);
  expect(await stockOf(potato)).toBe(0);
  expect(res.body.items).toHaveLength(2);
});

test('берёт цену из базы и сохраняет её после изменения цены товара', async () => {
  const res = await checkout(buyer, [{ productId: honey.id, quantity: 2, price: 1 }]);
  expect(res.status).toBe(201);
  expect(res.body.total).toBe(7000);
  await pool.query('UPDATE products SET price = 4000 WHERE id = $1', [honey.id]);
  const mine = await get(buyer, '/api/orders/my');
  expect(mine.body[0]).toMatchObject({ total: 7000, items: [{ price: 3500 }] });
});

test('складывает повторяющиеся позиции и проверяет предел суммы количеств', async () => {
  const res = await checkout(buyer, [{ productId: honey.id, quantity: 2 }, { productId: honey.id, quantity: 1 }]);
  expect(res.status).toBe(201);
  expect(res.body.items).toEqual([{ productId: honey.id, name: honey.name, price: 3500, quantity: 3 }]);
  expect(await stockOf(honey)).toBe(3);
  const invalid = await checkout(buyer, [{ productId: honey.id, quantity: 80 }, { productId: honey.id, quantity: 21 }]);
  expect(invalid.status).toBe(400);
});

test('при нехватке отвечает 409 с остатком и сохраняет состояние базы', async () => {
  const before = await counts();
  const res = await checkout(buyer, [{ productId: honey.id, quantity: 2 }, { productId: potato.id, quantity: 2 }]);
  expect(res.status).toBe(409);
  expect(res.body.details).toEqual([{ productId: potato.id, name: potato.name, available: 1 }]);
  expect(await counts()).toEqual(before);
  expect(await stockOf(honey)).toBe(6);
  expect(await stockOf(potato)).toBe(1);
});

test('откатывает заказ, позиции и уже списанный остаток при ошибке записи', async () => {
  const before = await counts();
  const fixtures = [honey, potato].sort((a, b) => a.id - b.id);
  await pool.query(`
    CREATE FUNCTION test_fail_order_item() RETURNS trigger LANGUAGE plpgsql AS $body$
    BEGIN
      RAISE EXCEPTION 'Ошибка записи позиции для проверки отката' USING ERRCODE = '23514';
    END;
    $body$;
    CREATE TRIGGER test_fail_order_item BEFORE INSERT ON order_items
      FOR EACH ROW WHEN (NEW.product_id = ${fixtures[1].id}) EXECUTE FUNCTION test_fail_order_item();
  `);
  try {
    const res = await checkout(buyer, fixtures.map(({ id }) => ({ productId: id, quantity: 1 })));
    expect(res.status).toBe(400);
    expect(res.body.detail).toContain('Ошибка записи позиции');
    expect(await counts()).toEqual(before);
    expect(await stockOf(honey)).toBe(6);
    expect(await stockOf(potato)).toBe(1);
  } finally {
    await pool.query('DROP TRIGGER test_fail_order_item ON order_items; DROP FUNCTION test_fail_order_item()');
  }
});

test('пустая корзина и количество 0 возвращают 400 с деталями', async () => {
  const empty = await checkout(buyer, []);
  expect(empty.status).toBe(400);
  expect(empty.body.details).toContainEqual({ field: 'items', message: 'Корзина пуста' });
  const zero = await order(buyer, honey, 0);
  expect(zero.status).toBe(400);
  expect(zero.body.details[0].field).toBe('items.0.quantity');
});

test('несуществующий товар возвращает 404', async () => {
  expect((await order(buyer, { id: 2_147_483_647 })).status).toBe(404);
});

test('оформление без токена возвращает 401', async () => {
  expect((await order(null)).status).toBe(401);
});

test('гонка: последнюю единицу получает только один покупатель', async () => {
  const before = await counts();
  const blocker = await pool.connect();
  let pending;
  try {
    await blocker.query('BEGIN');
    // The weaker lock lets the FK check pass even in the experiment without FOR UPDATE.
    await blocker.query('SELECT id FROM products WHERE id = $1 FOR NO KEY UPDATE', [potato.id]);
    pending = Promise.all([order(buyer, potato), order(otherBuyer, potato)]);
    // Wait for both requests to block on their stock operation before releasing the row.
    const deadline = Date.now() + 4000;
    let waiting;
    do {
      const { rows: [row] } = await pool.query(
        `SELECT count(*)::int AS waiting FROM pg_stat_activity
         WHERE datname = current_database() AND wait_event_type = 'Lock'
           AND (query LIKE 'SELECT id, name, price, stock FROM products%'
             OR query LIKE 'UPDATE products SET stock = stock -%')`,
      );
      waiting = row.waiting;
      if (waiting < 2) await pause(15);
    } while (waiting < 2 && Date.now() < deadline);
    expect(waiting).toBe(2);
    await blocker.query('COMMIT');
  } finally {
    await blocker.query('ROLLBACK');
    blocker.release();
    await pending;
  }
  const results = (await pending).sort((a, b) => a.status - b.status);
  expect(results.map(({ status, body }) => ({
    status, constraint: body.detail?.includes('products_stock_check') ?? false,
  }))).toEqual([{ status: 201, constraint: false }, { status: 409, constraint: false }]);
  expect(results[1].body.details[0]).toMatchObject({ productId: potato.id, available: 0 });
  expect(await stockOf(potato)).toBe(0);
  expect(await counts()).toEqual({ orders: before.orders + 1, items: before.items + 1 });
}, 10_000);

test('покупатель видит только свои заказы', async () => {
  const first = await order(buyer);
  await order(otherBuyer, potato);
  const res = await get(buyer, '/api/orders/my');
  expect(res.status).toBe(200);
  expect(res.body.map(({ id }) => id)).toEqual([first.body.id]);
});

test('фермер видит только позиции своих товаров, покупатель получает 403', async () => {
  const created = await checkout(buyer, [{ productId: honey.id, quantity: 1 }, { productId: potato.id, quantity: 1 }]);
  expect(created.status).toBe(201);
  const res = await get(farmer, '/api/orders/incoming');
  expect(res.status).toBe(200);
  expect(res.body).toEqual([expect.objectContaining({
    orderId: created.body.id, productId: honey.id, buyerName: buyer.name,
  })]);
  expect(res.body[0]).not.toHaveProperty('email');
  expect((await get(buyer, '/api/orders/incoming')).status).toBe(403);
});

test('отмена возвращает остатки всех позиций', async () => {
  const created = await checkout(buyer, [{ productId: honey.id, quantity: 2 }, { productId: potato.id, quantity: 1 }]);
  const res = await cancel(buyer, created.body.id);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ id: created.body.id, status: 'cancelled' });
  expect(await stockOf(honey)).toBe(6);
  expect(await stockOf(potato)).toBe(1);
});

test('чужой и отсутствующий заказы одинаково отвечают 404', async () => {
  const created = await order(buyer);
  const foreign = await cancel(otherBuyer, created.body.id);
  const absent = await cancel(otherBuyer, 2_147_483_647);
  expect(foreign.status).toBe(404);
  expect(absent.status).toBe(404);
  expect(foreign.body).toEqual(absent.body);
  expect(await stockOf(honey)).toBe(5);
});

test('две отмены возвращают остаток один раз, повторная получает 409', async () => {
  const created = await order(buyer, honey, 2);
  const results = await Promise.all([cancel(buyer, created.body.id), cancel(buyer, created.body.id)]);
  expect(results.map((res) => res.status).sort()).toEqual([200, 409]);
  expect(await stockOf(honey)).toBe(6);
});

test('фермер задаёт остаток своего товара, а чужой товар не изменяется', async () => {
  const headers = { Authorization: `Bearer ${farmer.token}` };
  const created = await request(app).post('/api/products').set(headers)
    .send({ name: 'Пшеница', price: 200, stock: 9, farmer_id: otherFarmer.id });
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject({ stock: 9, farmer_id: farmer.id });
  const own = await request(app).patch(`/api/products/${created.body.id}`).set(headers).send({ stock: 0 });
  expect(own.status).toBe(200);
  expect(own.body.stock).toBe(0);
  expect((await request(app).patch(`/api/products/${potato.id}`).set(headers).send({ stock: 3 })).status).toBe(404);
  expect(await stockOf(potato)).toBe(1);
  expect((await request(app).patch(`/api/products/${honey.id}`).set(headers).send({ stock: -1 })).status).toBe(400);
});
