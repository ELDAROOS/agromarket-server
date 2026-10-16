import { Router } from 'express';
import bcrypt from 'bcryptjs';
import { rateLimit } from 'express-rate-limit';
import { createToken, safeUser } from '../authConfig.js';

// Тот же cost для отсутствующего адреса, чтобы не пропускать bcrypt.compare.
const dummyHash = bcrypt.hashSync('not-a-real-account-password', 10);
export function validatePassword(password) {
  if (typeof password !== 'string' || password.length < 8) return 'Пароль должен быть не короче 8 символов';
  if (Buffer.byteLength(password, 'utf8') > 72) return 'Пароль должен занимать не более 72 байт UTF-8';
  return null;
}
const validEmail = email => typeof email === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());

export function createAuthRouter(database, auth, config) {
  const router = Router();
  const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, limit: 5, skipSuccessfulRequests: true,
    message: { error: 'Слишком много попыток входа. Попробуйте через 15 минут' },
    standardHeaders: 'draft-8', legacyHeaders: false,
  });
  router.post('/register', async (req, res) => {
    const { name, email, password } = req.body || {};
    if (typeof name !== 'string' || !name.trim() || !email || !password) {
      return res.status(400).json({ error: 'Поля name, email и password обязательны' });
    }
    if (!validEmail(email)) return res.status(400).json({ error: 'Укажите корректный email' });
    const error = validatePassword(password);
    if (error) return res.status(400).json({ error });
    const hash = await bcrypt.hash(password, 10);
    // Роль никогда не берётся из тела запроса.
    const { rows } = await database.query(`INSERT INTO users (name,email,password_hash)
      VALUES ($1,$2,$3) RETURNING id,name,email,role,created_at,token_version`,
    [name.trim(), email.trim().toLowerCase(), hash]);
    res.status(201).json({ user: safeUser(rows[0]), token: createToken(rows[0], config) });
  });
  router.post('/login', loginLimiter, async (req, res) => {
    const { email, password } = req.body || {};
    if (!validEmail(email) || typeof password !== 'string' || !password) {
      return res.status(400).json({ error: 'Поля email и password обязательны' });
    }
    const { rows } = await database.query('SELECT * FROM users WHERE email=$1', [email.trim().toLowerCase()]);
    const user = rows[0];
    const matches = Buffer.byteLength(password) <= 72 && await bcrypt.compare(password, user?.password_hash || dummyHash);
    if (!user || !matches) return res.status(401).json({ error: 'Неверный email или пароль' });
    res.json({ user: safeUser(user), token: createToken(user, config) });
  });
  router.get('/me', auth.requireAuth, async (req, res) => {
    const { rows } = await database.query('SELECT id,name,email,role,created_at FROM users WHERE id=$1', [req.user.id]);
    if (!rows.length) return res.status(401).json({ error: 'Пользователь не найден' });
    res.json(rows[0]);
  });
  router.patch('/password', auth.requireAuth, async (req, res) => {
    const { oldPassword, newPassword } = req.body || {};
    const error = validatePassword(newPassword);
    if (error) return res.status(400).json({ error });
    if (typeof oldPassword !== 'string' || Buffer.byteLength(oldPassword) > 72) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }
    const { rows } = await database.query('SELECT * FROM users WHERE id=$1', [req.user.id]);
    const user = rows[0];
    if (!user || !await bcrypt.compare(oldPassword, user.password_hash)) {
      return res.status(400).json({ error: 'Неверный текущий пароль' });
    }
    const hash = await bcrypt.hash(newPassword, 10);
    const result = await database.query(`UPDATE users SET password_hash=$1,token_version=token_version+1
      WHERE id=$2 AND password_hash=$3 RETURNING id,name,email,role,created_at,token_version`,
    [hash, user.id, user.password_hash]);
    if (!result.rows.length) return res.status(409).json({ error: 'Пароль уже изменён, войдите снова' });
    res.json({ user: safeUser(result.rows[0]), token: createToken(result.rows[0], config) });
  });
  return router;
}
