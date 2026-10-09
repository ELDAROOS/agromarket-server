// Необязательный локальный кластер для этой учебной копии (не системная служба).
import { existsSync, readFileSync, writeFileSync, appendFileSync, unlinkSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import pg from 'pg';
import dotenv from 'dotenv';

const root = fileURLToPath(new URL('../', import.meta.url));
const data = join(root, '.postgres');
const bin = process.env.PG_BIN || (existsSync('/opt/homebrew/opt/postgresql@16/bin') ? '/opt/homebrew/opt/postgresql@16/bin' : '');
const command = name => bin ? join(bin, name) : name;
const envPath = join(root, '.env');
const run = (name, args) => execFileSync(command(name), args, { stdio: 'inherit' });
const action = process.argv[2];
if (action === 'stop') {
  run('pg_ctl', ['-D', data, '-m', 'fast', '-w', 'stop']);
} else if (action === 'start') {
  if (!existsSync(join(data, 'PG_VERSION'))) {
    if (existsSync(envPath)) throw new Error('Для новой локальной БД нужен отсутствующий .env: существующие настройки автоматически не заменяются.');
    const password = randomBytes(24).toString('hex');
    const passwordFile = join(root, '.postgres-init-password');
    writeFileSync(passwordFile, password, { mode: 0o600, flag: 'wx' });
    try {
      run('initdb', ['-D', data, '-U', 'postgres', '--encoding=UTF8', '--locale=en_US.UTF-8', '--auth=scram-sha-256', `--pwfile=${passwordFile}`]);
    } finally { unlinkSync(passwordFile); }
    appendFileSync(join(data, 'postgresql.conf'), "\nlisten_addresses = '127.0.0.1'\nport = 5432\nunix_socket_directories = ''\n");
    writeFileSync(envPath, `PORT=3000\nDATABASE_URL=postgresql://postgres:${password}@127.0.0.1:5432/agromarket\nCORS_ORIGIN=http://localhost:5173\n`, { mode: 0o600, flag: 'wx' });
  }
  let running = false;
  try { execFileSync(command('pg_ctl'), ['-D', data, 'status'], { stdio: 'ignore' }); running = true; } catch { /* stopped */ }
  if (!running) run('pg_ctl', ['-D', data, '-l', join(data, 'server.log'), '-w', 'start']);
  const config = dotenv.parse(readFileSync(envPath));
  const url = new URL(config.DATABASE_URL);
  url.pathname = '/postgres';
  const client = new pg.Client({ connectionString: url.href });
  await client.connect();
  try {
    const { rowCount } = await client.query("SELECT 1 FROM pg_database WHERE datname=$1", ['agromarket']);
    if (!rowCount) await client.query('CREATE DATABASE agromarket');
    console.log('Локальная PostgreSQL готова, база agromarket. Пароль сохранён только в .env.');
  } finally { await client.end(); }
} else {
  throw new Error('Используйте npm run db:local:start или npm run db:local:stop');
}
