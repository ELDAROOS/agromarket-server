import { afterAll } from 'vitest';
import { pool } from '../db/pool.js';

// После всех тестов файла закрываем подключения к базе,
// иначе процесс тестов «зависнет» в ожидании
afterAll(async () => {
  await pool.end();
});
