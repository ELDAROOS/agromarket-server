import { afterEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import app, { createApp } from '../app.js';
import { errorHandler } from '../middleware/errorHandler.js';
import { isLocalDatabase } from '../db/seedSafety.js';

const mockRes = () => { const res = {}; res.status = vi.fn(() => res); res.json = vi.fn(() => res); return res; };
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });

describe('production readiness', () => {
  it('health проверяет БД и сообщает версию', async () => {
    const res = await request(app).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok', db: 'ok', version: 'local' });
  });
  it('недоступная БД даёт 503 без деталей подключения', async () => {
    vi.stubEnv('RENDER_GIT_COMMIT', 'abcdef123456789');
    const database = { query: vi.fn().mockRejectedValue(new Error('private database host')) };
    const res = await request(createApp({ database })).get('/api/health');
    expect(res.status).toBe(503);
    expect(res.body).toEqual({ status: 'error', db: 'unavailable', version: 'abcdef1' });
  });
  it('несколько разрешённых Origin и чужой Origin', async () => {
    vi.stubEnv('CORS_ORIGIN', 'http://localhost:5173, https://shop.example');
    const instance = createApp();
    for (const origin of ['http://localhost:5173', 'https://shop.example']) {
      const res = await request(instance).get('/api/products').set('Origin', origin);
      expect(res.headers['access-control-allow-origin']).toBe(origin);
    }
    const res = await request(instance).get('/api/products').set('Origin', 'https://evil.example');
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(instance.get('trust proxy')).toBe(1);
  });
  it('500 скрыта в production, 400 сохраняет сообщение', () => {
    vi.stubEnv('NODE_ENV', 'production');
    vi.spyOn(console, 'error').mockImplementation(() => {});
    for (const status of [400, 500]) {
      const res = mockRes();
      errorHandler(Object.assign(new Error('Текст ошибки'), { status }), {}, res, vi.fn());
      expect(res.status).toHaveBeenCalledWith(status);
      expect(res.json).toHaveBeenCalledWith({ error: status === 500 ? 'Внутренняя ошибка сервера' : 'Текст ошибки' });
    }
  });
  it('ошибка PostgreSQL не раскрывает detail в production', async () => {
    vi.stubEnv('NODE_ENV', 'production');
    const res = await request(app).get('/api/products/abc');
    expect(res.status).toBe(400);
    expect(res.body).toEqual({ error: 'Неверный формат значения' });
  });
  it('предохранитель не принимает localhost в чужом URL', () => {
    expect(isLocalDatabase({ DATABASE_URL: 'postgres://user:localhost@remote.example/db' })).toBe(false);
    expect(isLocalDatabase({ DATABASE_URL: 'postgres://user:pass@localhost.evil.example/test' })).toBe(false);
    expect(isLocalDatabase({ DATABASE_URL: 'postgres://user:pass@127.0.0.1/db' })).toBe(true);
    expect(isLocalDatabase({ PGHOST: 'localhost' })).toBe(true);
    expect(isLocalDatabase({})).toBe(false);
  });
});
