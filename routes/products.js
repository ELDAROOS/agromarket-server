import { Router } from 'express';
import { validate, idParam } from '../middleware/validate.js';
import { productSchema, productUpdateSchema } from '../validation/schemas.js';

export function createProductsRouter(pool, auth) {
  const router = Router();
  const canManageProducts = [auth.requireAuth, auth.requireRole('farmer', 'admin')];

  router.get('/', async (req, res) => {
    const { search = '', maxPrice, limit = '20', offset = '0', sort = '' } = req.query;
    if (typeof search !== 'string' || typeof sort !== 'string' ||
        typeof limit !== 'string' || !/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100 ||
        typeof offset !== 'string' || !/^\d+$/.test(offset) || !Number.isSafeInteger(Number(offset)) ||
        (maxPrice !== undefined && (typeof maxPrice !== 'string' || !maxPrice.trim() ||
          !Number.isFinite(Number(maxPrice)) || Number(maxPrice) < 0))) {
      return res.status(400).json({ error: 'Проверьте search, maxPrice, limit (1–100) и offset (≥ 0)' });
    }
    // Только константы из белого списка могут стать частью SQL.
    const allowed = { price: 'price', name: 'name' };
    const descending = sort.startsWith('-');
    const key = descending ? sort.slice(1) : sort;
    const column = Object.hasOwn(allowed, key) ? allowed[key] : 'id';
    const direction = column !== 'id' && descending ? 'DESC' : 'ASC';
    const { rows } = await pool.query(`SELECT * FROM products
      WHERE name ILIKE $1 AND ($2::numeric IS NULL OR price <= $2)
      ORDER BY ${column} ${direction}, id ASC LIMIT $3 OFFSET $4`,
    [`%${search}%`, maxPrice ?? null, Number(limit), Number(offset)]);
    res.json(rows);
  });

  router.get('/:id', idParam, async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(rows[0]);
  });

  router.post('/', canManageProducts, validate(productSchema), async (req, res) => {
    const body = req.body;
    const { rows } = await pool.query(`INSERT INTO products (name, category, price, unit, image, stock, farmer_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [body.name, body.category ?? null, Number(body.price), body.unit ?? 'кг', body.image ?? null, body.stock ?? 0, req.user.id]);
    res.status(201).json(rows[0]);
  });

  async function updateProductHandler(req, res) {
    const fields = [];
    const vals = [];
    let idx = 1;
    for (const [key, val] of Object.entries(req.body)) {
      if (['name', 'category', 'price', 'unit', 'image', 'stock'].includes(key)) {
        fields.push(`${key} = $${idx++}`);
        vals.push(key === 'price' ? Number(val) : val);
      }
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Нет полей для обновления' });
    }
    vals.push(req.params.id, req.user.role === 'admin' ? null : req.user.id);
    const { rows } = await pool.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} AND ($${idx + 1}::int IS NULL OR farmer_id = $${idx + 1}) RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(rows[0]);
  }

  router.put('/:id', idParam, canManageProducts, validate(productUpdateSchema), updateProductHandler);
  router.patch('/:id', idParam, canManageProducts, validate(productUpdateSchema), updateProductHandler);

  router.delete('/:id', idParam, canManageProducts, async (req, res) => {
    let rowCount;
    try {
      ({ rowCount } = await pool.query(
        'DELETE FROM products WHERE id = $1 AND ($2::int IS NULL OR farmer_id = $2)',
        [req.params.id, req.user.role === 'admin' ? null : req.user.id],
      ));
    } catch (error) {
      if (error.code !== '23503') throw error;
      return res.status(409).json({ error: 'Товар есть в заказах. Установите остаток 0, чтобы прекратить продажи.' });
    }
    if (!rowCount) return res.status(404).json({ error: 'Товар не найден' });
    res.status(204).end();
  });

  return router;
}
