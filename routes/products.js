import { Router } from 'express';
import { validate, idParam } from '../middleware/validate.js';
import { productSchema, productUpdateSchema } from '../validation/schemas.js';

export function createProductsRouter(pool, auth) {
  const router = Router();
  const adminOnly = [auth.requireAuth, auth.requireRole('farmer', 'admin')];

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

  router.post('/', adminOnly, validate(productSchema), async (req, res) => {
    const body = req.body;
    const { rows } = await pool.query(`INSERT INTO products (name, category, price, unit, image)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`,
      [body.name, body.category ?? null, Number(body.price), body.unit ?? 'кг', body.image ?? null]);
    res.status(201).json(rows[0]);
  });

  async function updateProductHandler(req, res) {
    const fields = [];
    const vals = [];
    let idx = 1;
    for (const [key, val] of Object.entries(req.body)) {
      if (['name', 'category', 'price', 'unit', 'image'].includes(key)) {
        fields.push(`${key} = $${idx++}`);
        vals.push(key === 'price' ? Number(val) : val);
      }
    }
    if (fields.length === 0) {
      return res.status(400).json({ error: 'Нет полей для обновления' });
    }
    vals.push(req.params.id);
    const { rows } = await pool.query(
      `UPDATE products SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
      vals
    );
    if (!rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(rows[0]);
  }

  router.put('/:id', idParam, adminOnly, validate(productUpdateSchema), updateProductHandler);
  router.patch('/:id', idParam, adminOnly, validate(productUpdateSchema), updateProductHandler);

  router.delete('/:id', idParam, adminOnly, async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Товар не найден' });
    res.status(204).end();
  });

  return router;
}
