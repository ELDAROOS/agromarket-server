import { describe, test, expect } from 'vitest';
import request from 'supertest';
import app from '../src/app.js';
import { getAdminToken, uniqueEmail } from './helpers.js';

describe('Валидация', () => {
  test('регистрация с некорректным e-mail → 400 и поле email в details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Тест', email: 'не-почта', password: '12345678' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field)).toContain('email');
  });

  test('нельзя зарегистрироваться админом через поле role', async () => {
    const email = `role${Date.now()}@test.kz`;
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Хакер', email, password: '12345678', role: 'admin' });
    expect(res.status).toBe(201);
    expect(res.body.user.role).toBe('user');
  });

  test('товар с отрицательной ценой → 400', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: 'Мёд', price: -500, category: 'Мёд' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field)).toContain('price');
  });

  test('GET /api/products/abc → 400, а не 500', async () => {
    const res = await request(app).get('/api/products/abc');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Некорректный id');
  });

  test('пароль из 7 символов → 400', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'Тест', email: uniqueEmail('shortpw'), password: '1234567' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field)).toContain('password');
  });

  test('PATCH товара с пустым телом {} → 400', async () => {
    const token = await getAdminToken();
    const res = await request(app)
      .patch('/api/products/1')
      .set('Authorization', `Bearer ${token}`)
      .send({});
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Ошибка валидации');
  });

  test('тело больше 100 КБ → 413', async () => {
    const token = await getAdminToken();
    const hugeName = 'x'.repeat(200_000);
    const res = await request(app)
      .post('/api/products')
      .set('Authorization', `Bearer ${token}`)
      .send({ name: hugeName, price: 100 });
    expect(res.status).toBe(413);
  });

  test('GET /api/products/-1 → 400 (отрицательный id)', async () => {
    const res = await request(app).get('/api/products/-1');
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('Некорректный id');
  });

  test('регистрация с коротким именем → 400 и поле name в details', async () => {
    const res = await request(app)
      .post('/api/auth/register')
      .send({ name: 'А', email: uniqueEmail('shortname'), password: '12345678' });
    expect(res.status).toBe(400);
    expect(res.body.details.map((d) => d.field)).toContain('name');
  });
});
