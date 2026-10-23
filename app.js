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
import { createCategoriesRouter } from './routes/categories.js';
import { errorHandler } from './middleware/errorHandler.js';

export function createApp({ database = pool, authConfig = getAuthConfig() } = {}) {
  const app = express();
  const auth = createAuthMiddleware(database, authConfig);
  app.set('trust proxy', 1);
  const version = (process.env.RENDER_GIT_COMMIT || 'local').slice(0, 7);
  app.use(helmet());
  const allowedOrigins = (process.env.CORS_ORIGIN || 'http://localhost:5173')
    .split(',').map(origin => origin.trim()).filter(Boolean);
  app.use(cors({ origin: allowedOrigins }));
  if (process.env.NODE_ENV !== 'test') {
    app.use(logger);
  }
  app.use(express.json({ limit: '10kb' }));
  app.get('/', (req, res) => res.send('АгроМаркет API работает'));
  app.get('/api/health', async (req, res) => {
    res.set('Cache-Control', 'no-store');
    try {
      await database.query('SELECT 1');
      res.json({ status: 'ok', db: 'ok', version });
    } catch {
      res.status(503).json({ status: 'error', db: 'unavailable', version });
    }
  });
  app.get('/api/about', (req, res) => res.json({ name: 'АгроМаркет', version: '1.0', author: 'Не указан' }));
  app.use('/api/auth', createAuthRouter(database, auth, authConfig));
  app.use('/api/categories', createCategoriesRouter(database));
  app.use('/api/products', createProductsRouter(database, auth));
  app.use('/api/orders', createOrdersRouter(database, auth));
  app.use((req, res) => res.status(404).json({ error: `Маршрут ${req.method} ${req.originalUrl} не найден` }));
  app.use(errorHandler);
  return app;
}

const app = createApp();
export default app;
