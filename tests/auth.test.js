import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { uniqueEmail } from './helpers.js';

describe('POST /api/auth/register', () => {
  it('создаёт покупателя и возвращает токен', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Айгерим', email: uniqueEmail(), password: 'qwerty123' });
    expect(res.status).toBe(201);
    expect(res.body.token).toBeTruthy();
    expect(res.body.user.role).toBe('user');
    expect(res.body.user).not.toHaveProperty('password_hash');
  });

  it('не даёт стать админом через тело запроса (mass assignment)', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Хакер', email: uniqueEmail(), password: 'qwerty123', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });

  it('повторный e-mail — 409', async () => {
    const body = { name: 'Дубль', email: uniqueEmail(), password: 'qwerty123' };
    await request(app).post('/api/auth/register').send(body); // первый раз — 201
    const res = await request(app).post('/api/auth/register').send(body);
    expect(res.status).toBe(409);
  });

  it('пароль короче 8 символов — 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Тест', email: uniqueEmail(), password: '123' });
    expect(res.status).toBe(400);
  });

  it('e-mail в разном регистре сохраняется в нижнем регистре', async () => {
    const mixedEmail = `Test${Date.now()}@Mail.KZ`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Тест', email: mixedEmail, password: 'qwerty123' });
    expect(res.status).toBe(201);
    expect(res.body.user.email).toBe(mixedEmail.toLowerCase());
  });
});

describe('POST /api/auth/login', () => {
  it('админ входит и получает JWT из трёх частей', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: process.env.ADMIN_EMAIL, password: process.env.ADMIN_PASSWORD });
    expect(res.status).toBe(200);
    expect(res.body.token.split('.')).toHaveLength(3);
    expect(res.body.user.role).toBe('admin');
  });

  it('неверный пароль и чужой e-mail дают одинаковый ответ', async () => {
    const wrongPassword = await request(app)
      .post('/api/auth/login')
      .send({ email: process.env.ADMIN_EMAIL, password: 'не-тот-пароль' });
    const unknownEmail = await request(app)
      .post('/api/auth/login')
      .send({ email: uniqueEmail('nobody'), password: 'не-тот-пароль' });
    expect(wrongPassword.status).toBe(401);
    expect(unknownEmail.status).toBe(401);
    expect(wrongPassword.body).toEqual(unknownEmail.body);
  });
});

describe('GET /api/auth/me', () => {
  it('без токена — 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('с токеном покупателя — 200 и в ответе нет password_hash', async () => {
    const email = uniqueEmail();
    const regRes = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Тест Me', email, password: 'qwerty123' });
    const token = regRes.body.token;

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(200);
    expect(res.body.email).toBe(email);
    expect(res.body).not.toHaveProperty('password_hash');
  });
});
