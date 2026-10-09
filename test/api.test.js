import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import express from 'express';
import { createApp } from '../app.js';
import { testDatabase } from './database.js';
import { errorHandler } from '../middleware/errorHandler.js';

let fixture, server, base;
async function listen(app) {
  const instance = app.listen(0, '127.0.0.1');
  await once(instance, 'listening');
  return { instance, url: `http://127.0.0.1:${instance.address().port}` };
}
before(async () => {
  fixture = await testDatabase();
  const result = await listen(createApp({ database: fixture.database }));
  server = result.instance; base = result.url;
});
after(async () => {
  if (server) await new Promise(resolve => server.close(resolve));
  await fixture?.cleanup();
});
const request = (path, method = 'GET', body) => fetch(base + path, {
  method, ...(body === undefined ? {} : { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
});
const json = async (path, method, body, expected = 200) => {
  const response = await request(path, method, body);
  const data = await response.json();
  assert.equal(response.status, expected, JSON.stringify(data));
  return data;
};
const orderBody = { name: 'Тест', email: 't@t.kz', quantity: 20 };

test('служебные маршруты, health с БД, CORS и JSON 404', async () => {
  const health = await json('/api/health');
  assert.equal(health.db, 'connected');
  assert.equal(health.status, 'ok');
  assert.ok(Date.parse(health.time));
  assert.equal((await json('/api/about')).author, 'Не указан');
  const root = await request('/');
  assert.match(root.headers.get('content-type'), /text\/html/);
  assert.equal(await root.text(), 'АгроМаркет API работает');
  assert.match((await json('/abc', 'GET', undefined, 404)).error, /Маршрут/);
  const preflight = await fetch(base + '/api/orders', { method: 'OPTIONS', headers: {
    Origin: 'http://localhost:5173', 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'content-type',
  } });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get('access-control-allow-origin'), 'http://localhost:5173');
});

test('чтение, ILIKE, цена, сортировка и пагинация', async () => {
  const products = await json('/api/products');
  assert.equal(products.length, 4);
  assert.equal(typeof products[0].price, 'number');
  assert.ok(products[0].created_at);
  assert.equal((await json('/api/products/1')).id, 1);
  assert.equal((await request('/api/products/999999')).status, 404);
  assert.deepEqual(await json('/api/products?search=' + encodeURIComponent('КЕК')), [products[0]]);
  assert.equal((await json('/api/products?search=NO_MATCH')).length, 0);
  const ascending = [...products].sort((a,b) => a.price-b.price);
  assert.deepEqual(await json('/api/products?sort=price'), ascending);
  assert.deepEqual(await json('/api/products?sort=-price'), [...ascending].reverse());
  assert.deepEqual(await json('/api/products?limit=2&offset=1'), products.slice(1,3));
  assert.deepEqual(await json('/api/products?maxPrice=600&sort=price'), ascending.filter(p=>p.price<=600));
  assert.deepEqual(await json('/api/products?search=' + encodeURIComponent('КЕК') + '&maxPrice=350'), [products[0]]);
  for (const query of ['limit=0','limit=101','limit=x','offset=-1','offset=1.5','maxPrice=abc','search=a&search=b']) {
    assert.equal((await request('/api/products?' + query)).status, 400);
  }
  assert.deepEqual(await json('/api/products?sort=' + encodeURIComponent('price; DROP TABLE products;--')), products);
  assert.deepEqual(await json('/api/products?sort=constructor'), products);
});

test('полный CRUD товара; PUT сбрасывает непереданные необязательные поля', async () => {
  const product = await json('/api/products', 'POST', { name: 'Картофель', category: 'Овощи', price: 180, unit: 'мешок', image: '/test.png' }, 201);
  assert.ok(product.id);
  const updated = await json(`/api/products/${product.id}`, 'PUT', { name: 'Картофель молодой', price: 200 });
  assert.equal(updated.name, 'Картофель молодой');
  assert.equal(updated.price, 200);
  assert.equal(updated.unit, 'кг');
  assert.equal(updated.category, null);
  assert.equal(updated.image, null);
  assert.deepEqual(await json(`/api/products/${product.id}`), updated);
  const deleted = await request(`/api/products/${product.id}`, 'DELETE');
  assert.equal(deleted.status, 204);
  assert.equal(await deleted.text(), '');
  assert.equal((await request(`/api/products/${product.id}`, 'DELETE')).status, 404);
  assert.equal((await request(`/api/products/${product.id}`)).status, 404);
  assert.equal((await request('/api/products/999999','PUT',{name:'Нет',price:1})).status,404);
});

test('неверные товары, ID, JSON и отсутствие тела дают 400', async () => {
  for (const body of [{price:10},{name:' ',price:10},{name:'Тест',price:-5},{name:'Тест',price:1.5},
    {name:'Тест',price:null},{name:'Тест',price:true},{name:'Тест',price:''},{name:'Тест',price:[]},
    {name:'Тест',price:2147483648},{name:{},price:10}]) {
    assert.equal((await request('/api/products','POST',body)).status,400);
  }
  assert.equal((await json('/api/products/abc','GET',undefined,400)).error,'Неверный формат значения');
  for (const method of ['GET','DELETE']) assert.equal((await request('/api/products/99999999999999999999',method)).status,400);
  assert.equal((await request('/api/orders','POST')).status,400);
  const malformed = await fetch(base+'/api/orders',{method:'POST',headers:{'Content-Type':'application/json'},body:'{broken'});
  assert.equal(malformed.status,400);
});

test('SQL-инъекция и кавычка считаются текстом', async () => {
  for (const search of ["zzz' OR 1=1 --", "'"]) {
    assert.deepEqual(await json('/api/products?search='+encodeURIComponent(search)),[]);
  }
  const name = "Товар ' OR 1=1 --";
  const product = await json('/api/products','POST',{name,price:1},201);
  assert.equal(product.name,name);
  assert.equal((await json('/api/products?search='+encodeURIComponent(name))).length,1);
  await request(`/api/products/${product.id}`,'DELETE');
});

test('заявка: product_id, JOIN, дата без сдвига, статус new, nullable поля', async () => {
  const order = await json('/api/orders','POST',{...orderBody,product_id:'1',quantity:'20',date:'2026-10-20'},201);
  assert.equal(order.quantity,20); assert.equal(order.status,'new');
  assert.equal(order.delivery_date,'2026-10-20'); assert.equal(order.phone,null);
  assert.ok(order.created_at);
  const orders = await json('/api/orders');
  assert.equal(orders.find(o=>o.id===order.id).product_name,'кек, 1 кг');
  const general = await json('/api/orders','POST',{...orderBody,product_id:'',date:''},201);
  assert.equal(general.product_id,null); assert.equal(general.delivery_date,null);
  const bad = await json('/api/orders','POST',{...orderBody,product_id:999999},400);
  assert.equal(bad.error,'Связанная запись не найдена');
  assert.equal((await request('/api/orders','POST',{...orderBody,date:'2026-02-30'})).status,400);
  for (const quantity of [5,0,-1,10.5,'abc',{},true,null]) {
    assert.equal((await request('/api/orders','POST',{...orderBody,quantity})).status,400);
  }
});

test('PATCH статуса и фильтр заявок, CHECK lost, 404', async () => {
  const order = await json('/api/orders','POST',orderBody,201);
  const patched = await json(`/api/orders/${order.id}`,'PATCH',{status:'processing'});
  assert.equal(patched.status,'processing'); assert.equal(patched.name,order.name);
  assert.ok((await json('/api/orders?status=processing')).some(o=>o.id===order.id));
  assert.ok((await json('/api/orders?status=new')).every(o=>o.status==='new'));
  assert.equal((await json(`/api/orders/${order.id}`,'PATCH',{status:'lost'},400)).error,'Значение не проходит проверку в БД');
  assert.equal((await json(`/api/orders/${order.id}`,'PATCH',{},400)).error,'Поле status обязательно');
  assert.equal((await request('/api/orders/999999','PATCH',{status:'done'})).status,404);
  assert.equal((await request('/api/orders/abc','PATCH',{status:'done'})).status,400);
});

test('удаление связанного товара сохраняет заявку и обнуляет связь', async () => {
  const product = await json('/api/products','POST',{name:'Для заявки',price:100},201);
  const order = await json('/api/orders','POST',{...orderBody,product_id:product.id},201);
  await request(`/api/products/${product.id}`,'DELETE');
  const saved = (await json('/api/orders')).find(o=>o.id===order.id);
  assert.ok(saved); assert.equal(saved.product_id,null); assert.equal(saved.product_name,null);
});

test('новый экземпляр сервера видит ранее созданную заявку', async () => {
  const order = await json('/api/orders','POST',orderBody,201);
  const second = await listen(createApp({database:fixture.database}));
  try {
    const orders = await (await fetch(second.url+'/api/orders')).json();
    assert.ok(orders.some(o=>o.id===order.id));
  } finally { await new Promise(resolve=>second.instance.close(resolve)); }
});

test('двойная защита: без JS-проверки БД всё равно отклоняет 5 кг', async () => {
  const app = express(); app.use(express.json());
  app.post('/',async(req,res)=>{
    await fixture.database.query('INSERT INTO orders (name,email,quantity) VALUES ($1,$2,$3)', ['Тест','t@t.kz',req.body.quantity]);
    res.sendStatus(201);
  });
  app.use(errorHandler);
  const isolated = await listen(app);
  try {
    const r=await fetch(isolated.url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{"quantity":5}'});
    assert.equal(r.status,400);
    assert.equal((await r.json()).error,'Значение не проходит проверку в БД');
  } finally {await new Promise(resolve=>isolated.instance.close(resolve));}
});

test('ошибка БД в async-маршруте превращается в JSON 500 без деталей', async () => {
  const broken = await listen(createApp({database:{query:async()=>{throw new Error('private database detail');}}}));
  try {
    const response=await fetch(broken.url+'/api/health');
    assert.equal(response.status,500);
    assert.deepEqual(await response.json(),{error:'Внутренняя ошибка сервера'});
  } finally {await new Promise(resolve=>broken.instance.close(resolve));}
});
