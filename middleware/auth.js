import jwt from 'jsonwebtoken';

export function createAuthMiddleware(database, config) {
  async function requireAuth(req, res, next) {
    const match = /^Bearer ([^\s]+)$/i.exec(req.get('Authorization') || '');
    if (!match) return res.status(401).json({ error: 'Требуется вход в систему' });
    let payload;
    try {
      payload = jwt.verify(match[1], config.secret, { algorithms: ['HS256'] });
      if (typeof payload !== 'object' || !/^\d+$/.test(payload.sub) ||
          !Number.isSafeInteger(Number(payload.sub)) || Number(payload.sub) < 1 ||
          !Number.isInteger(payload.exp) || !Number.isInteger(payload.ver)) throw new Error('Invalid claims');
    } catch (err) {
      return res.status(401).json({ error: err.name === 'TokenExpiredError'
        ? 'Срок действия токена истёк, войдите снова' : 'Недействительный токен' });
    }
    // Проверка актуальной записи закрывает доступ удалённому пользователю
    // и отзывает старые токены после смены пароля.
    const { rows } = await database.query('SELECT id, role, token_version FROM users WHERE id=$1', [payload.sub]);
    const user = rows[0];
    if (!user || user.token_version !== payload.ver) {
      return res.status(401).json({ error: 'Недействительный токен' });
    }
    req.user = { id: user.id, role: user.role };
    next();
  }
  function optionalAuth(req, res, next) {
    if (!req.get('Authorization')) return next();
    // Предъявленный неверный токен не превращает заявку в анонимную.
    return requireAuth(req, res, next);
  }
  return { requireAuth, optionalAuth, requireRole };
}

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}
