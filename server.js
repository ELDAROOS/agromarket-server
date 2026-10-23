import 'dotenv/config';
import { getAuthConfig } from './authConfig.js';
import { pool } from './db/pool.js';

const missing = ['JWT_SECRET', 'CORS_ORIGIN'].filter(name => !process.env[name]?.trim());
if (!process.env.DATABASE_URL && !process.env.PGHOST) missing.push('DATABASE_URL (или PGHOST)');
if (missing.length) {
  console.error('Не заданы переменные окружения:', missing.join(', '));
  process.exit(1);
}
try {
  getAuthConfig();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
// Импортируем приложение после проверки настроек, чтобы показать понятную ошибку.
const { default: app } = await import('./app.js');
const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`АгроМаркет API: порт ${PORT}, режим ${process.env.NODE_ENV || 'development'}`);
});

let stopping = false;
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal}: завершаем работу...`);
    const deadline = setTimeout(() => process.exit(1), 25_000);
    deadline.unref();
    server.close(async error => {
      try {
        await pool.end();
        process.exitCode = error ? 1 : 0;
      } catch {
        process.exitCode = 1;
      } finally {
        clearTimeout(deadline);
      }
    });
  });
}
