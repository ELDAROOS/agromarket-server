import jwt from 'jsonwebtoken';

export function requireRole(role) {
  return (req, res, next) => {
    if (req.user?.role !== role) return res.status(403).json({ error: 'Недостаточно прав' });
    next();
  };
}

export function requireAuth(req, res, next) {
  const authHeader = typeof req.get === 'function'
    ? (req.get('Authorization') || '')
    : (req.headers?.authorization || req.headers?.Authorization || '');
  const match = /^Bearer ([^\s]+)$/i.exec(authHeader);
  if (!match) return res.status(401).json({ error: 'Требуется вход в систему' });
  const secret = process.env.JWT_SECRET;
  let payload;
  try {
    payload = jwt.verify(match[1], secret);
  } catch (err) {
    return res.status(401).json({
      error: err.name === 'TokenExpiredError'
        ? 'Срок действия токена истёк, войдите снова'
        : 'Недействительный токен'
    });
  }
  req.user = { id: Number(payload.sub), role: payload.role };
  next();
}

export function optionalAuth(req, res, next) {
  const authHeader = typeof req.get === 'function'
    ? (req.get('Authorization') || '')
    : (req.headers?.authorization || req.headers?.Authorization || '');
  if (!authHeader) return next();
  return requireAuth(req, res, next);
}

export const adminOnly = [requireAuth, requireRole('admin')];

export function createAuthMiddleware(database, config) {
  return { requireAuth, optionalAuth, requireRole, adminOnly };
}
