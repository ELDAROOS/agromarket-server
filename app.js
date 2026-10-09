import express from 'express';
import cors from 'cors';
import productsRouter from './routes/products.js';
import { createOrdersRouter } from './routes/orders.js';
import { logger } from './middleware/logger.js';

export function createApp() {
  const app = express();
  app.use(cors({ origin: 'http://localhost:5173' }));
  app.use(logger);
  app.use(express.json());

  app.get('/', (req, res) => res.send('АгроМаркет API работает'));
  app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));
  app.get('/api/about', (req, res) => res.json({
    name: 'АгроМаркет', version: '1.0', author: 'Не указан',
  }));
  app.use('/api/products', productsRouter);
  app.use('/api/orders', createOrdersRouter());
  app.use((req, res) => {
    res.status(404).json({ error: `Маршрут ${req.method} ${req.originalUrl} не найден` });
  });
  // Ошибки разбора JSON тоже возвращаются в формате API.
  app.use((err, req, res, next) => {
    if (res.headersSent) return next(err);
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'Тело запроса слишком большое' });
    }
    console.error(err);
    res.status(500).json({ error: 'Внутренняя ошибка сервера' });
  });
  return app;
}
