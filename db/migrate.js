import 'dotenv/config';
import { pool } from './pool.js';
import { seedAdmin } from './admin.js';

const client = await pool.connect();
try {
  await client.query('BEGIN');
  await client.query(`CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY, name TEXT NOT NULL, email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user','admin')),
    token_version INTEGER NOT NULL DEFAULT 0, created_at TIMESTAMPTZ NOT NULL DEFAULT now()
  )`);
  await client.query('ALTER TABLE users ADD COLUMN IF NOT EXISTS token_version INTEGER NOT NULL DEFAULT 0');
  await client.query('ALTER TABLE orders ADD COLUMN IF NOT EXISTS user_id INTEGER REFERENCES users(id) ON DELETE SET NULL');
  await seedAdmin(client);
  await client.query('COMMIT');
  console.log('Миграция ЛР7 выполнена: users, orders.user_id и администратор. Прежние данные сохранены.');
} catch (err) {
  await client.query('ROLLBACK');
  console.error(err.message); process.exitCode = 1;
} finally {client.release(); await pool.end();}
