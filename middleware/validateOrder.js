export function validateOrder(req, res, next) {
  const { name, email, quantity, phone, date, comment, product_id } = req.body || {};
  if (typeof name !== 'string' || !name.trim() || typeof email !== 'string' || !email.trim() ||
      quantity === undefined || quantity === null || quantity === '') {
    return res.status(400).json({ error: 'Поля name, email и quantity обязательны' });
  }
  if (!['number', 'string'].includes(typeof quantity) || !String(quantity).trim() ||
      !Number.isInteger(Number(quantity)) || Number(quantity) > 2147483647) {
    return res.status(400).json({ error: 'Объём заказа должен быть целым числом' });
  }
  if (Number(quantity) < 10) {
    return res.status(400).json({ error: 'Минимальный объём заказа — 10 кг' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Укажите корректный email' });
  }
  if ([phone, date, comment].some(value => value !== undefined && value !== null && typeof value !== 'string')) {
    return res.status(400).json({ error: 'Поля phone, date и comment должны быть строками' });
  }
  if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return res.status(400).json({ error: 'Дата должна быть в формате YYYY-MM-DD' });
  }
  if (product_id !== undefined && product_id !== null && product_id !== '' &&
      (!['number', 'string'].includes(typeof product_id) || !/^\d+$/.test(String(product_id)) || Number(product_id) < 1)) {
    return res.status(400).json({ error: 'Неверный формат product_id' });
  }
  res.locals.order = {
    name: name.trim(), email: email.trim(), quantity: Number(quantity),
    phone: phone?.trim() || null, date: date || null, comment: comment?.trim() || null,
    product_id: product_id === undefined || product_id === '' ? null : product_id,
  };
  next();
}
