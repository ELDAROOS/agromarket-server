import { Router } from 'express';

export function createCategoriesRouter(database) {
  const router = Router();
  router.get('/', async (req, res) => {
    const { rows } = await database.query(`SELECT category AS name, COUNT(*)::int AS count
      FROM products GROUP BY category ORDER BY category`);
    res.json(rows);
  });
  return router;
}
