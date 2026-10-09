import { Router } from 'express';
import { products } from '../data/products.js';

const router = Router();
router.get('/', (req, res) => {
  const { search = '', maxPrice, sort } = req.query;
  if (typeof search !== 'string' ||
      (maxPrice !== undefined && (typeof maxPrice !== 'string' || !maxPrice.trim() ||
        !Number.isFinite(Number(maxPrice)) || Number(maxPrice) < 0)) ||
      (sort !== undefined && !['price', '-price'].includes(sort))) {
    return res.status(400).json({ error: 'Проверьте параметры search, maxPrice и sort (price или -price)' });
  }

  let result = products.filter((product) =>
    product.name.toLowerCase().includes(search.toLowerCase()) &&
    (maxPrice === undefined || product.price <= Number(maxPrice)));
  if (sort) {
    result = [...result].sort((a, b) => sort === 'price' ? a.price - b.price : b.price - a.price);
  }
  res.json(result);
});

router.get('/:id', (req, res) => {
  const product = products.find((item) => String(item.id) === req.params.id);
  if (!product) return res.status(404).json({ error: 'Товар не найден' });
  res.json(product);
});

export default router;
