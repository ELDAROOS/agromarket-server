import 'dotenv/config';
import pg from 'pg';

// DATE остаётся YYYY-MM-DD, без преобразования часового пояса.
pg.types.setTypeParser(1082, value => value);
export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  connectionTimeoutMillis: 5000,
});
pool.on('error', err => console.error('Ошибка фонового соединения PostgreSQL:', err.message));
