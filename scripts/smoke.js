import assert from 'node:assert/strict';

const API_URL = process.env.API_URL?.replace(/\/$/, '');
const FRONTEND_URL = process.env.FRONTEND_URL;
const EXPECTED = (process.env.EXPECTED_VERSION || '').slice(0, 7);
const request = (path, options = {}) => fetch(`${API_URL}${path}`, {
  ...options, signal: AbortSignal.timeout(20_000),
});

async function main() {
  assert(API_URL && FRONTEND_URL, 'Задайте API_URL и FRONTEND_URL');
  assert.equal(new URL(FRONTEND_URL).origin, FRONTEND_URL, 'FRONTEND_URL должен быть Origin без пути');
  const deadline = Date.now() + 10 * 60_000;
  let ready = false;
  for (let attempt = 1; Date.now() < deadline; attempt++) {
    try {
      const response = await request('/health');
      const health = await response.json();
      console.log(`#${attempt}: HTTP ${response.status}, версия ${health.version}`);
      if (response.ok && health.status === 'ok' && health.db === 'ok' &&
          (!EXPECTED || health.version === EXPECTED)) { ready = true; break; }
    } catch { console.log(`#${attempt}: сервер пока не отвечает`); }
    await new Promise(resolve => setTimeout(resolve, Math.min(15_000, Math.max(0, deadline - Date.now()))));
  }
  assert(ready, `Не дождались версии ${EXPECTED || '(любой)'} за 10 минут`);
  const checks = [
    ['каталог непустой', async () => {
      const response = await request('/products');
      assert.equal(response.status, 200);
      const data = await response.json();
      assert(Array.isArray(data) && data.length > 0);
    }],
    ['без токена товар не создать (401)', async () => {
      // Пустое тело не создаст товар даже при регрессии авторизации.
      const response = await request('/products', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
      });
      assert.equal(response.status, 401);
    }],
    ['CORS: фронтенд допущен, чужой Origin отклонён', async () => {
      const allowed = await request('/products', { headers: { Origin: FRONTEND_URL } });
      assert.equal(allowed.status, 200);
      assert.equal(allowed.headers.get('access-control-allow-origin'), FRONTEND_URL);
      const denied = await request('/products', { headers: { Origin: 'https://evil.example' } });
      assert.equal(denied.headers.get('access-control-allow-origin'), null);
    }],
    ['несуществующий товар — 404', async () => {
      // SERIAL выдаёт положительные id; не используем потенциально существующий 999999.
      const response = await request('/products/-1');
      assert.equal(response.status, 404);
    }],
    ['категории содержат числовые количества', async () => {
      const response = await request('/categories');
      assert.equal(response.status, 200);
      const categories = await response.json();
      assert(Array.isArray(categories) && categories.length > 0);
      assert(categories.every(c => (typeof c.name === 'string' || c.name === null) &&
        Number.isInteger(c.count) && c.count > 0));
    }],
    ['заголовки безопасности', async () => {
      const response = await request('/health');
      assert(response.headers.has('strict-transport-security'));
      assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
      assert.equal(response.headers.get('x-powered-by'), null);
    }],
    ['сайт доступен', async () => {
      const response = await fetch(FRONTEND_URL, { signal: AbortSignal.timeout(20_000) });
      assert.equal(response.status, 200);
      assert(response.headers.get('content-type')?.includes('text/html'));
      assert((await response.text()).includes('id="root"'));
    }],
  ];
  let failed = 0;
  for (const [name, run] of checks) {
    try { await run(); console.log(`✓ ${name}`); }
    catch (error) { failed++; console.error(`✗ ${name}: ${error.message}`); }
  }
  assert.equal(failed, 0, `Провалено проверок: ${failed}`);
  console.log('Smoke-тест пройден');
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
