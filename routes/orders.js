import { Router } from 'express';
import { validateOrder } from '../middleware/validateOrder.js';

export function createOrdersRouter(pool) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { status } = req.query;
    if (status !== undefined && (typeof status !== 'string' || !['new', 'processing', 'done', 'cancelled'].includes(status))) {
      return res.status(400).json({ error: 'Неизвестный статус заявки' });
    }
    const { rows } = await pool.query(`SELECT o.*, p.name AS product_name
      FROM orders o LEFT JOIN products p ON p.id=o.product_id
      WHERE ($1::text IS NULL OR o.status=$1) ORDER BY o.created_at DESC, o.id DESC`, [status ?? null]);
    res.json(rows);
  });
  router.post('/', validateOrder, async (req, res) => {
    const { product_id, name, email, phone, quantity, date, comment } = res.locals.order;
    const { rows } = await pool.query(`INSERT INTO orders (product_id, name, email, phone, quantity, delivery_date, comment)
      VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`, [product_id, name, email, phone, quantity, date, comment]);
    res.status(201).json(rows[0]);
  });
  router.patch('/:id', async (req, res) => {
    const { status } = req.body || {};
    if (status === undefined || status === null || status === '') {
      return res.status(400).json({ error: 'Поле status обязательно' });
    }
    if (typeof status !== 'string') return res.status(400).json({ error: 'Поле status должно быть строкой' });
    // Список допустимых значений проверяет CHECK в PostgreSQL.
    const { rows } = await pool.query('UPDATE orders SET status=$1 WHERE id=$2 RETURNING *', [status, req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Заявка не найдена' });
    res.json(rows[0]);
  });
  return router;
}
