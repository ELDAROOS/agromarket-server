import jwt from 'jsonwebtoken';

export function getAuthConfig(env = process.env) {
  const secret = env.JWT_SECRET;
  if (!secret || Buffer.byteLength(secret) < 32 || secret === 'change-me') {
    throw new Error('Задайте случайный JWT_SECRET длиной не менее 32 байт в .env');
  }
  const expiresIn = env.JWT_EXPIRES_IN || '2h';
  jwt.sign({ sub: '0' }, secret, { algorithm: 'HS256', expiresIn });
  return { secret, expiresIn };
}

export function createToken(user, config) {
  return jwt.sign({ sub: String(user.id), role: user.role, ver: user.token_version }, config.secret,
    { algorithm: 'HS256', expiresIn: config.expiresIn });
}

export function safeUser(user) {
  const { id, name, email, role, created_at } = user;
  return { id, name, email, role, created_at };
}
