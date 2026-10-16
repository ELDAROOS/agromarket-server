import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { pool } from './pool.js';
import { seedAdmin } from './admin.js';

let client;
try {
  client = await pool.connect();
  const { rows } = await client.query("SELECT to_regclass('products') AS products, to_regclass('orders') AS orders");
  if ((rows[0].products || rows[0].orders) && !process.argv.includes('--reset') && process.env.NODE_ENV !== 'test') {
    throw new Error('Таблицы уже существуют. Для намеренного удаления всех товаров и заявок: npm run db:init -- --reset');
  }
  const schema = readFileSync(new URL('./schema.sql', import.meta.url), 'utf8');
  const { products } = JSON.parse(readFileSync(new URL('../data/db.json', import.meta.url), 'utf8'));
  await client.query('BEGIN');
  await client.query(schema);
  for (const p of products) {
    await client.query(`INSERT INTO products (name, category, price, unit, image)
      VALUES ($1, $2, $3, $4, $5)`,
    [p.name, p.category ?? null, Math.round(Number(p.price)), p.unit ?? 'кг', p.image ?? null]);
  }
  await seedAdmin(client);
  await client.query('COMMIT');
  console.log(`Готово: таблицы созданы, товаров добавлено — ${products.length}, администратор создан`);
} catch (err) {
  if (client) await client.query('ROLLBACK');
  console.error(err.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
