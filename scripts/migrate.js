import 'dotenv/config';
import { readFileSync } from 'node:fs';
import pg from 'pg';

const [file] = process.argv.slice(2);
const connectionString = process.env.DATABASE_URL;
if (!file || !connectionString) {
  console.error('Укажите файл SQL и DATABASE_URL.');
  process.exit(1);
}

const client = new pg.Client({ connectionString });
try {
  console.log('База:', new URL(connectionString).host);
  await client.connect();
  await client.query(readFileSync(file, 'utf8'));
  console.log('Применено:', file);
} catch (error) {
  console.error('Ошибка миграции:', error.message);
  process.exitCode = 1;
} finally {
  await client.end();
}
