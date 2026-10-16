import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../app.js';

describe('GET /api/health', () => {
  it('отвечает 200', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
  });
});
