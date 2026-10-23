import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { pool } from './pool.js';
import { seedAdmin } from './admin.js';

let client;
try {
  client = await pool.connect();
  await client.query('BEGIN');
  await client.query(readFileSync(new URL('./migrate.sql', import.meta.url), 'utf8'));
  if (process.env.ADMIN_EMAIL || process.env.ADMIN_PASSWORD) await seedAdmin(client);
  await client.query('COMMIT');
  console.log('Миграция выполнена: users, products, orders. Прежние данные сохранены.');
} catch (error) {
  if (client) await client.query('ROLLBACK');
  console.error('Миграция не удалась:', error.message);
  process.exitCode = 1;
} finally {
  client?.release();
  await pool.end();
}
