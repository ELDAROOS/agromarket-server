import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

describe('GET /api/categories', () => {
  it('сумма числовых count равна полному каталогу с учётом пагинации', async () => {
    const res = await request(app).get('/api/categories');
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    expect(res.body.every(c => Number.isInteger(c.count) && c.count > 0)).toBe(true);
    let total = 0;
    for (let offset = 0; ; offset += 100) {
      const page = await request(app).get(`/api/products?limit=100&offset=${offset}`);
      expect(page.status).toBe(200);
      total += page.body.length;
      if (page.body.length < 100) break;
    }
    expect(res.body.reduce((sum, c) => sum + c.count, 0)).toBe(total);
  });
});
