import 'dotenv/config';
import pg from 'pg';
import { seedAdmin } from '../db/admin.js';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';

pg.types.setTypeParser(1082, value => value);
export async function testDatabase() {
  const admin = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const schema = `lab7_test_${randomBytes(8).toString('hex')}`;
  await admin.query(`CREATE SCHEMA ${schema}`);
  const database = new pg.Pool({ connectionString: process.env.DATABASE_URL, options: `-c search_path=${schema}` });
  async function cleanup() {
    await database.end();
    await admin.query(`DROP SCHEMA ${schema} CASCADE`);
    await admin.end();
  }
  try {
    await database.query(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
    const { products } = JSON.parse(readFileSync(new URL('../data/db.json', import.meta.url), 'utf8'));
    for (const p of products) await database.query('INSERT INTO products (name, price, image) VALUES ($1,$2,$3)', [p.name, p.price, p.image]);
    await seedAdmin(database);
    return { database, cleanup };
  } catch (err) { await cleanup(); throw err; }
}
