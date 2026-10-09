import 'dotenv/config';
import { createApp } from './app.js';
import { pool } from './db/pool.js';

const PORT = process.env.PORT || 3000;
const server = createApp().listen(PORT, () => console.log(`API запущен: http://localhost:${PORT}`));
for (const signal of ['SIGTERM', 'SIGINT']) {
  process.once(signal, () => {
    server.close(async () => { await pool.end(); process.exit(0); });
  });
}
