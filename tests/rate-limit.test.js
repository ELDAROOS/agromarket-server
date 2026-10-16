import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';
import { uniqueEmail } from './helpers.js';

describe('Rate limit: ограничение попыток входа', () => {
  it('после 5 неудачных попыток 6-я возвращает 429 и Retry-After', async () => {
    const email = uniqueEmail('ratelimit');
    for (let i = 0; i < 5; i++) {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ email, password: 'wrong-password' });
      expect(res.status).toBe(401);
    }
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email, password: 'wrong-password' });
    expect(res.status).toBe(429);
    expect(res.headers['retry-after']).toBeTruthy();
    expect(res.body.error).toMatch(/много попыток/);
  });
});
