const PG_CLIENT_ERRORS = {
  '22P02': 'Неверный формат значения',
  '22003': 'Число вне допустимого диапазона',
  '22007': 'Неверный формат даты',
  '22008': 'Неверная дата',
  '23502': 'Не заполнено обязательное поле',
  '23503': 'Связанная запись не найдена',
  '23514': 'Значение не проходит проверку в БД',
};

export function errorHandler(err, req, res, next) {
  if (res.headersSent) return next(err);
  if (err.code === '23505') return res.status(409).json({ error: 'Такая запись уже существует' });
  if (PG_CLIENT_ERRORS[err.code]) {
    return res.status(400).json({ error: PG_CLIENT_ERRORS[err.code], ...(process.env.NODE_ENV !== 'production' ? { detail: err.message } : {}) });
  }
  if (err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Некорректный JSON в теле запроса' });
  }
  if (err.type === 'entity.too.large') {
    return res.status(413).json({ error: 'Слишком большой запрос' });
  }
  console.error(err);
  const supplied = err.status || err.statusCode;
  const status = Number.isInteger(supplied) && supplied >= 400 && supplied <= 599 ? supplied : 500;
  res.status(status).json({
    error: status >= 500 && process.env.NODE_ENV === 'production'
      ? 'Внутренняя ошибка сервера' : (err.message || 'Внутренняя ошибка сервера'),
  });
}
