import { testDatabase } from '../test/database.js';

const fixture = await testDatabase();
const db = fixture.database;
try {
  const show = async (label, sql, params=[]) => {
    try {
      const result = await db.query(sql,params);
      console.log(JSON.stringify({ experiment:label, rows:result.rows, rowCount:result.rowCount },null,2));
    } catch (err) {
      console.log(JSON.stringify({ experiment:label, code:err.code, message:err.message, constraint:err.constraint },null,2));
    }
  };
  await show('Все товары','SELECT * FROM products');
  await show('Дешевле 1000 по убыванию','SELECT name,price FROM products WHERE price<1000 ORDER BY price DESC');
  await show('ILIKE мол',"SELECT name FROM products WHERE name ILIKE '%мол%'");
  await show('Категории','SELECT category, COUNT(*) AS cnt, ROUND(AVG(price)) AS avg_price FROM products GROUP BY category');
  await show('Самый дорогой','SELECT name,price FROM products ORDER BY price DESC,id LIMIT 1');
  await show('INSERT',"INSERT INTO products (name,price) VALUES ('Тестовый товар',100) RETURNING *");
  await show('UPDATE',"UPDATE products SET price=150 WHERE name='Тестовый товар' RETURNING *");
  await show('DELETE',"DELETE FROM products WHERE name='Тестовый товар'");
  await show('Отрицательная цена',"INSERT INTO products (name,price) VALUES ('Брак',-5)");
  await show('Нет имени','INSERT INTO products (price) VALUES (100)');
  await show('Нет связанного товара',"INSERT INTO orders (product_id,name,email,quantity) VALUES (9999,'Тест','t@t.kz',20)");
  await show('Двойная защита CHECK',"INSERT INTO orders (name,email,quantity) VALUES ('Тест','t@t.kz',5)");
  // Только фиксированные учебные значения и временная схема, не рабочий HTTP-маршрут.
  for (const search of ["zzz' OR 1=1 --", "'"]) {
    await show(`Небезопасный SQL, поиск ${search}`,`SELECT * FROM products WHERE name ILIKE '%${search}%' ORDER BY id`);
    await show(`Параметр $1, поиск ${search}`,'SELECT * FROM products WHERE name ILIKE $1 ORDER BY id',[`%${search}%`]);
  }
} finally { await fixture.cleanup(); }
