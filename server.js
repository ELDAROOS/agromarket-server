import 'dotenv/config';
import app from './app.js';
import { pool } from './db/pool.js';

if (!process.env.JWT_SECRET) {
  console.error('Не задан JWT_SECRET в .env');
  process.exit(1);
}

const PORT = process.env.PORT || 3000;
const server = app.listen(PORT, () => {
  console.log(`АгроМаркет API: http://localhost:${PORT}`);
});

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(async () => {
      await pool.end();
      process.exit(0);
    });
  });
}

