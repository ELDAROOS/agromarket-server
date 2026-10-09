import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { pool } from './db/pool.js';
import { createProductsRouter } from './routes/products.js';
import { createOrdersRouter } from './routes/orders.js';
import { logger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp({ database = pool } = {}) {
  const app = express();
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
  app.use(logger);
  app.use(express.json());
  app.get('/', (req, res) => res.send('АгроМаркет API работает'));
  app.get('/api/health', async (req, res) => {
    await database.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  });
  app.get('/api/about', (req, res) => res.json({ name: 'АгроМаркет', version: '1.0', author: 'Не указан' }));
  app.use('/api/products', createProductsRouter(database));
  app.use('/api/orders', createOrdersRouter(database));
  app.use((req, res) => res.status(404).json({ error: `Маршрут ${req.method} ${req.originalUrl} не найден` }));
  app.use(errorHandler);
  return app;
}
