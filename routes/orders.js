import { Router } from 'express';
import { validateOrder } from '../middleware/validateOrder.js';

export function createOrdersRouter() {
  const router = Router();
  // Учебное хранение в памяти: перезапуск удаляет заявки.
  const orders = [];
  let nextId = 1;

  router.get('/', (req, res) => res.json(orders));
  router.post('/', validateOrder, (req, res) => {
    const order = { ...res.locals.order, id: nextId++, createdAt: new Date().toISOString() };
    orders.push(order);
    res.status(201).json(order);
  });
  return router;
}
