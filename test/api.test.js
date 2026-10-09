import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createApp } from '../app.js';
import { products } from '../data/products.js';
import { validateOrder } from '../middleware/validateOrder.js';

let server, base;
before(async () => {
  server = createApp().listen(0, '127.0.0.1');
  await once(server, 'listening');
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => new Promise((resolve) => server.close(resolve)));
const get = (path) => fetch(base + path);
const post = (body) => fetch(base + '/api/orders', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
});

test('корень, health, about и JSON 404', async () => {
  const root = await get('/');
  assert.equal(root.status, 200);
  assert.match(root.headers.get('content-type'), /text\/html/);
  assert.equal(await root.text(), 'АгроМаркет API работает');
  const health = await get('/api/health');
  assert.equal(health.status, 200);
  assert.match(health.headers.get('content-type'), /application\/json/);
  const body = await health.json();
  assert.equal(body.status, 'ok');
  assert.ok(Number.isFinite(Date.parse(body.time)));
  const about = await (await get('/api/about')).json();
  assert.equal(about.name, 'АгроМаркет');
  assert.equal(about.version, '1.0');
  assert.ok(about.author);
  const missing = await get('/abc');
  assert.equal(missing.status, 404);
  assert.deepEqual(await missing.json(), { error: 'Маршрут GET /abc не найден' });
});

test('каталог, id, поиск без учёта регистра, пустой результат', async () => {
  assert.deepEqual(await (await get('/api/products')).json(), products);
  assert.deepEqual(await (await get('/api/products/1')).json(), products[0]);
  assert.equal((await get('/api/products/999')).status, 404);
  const search = encodeURIComponent(products[0].name.toUpperCase());
  assert.deepEqual(await (await get(`/api/products?search=${search}`)).json(), [products[0]]);
  assert.deepEqual(await (await get('/api/products?search=NO_MATCH')).json(), []);
});

test('фильтр цены, совместный поиск, сортировки не меняют исходный каталог', async () => {
  const original = structuredClone(products);
  const ascending = [...products].sort((a, b) => a.price - b.price);
  assert.deepEqual(await (await get('/api/products?sort=price')).json(), ascending);
  assert.deepEqual(await (await get('/api/products?sort=-price')).json(), [...ascending].reverse());
  assert.deepEqual(await (await get('/api/products?maxPrice=600')).json(), products.filter(p => p.price <= 600));
  const search = encodeURIComponent(products[0].name.toUpperCase());
  assert.deepEqual(await (await get(`/api/products?search=${search}&maxPrice=350&sort=-price`)).json(), [products[0]]);
  assert.deepEqual(await (await get('/api/products?maxPrice=0')).json(), []);
  assert.deepEqual(await (await get('/api/products')).json(), original);
  for (const query of ['maxPrice=abc', 'maxPrice=-1', 'maxPrice=', 'search=a&search=b', 'sort=foo']) {
    assert.equal((await get(`/api/products?${query}`)).status, 400);
  }
});

test('CORS: разрешённый источник и preflight POST', async () => {
  const response = await fetch(base + '/api/products', { headers: { Origin: 'http://localhost:5173' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'http://localhost:5173');
  const preflight = await fetch(base + '/api/orders', { method: 'OPTIONS', headers: {
    Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST',
    'Access-Control-Request-Headers': 'content-type',
  } });
  assert.equal(preflight.status, 204);
  assert.match(preflight.headers.get('access-control-allow-methods'), /POST/);
  assert.match(preflight.headers.get('access-control-allow-headers'), /content-type/);
  const foreign = await fetch(base + '/api/products', { headers: { Origin: 'http://example.org' } });
  assert.notEqual(foreign.headers.get('access-control-allow-origin'), 'http://example.org');
});

test('заявки: 201, числовой объём, id, хранение; неверные заявки не сохраняются', async () => {
  assert.deepEqual(await (await get('/api/orders')).json(), []);
  for (const quantity of [5, 0, -10, 'abc', 'Infinity', {}, [], true, null]) {
    const response = await post({ name: 'Тест', email: 't@t.kz', quantity });
    assert.equal(response.status, 400);
    if (quantity === 5) assert.deepEqual(await response.json(), { error: 'Минимальный объём заказа — 10 кг' });
  }
  for (const body of [{}, { name: ' ', email: 't@t.kz', quantity: 10 },
    { name: 'Тест', email: 'bad', quantity: 10 }]) {
    assert.equal((await post(body)).status, 400);
  }
  assert.deepEqual(await (await get('/api/orders')).json(), []);
  const response = await post({ name: ' Тест ', email: 't@t.kz', quantity: '10',
    phone: '+7 700 000 00 00', date: '2026-10-20', comment: 'Тестовая заявка' });
  assert.equal(response.status, 201);
  const order = await response.json();
  assert.equal(order.id, 1);
  assert.equal(order.name, 'Тест');
  assert.equal(order.quantity, 10);
  assert.equal(order.comment, 'Тестовая заявка');
  assert.ok(Number.isFinite(Date.parse(order.createdAt)));
  assert.deepEqual(await (await get('/api/orders')).json(), [order]);
  const second = await post({ name: 'Тест 2', email: 't@t.kz', quantity: 20 });
  assert.equal((await second.json()).id, 2);
});

test('нет тела, неверный Content-Type, сломанный JSON', async () => {
  assert.equal((await fetch(base + '/api/orders', { method: 'POST' })).status, 400);
  const text = await fetch(base + '/api/orders', { method: 'POST', body: '{"name":"Тест"}' });
  assert.equal(text.status, 400);
  const broken = await fetch(base + '/api/orders', { method: 'POST', headers: {
    'Content-Type': 'application/json',
  }, body: '{broken' });
  assert.equal(broken.status, 400);
  assert.deepEqual(await broken.json(), { error: 'Некорректный JSON в теле запроса' });
});

test('учебные эксперименты в изолированных приложениях', async () => {
  async function withApp(app, run) {
    const instance = app.listen(0, '127.0.0.1');
    await once(instance, 'listening');
    try { await run(`http://127.0.0.1:${instance.address().port}`); }
    finally { instance.closeAllConnections(); await new Promise(resolve => instance.close(resolve)); }
  }
  const stalled = express();
  let reached = false;
  stalled.use((req, res, next) => { /* next() намеренно отсутствует */ });
  stalled.get('/', (req, res) => { reached = true; res.json({ ok: true }); });
  await withApp(stalled, async (url) => {
    await assert.rejects(fetch(url, { signal: AbortSignal.timeout(150) }), { name: 'TimeoutError' });
    assert.equal(reached, false);
  });
  const late = express();
  let logged = false;
  late.get('/', (req, res) => res.json({ ok: true }));
  late.use((req, res, next) => { logged = true; next(); });
  await withApp(late, async (url) => {
    assert.equal((await fetch(url)).status, 200);
    assert.equal(logged, false);
  });
  const noParser = express();
  noParser.post('/', validateOrder, (req, res) => res.sendStatus(201));
  await withApp(noParser, async (url) => {
    const response = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Тест', email: 't@t.kz', quantity: 10 }) });
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error: 'Поля name, email и quantity обязательны' });
  });
  await withApp(express(), async (url) => {
    const response = await fetch(url + '/abc');
    assert.equal(response.status, 404);
    assert.match(response.headers.get('content-type'), /text\/html/);
    assert.match(await response.text(), /Cannot GET \/abc/);
  });
  await withApp(createApp(), async (url) => {
    assert.deepEqual(await (await fetch(url + '/api/orders')).json(), []);
  });
});
