import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import { getAuthConfig } from './authConfig.js';
import { createAuthMiddleware } from './middleware/auth.js';
import { createAuthRouter } from './routes/auth.js';
import { pool } from './db/pool.js';
import { createProductsRouter } from './routes/products.js';
import { createOrdersRouter } from './routes/orders.js';
import { logger } from './middleware/logger.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp({ database = pool, authConfig = getAuthConfig() } = {}) {
  const app = express();
  const auth = createAuthMiddleware(database, authConfig);
  app.use(helmet());
  app.use(cors({ origin: process.env.CORS_ORIGIN || 'http://localhost:5173' }));
  if (process.env.NODE_ENV !== 'test') {
    app.use(logger);
  }
  app.use(express.json({ limit: '10kb' }));
  app.get('/', (req, res) => res.send('АгроМаркет API работает'));
  app.get('/api/health', async (req, res) => {
    await database.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected', time: new Date().toISOString() });
  });
  app.get('/api/about', (req, res) => res.json({ name: 'АгроМаркет', version: '1.0', author: 'Не указан' }));
  app.use('/api/auth', createAuthRouter(database, auth, authConfig));
  app.use('/api/products', createProductsRouter(database, auth));
  app.use('/api/orders', createOrdersRouter(database, auth));
  app.use((req, res) => res.status(404).json({ error: `Маршрут ${req.method} ${req.originalUrl} не найден` }));
  app.use(errorHandler);
  return app;
}

const app = createApp();
export default app;
