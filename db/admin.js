import bcrypt from 'bcryptjs';

export async function seedAdmin(database) {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
      !password || password === 'change-me' || password.length < 8 || Buffer.byteLength(password) > 72) {
    throw new Error('Укажите ADMIN_EMAIL и надёжный ADMIN_PASSWORD (8 символов, до 72 байт) в .env');
  }
  const hash = await bcrypt.hash(password, 10);
  await database.query(`INSERT INTO users (name,email,password_hash,role)
    VALUES ($1,$2,$3,'admin') ON CONFLICT (email) DO NOTHING`, ['Администратор',email,hash]);
  const { rows } = await database.query('SELECT role FROM users WHERE email=$1',[email]);
  if (rows[0].role !== 'admin') throw new Error('ADMIN_EMAIL уже занят обычным пользователем. Выберите другой адрес.');
}
