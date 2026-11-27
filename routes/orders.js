import { Router } from 'express';
import { validateOrder } from '../middleware/validateOrder.js';
import { idParam, validate } from '../middleware/validate.js';
import { checkoutSchema } from '../validation/schemas.js';

async function transaction(pool, run) {
  const client = await pool.connect();
  let releaseError;
  try {
    await client.query('BEGIN');
    const result = await run(client);
    await client.query(result.status < 400 ? 'COMMIT' : 'ROLLBACK');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch((err) => { releaseError = err; });
    throw error;
  } finally {
    client.release(releaseError);
  }
}

async function createCheckout(client, buyerId, { items, address }) {
  const wanted = new Map();
  for (const { productId, quantity } of items) {
    wanted.set(productId, (wanted.get(productId) ?? 0) + quantity);
  }
  const { rows: products } = await client.query(
    'SELECT id, name, price, stock FROM products WHERE id = ANY($1::int[]) ORDER BY id FOR UPDATE',
    [[...wanted.keys()]],
  );
  if (products.length !== wanted.size) {
    return { status: 404, body: { error: 'Товар не найден' } };
  }
  const details = products.filter((p) => p.stock < wanted.get(p.id))
    .map((p) => ({ productId: p.id, name: p.name, available: p.stock }));
  if (details.length) return { status: 409, body: { error: 'Недостаточно товара', details } };

  const positions = products.map((p) => ({
    productId: p.id, name: p.name, quantity: wanted.get(p.id), price: p.price,
  }));
  const total = positions.reduce((sum, item) => sum + item.price * item.quantity, 0);
  if (!total) return { status: 409, body: { error: 'Сумма заказа должна быть больше нуля' } };

  const { rows: [order] } = await client.query(
    `INSERT INTO checkout_orders (buyer_id, total, address) VALUES ($1, $2, $3)
     RETURNING id, status, address, created_at`, [buyerId, total, address],
  );
  for (const { productId, quantity, price } of positions) {
    await client.query(
      'INSERT INTO order_items (order_id, product_id, quantity, price) VALUES ($1, $2, $3, $4)',
      [order.id, productId, quantity, price],
    );
    await client.query('UPDATE products SET stock = stock - $1 WHERE id = $2', [quantity, productId]);
  }
  return { status: 201, body: { ...order, total, items: positions } };
}

async function cancelCheckout(client, buyerId, id) {
  const { rows: [order] } = await client.query(
    'SELECT id, status FROM checkout_orders WHERE id = $1 AND buyer_id = $2 FOR UPDATE', [id, buyerId],
  );
  if (!order) return { status: 404, body: { error: 'Заказ не найден' } };
  if (order.status !== 'new') return { status: 409, body: { error: 'Заказ уже нельзя отменить' } };

  // Use the same locking order as checkout when several products overlap.
  await client.query(
    `SELECT p.id FROM products p JOIN order_items i ON i.product_id = p.id
     WHERE i.order_id = $1 ORDER BY p.id FOR UPDATE OF p`, [id],
  );
  await client.query(
    `UPDATE products p SET stock = p.stock + i.quantity FROM order_items i
     WHERE i.order_id = $1 AND p.id = i.product_id`, [id],
  );
  await client.query("UPDATE checkout_orders SET status = 'cancelled' WHERE id = $1", [id]);
  return { status: 200, body: { id: order.id, status: 'cancelled' } };
}

export function createOrdersRouter(pool, auth) {
  const router = Router();
  const adminOnly = [auth.requireAuth, auth.requireRole('admin')];
  router.get('/my', auth.requireAuth, async (req, res) => {
    const type = req.query.type;
    if (type !== undefined && type !== 'checkout' && type !== 'wholesale') {
      return res.status(400).json({ error: 'Неизвестный тип заказа' });
    }
    const [checkout, wholesale] = await Promise.all([
      type === 'wholesale' ? [] : pool.query(
        `SELECT o.id, o.status, o.total::float8 AS total, o.address, o.created_at,
                json_agg(json_build_object('productId', i.product_id, 'name', p.name,
                  'quantity', i.quantity, 'price', i.price) ORDER BY p.name, p.id) AS items
           FROM checkout_orders o
           JOIN order_items i ON i.order_id = o.id
           JOIN products p ON p.id = i.product_id
          WHERE o.buyer_id = $1 GROUP BY o.id ORDER BY o.created_at DESC, o.id DESC`, [req.user.id],
      ).then(({ rows }) => rows),
      type === 'checkout' ? [] : pool.query(
        `SELECT o.*, p.name AS product_name FROM orders o LEFT JOIN products p ON p.id = o.product_id
         WHERE o.user_id = $1 ORDER BY o.created_at DESC, o.id DESC`, [req.user.id],
      ).then(({ rows }) => rows),
    ]);
    res.json([...checkout, ...wholesale].sort((a, b) => b.created_at - a.created_at || b.id - a.id));
  });

  router.get('/incoming', auth.requireAuth, auth.requireRole('farmer'), async (req, res) => {
    const { rows } = await pool.query(
      `SELECT o.id AS "orderId", o.status, o.created_at, o.address, u.name AS "buyerName",
              p.id AS "productId", p.name AS product, i.quantity, i.price
         FROM order_items i
         JOIN products p ON p.id = i.product_id
         JOIN checkout_orders o ON o.id = i.order_id
         JOIN users u ON u.id = o.buyer_id
        WHERE p.farmer_id = $1 ORDER BY o.created_at DESC, o.id DESC, p.id`, [req.user.id],
    );
    res.json(rows);
  });

  router.post('/:id/cancel', idParam, auth.requireAuth, async (req, res) => {
    const { status, body } = await transaction(pool, (client) =>
      cancelCheckout(client, req.user.id, req.params.id));
    res.status(status).json(body);
  });

  router.get('/', adminOnly, async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && (typeof status !== 'string' || !['new', 'processing', 'done', 'cancelled'].includes(status))) {
      return res.status(400).json({ error: 'Неизвестный статус заявки' });
    }
    const { rows } = await pool.query(`SELECT o.*, p.name AS product_name
      FROM orders o LEFT JOIN products p ON p.id=o.product_id
      WHERE ($1::text IS NULL OR o.status=$1) ORDER BY o.created_at DESC, o.id DESC`, [status ?? null]);
    res.json(rows);
  });
  router.post('/', (req, res, next) => {
    if (Object.hasOwn(req.body ?? {}, 'items') || Object.hasOwn(req.body ?? {}, 'address')) return next();
    next('route');
  }, auth.requireAuth, validate(checkoutSchema), async (req, res) => {
    const { status, body } = await transaction(pool, (client) =>
      createCheckout(client, req.user.id, req.body));
    res.status(status).json(body);
  });

  router.post('/', auth.optionalAuth, validateOrder, async (req, res) => {
    const { product_id, name, email, phone, quantity, date, comment } = res.locals.order;
    const { rows } = await pool.query(`INSERT INTO orders (product_id, name, email, phone, quantity, delivery_date, comment, user_id)
      VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`, [product_id, name, email, phone, quantity, date, comment, req.user?.id ?? null]);
    res.status(201).json(rows[0]);
  });
  router.patch('/:id', idParam, adminOnly, async (req, res) => {
    const { status } = req.body || {};
    if (status === undefined || status === null || status === '') {
      return res.status(400).json({ error: 'Поле status обязательно' });
    }
    if (typeof status !== 'string') return res.status(400).json({ error: 'Поле status должно быть строкой' });
    // Список допустимых значений проверяет CHECK в PostgreSQL.
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json(rows[0]);
  });
  return router;
}
