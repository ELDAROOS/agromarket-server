export function validateOrder(req, res, next) {
  const { name, email, quantity, phone, date, comment } = req.body || {};
  if (typeof name !== 'string' || !name.trim() ||
      typeof email !== 'string' || !email.trim() ||
      quantity === undefined || quantity === null || quantity === '') {
    return res.status(400).json({ error: 'Поля name, email и quantity обязательны' });
  }

  if (!['number', 'string'].includes(typeof quantity) ||
      !Number.isFinite(Number(quantity))) {
    return res.status(400).json({ error: 'Объём заказа должен быть числом' });
  }
  if (Number(quantity) < 10) {
    return res.status(400).json({ error: 'Минимальный объём заказа — 10 кг' });
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
    return res.status(400).json({ error: 'Укажите корректный email' });
  }
  if ([phone, date, comment].some((value) => value !== undefined && typeof value !== 'string')) {
    return res.status(400).json({ error: 'Поля phone, date и comment должны быть строками' });
  }

  res.locals.order = {
    name: name.trim(), email: email.trim(), quantity: Number(quantity),
    phone: phone?.trim() || '', date: date || '', comment: comment?.trim() || '',
  };
  next();
}
