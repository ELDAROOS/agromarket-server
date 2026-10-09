import newman from 'newman';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { createApp } from '../app.js';
import { testDatabase } from './database.js';

const fixture = await testDatabase();
const server = createApp({ database: fixture.database }).listen(0, '127.0.0.1');
await once(server, 'listening');
try {
  for (let attempt=1; attempt<=2; attempt++) {
    console.log(`Postman: запуск ${attempt}/2`);
    const collection=JSON.parse(readFileSync(new URL('../postman/agromarket.postman_collection.json',import.meta.url),'utf8'));
    await new Promise((resolve,reject)=>newman.run({collection,reporters:['cli'],
      envVar:[{key:'baseUrl',value:`http://127.0.0.1:${server.address().port}/api`}],
    },(err,summary)=>err || summary.run.failures.length ? reject(err || new Error('Postman tests failed')) : resolve()));
  }
} finally {
  await new Promise(resolve=>server.close(resolve));
  await fixture.cleanup();
}
