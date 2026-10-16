import { Router } from 'express';

function validateProduct(body) {
  const { name, price, category, unit, image } = body;
  if (typeof name !== 'string' || !name.trim()) return 'Поле name обязательно';
  if (!['number', 'string'].includes(typeof price) || !String(price).trim() ||
      !Number.isInteger(Number(price)) || Number(price) < 0 || Number(price) > 2147483647) {
    return 'Поле price должно быть целым числом ≥ 0';
  }
  if ([category, unit, image].some(value => value !== undefined && value !== null && typeof value !== 'string')) {
    return 'Поля category, unit и image должны быть строками';
  }
  return null;
}
const values = body => [body.name.trim(), body.category ?? null, Number(body.price), body.unit ?? 'кг', body.image ?? null];

export function createProductsRouter(pool, auth) {
  const router = Router();
  const adminOnly = [auth.requireAuth, auth.requireRole('admin')];
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
  router.get('/:id', async (req, res) => {
    const { rows } = await pool.query('SELECT * FROM products WHERE id = $1', [req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(rows[0]);
  });
  router.post('/', adminOnly, async (req, res) => {
    const body = req.body || {};
    const error = validateProduct(body);
    if (error) return res.status(400).json({ error });
    const { rows } = await pool.query(`INSERT INTO products (name, category, price, unit, image)
      VALUES ($1, $2, $3, $4, $5) RETURNING *`, values(body));
    res.status(201).json(rows[0]);
  });
  router.put('/:id', adminOnly, async (req, res) => {
    const body = req.body || {};
    const error = validateProduct(body);
    if (error) return res.status(400).json({ error });
    const { rows } = await pool.query(`UPDATE products SET name=$1, category=$2, price=$3, unit=$4, image=$5
      WHERE id=$6 RETURNING *`, [...values(body), req.params.id]);
    if (!rows.length) return res.status(404).json({ error: 'Товар не найден' });
    res.json(rows[0]);
  });
  router.delete('/:id', adminOnly, async (req, res) => {
    const { rowCount } = await pool.query('DELETE FROM products WHERE id=$1', [req.params.id]);
    if (!rowCount) return res.status(404).json({ error: 'Товар не найден' });
    res.status(204).end();
  });
  return router;
}
