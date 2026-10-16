import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { createApp } from '../app.js';
import { getAuthConfig } from '../authConfig.js';
import { testDatabase } from './database.js';

let fixture, server, base, account, admin;
const password = 'Lab7-test-password';
async function start() {
  const server=createApp({database:fixture.database}).listen(0,'127.0.0.1'); await once(server,'listening');
  return {server,base:`http://127.0.0.1:${server.address().port}`};
}
async function send(path,{method='GET',body,token,url=base}={}) {
  const response=await fetch(url+path,{method,headers:{...(body!==undefined?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{})},
    ...(body!==undefined?{body:JSON.stringify(body)}:{})});
  return {response,status:response.status,data:response.status===204?null:await response.json()};
}
async function register(email,extra={}) {
  const r=await send('/api/auth/register',{method:'POST',body:{name:'Тест',email,password,...extra}});
  assert.equal(r.status,201,JSON.stringify(r.data)); return r.data;
}
const close=instance=>new Promise(resolve=>instance.close(resolve));
before(async()=>{
  fixture=await testDatabase(); ({server,base}=await start());
  admin=(await send('/api/auth/login',{method:'POST',body:{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD}})).data;
  account=await register('Account@Test.kz',{role:'admin'});
});
after(async()=>{if(server)await close(server);await fixture?.cleanup();});

test('регистрация: email, роль user, скрытый хэш, 409, валидация',async()=>{
  assert.equal(account.user.role,'user');assert.equal(account.user.email,'account@test.kz');
  assert.equal('password_hash' in account.user,false);assert.equal('token_version' in account.user,false);
  assert.equal((await send('/api/auth/register',{method:'POST',body:{name:'Дубль',email:' ACCOUNT@TEST.KZ ',password}})).status,409);
  for(const body of [{name:'',email:'test@t.kz',password},{name:' ',email:'test@t.kz',password},
    {name:'Тест',email:'bad',password},{name:'Тест',email:'t@t.kz',password:'123'},
    {name:'Тест',email:'t@t.kz',password:'я'.repeat(40)},{name:'Тест',email:'t@t.kz',password:{}}]) {
    assert.equal((await send('/api/auth/register',{method:'POST',body})).status,400);
  }
});
test('bcrypt: разные соли, cost 10, compare',async()=>{
  const second=await register('salt@test.kz');
  const {rows}=await fixture.database.query('SELECT password_hash FROM users WHERE id=ANY($1::int[])',[[account.user.id,second.user.id]]);
  assert.notEqual(rows[0].password_hash,rows[1].password_hash);
  for(const user of rows){assert.equal(await bcrypt.compare(password,user.password_hash),true);assert.equal(await bcrypt.compare('wrong',user.password_hash),false);assert.equal(bcrypt.getRounds(user.password_hash),10);}
});
test('вход: одинаковые 401 и корректный JWT HS256 на 2 часа',async()=>{
  const good=await send('/api/auth/login',{method:'POST',body:{email:' ACCOUNT@TEST.KZ ',password}});
  assert.equal(good.status,200);assert.equal('password_hash' in good.data.user,false);
  const decoded=jwt.decode(good.data.token,{complete:true});
  assert.equal(decoded.header.alg,'HS256');assert.equal(decoded.payload.sub,String(account.user.id));
  assert.equal(decoded.payload.exp-decoded.payload.iat,7200);assert.equal('password' in decoded.payload,false);
  const wrong=await send('/api/auth/login',{method:'POST',body:{email:'account@test.kz',password:'wrong'}});
  const absent=await send('/api/auth/login',{method:'POST',body:{email:'absent@test.kz',password:'wrong'}});
  assert.equal(wrong.status,401);assert.equal(absent.status,401);assert.deepEqual(wrong.data,absent.data);
});
test('JWT: подделка роли, неверная подпись, истечение, none, отсутствие',async()=>{
  assert.equal((await send('/api/auth/me')).status,401);
  const me=await send('/api/auth/me',{token:account.token});assert.equal(me.status,200);assert.equal(me.data.id,account.user.id);
  const parts=account.token.split('.');const payload=JSON.parse(Buffer.from(parts[1],'base64url'));
  parts[1]=Buffer.from(JSON.stringify({...payload,role:'admin'})).toString('base64url');
  const expired=jwt.sign({sub:String(account.user.id),role:'user',ver:0},process.env.JWT_SECRET,{expiresIn:-1});
  const wrongKey=jwt.sign({sub:String(account.user.id),role:'admin',ver:0},'wrong-key',{expiresIn:'2h'});
  const noSignature=Buffer.from(JSON.stringify({alg:'none',typ:'JWT'})).toString('base64url')+'.'+parts[1]+'.';
  for(const token of ['broken',parts.join('.'),wrongKey,noSignature])assert.equal((await send('/api/auth/me',{token})).status,401);
  assert.match((await send('/api/auth/me',{token:expired})).data.error,/истёк/);
});
test('все admin-маршруты: гость 401, user 403; каталог открыт',async()=>{
  for(const [method,path,body] of [['POST','/api/products',{name:'Нет',price:1}],['PUT','/api/products/1',{name:'Нет',price:1}],
    ['DELETE','/api/products/1'],['GET','/api/orders'],['PATCH','/api/orders/1',{status:'done'}]]){
    assert.equal((await send(path,{method,body})).status,401);
    assert.equal((await send(path,{method,body,token:account.token})).status,403);
  }
  assert.equal((await send('/api/products')).status,200);assert.equal((await send('/api/products/1')).status,200);
  assert.equal((await send('/api/orders',{token:admin.token})).status,200);
});
test('optionalAuth и /my не раскрывают чужие заявки и не принимают user_id',async()=>{
  const another=await register('another@test.kz');
  const own=await send('/api/orders',{method:'POST',token:account.token,body:{name:'Тест',email:'t@t.kz',quantity:20,user_id:another.user.id}});
  assert.equal(own.status,201);assert.equal(own.data.user_id,account.user.id);
  const guest=await send('/api/orders',{method:'POST',body:{name:'Гость',email:'t@t.kz',quantity:20,user_id:account.user.id}});
  assert.equal(guest.status,201);assert.equal(guest.data.user_id,null);
  assert.equal((await send('/api/orders/my')).status,401);
  const mine=await send('/api/orders/my',{token:account.token});assert.equal(mine.status,200);assert.deepEqual(mine.data.map(o=>o.id),[own.data.id]);
  assert.deepEqual((await send('/api/orders/my',{token:another.token})).data,[]);
  assert.equal((await send('/api/orders',{method:'POST',token:'broken',body:{name:'Тест',email:'t@t.kz',quantity:20}})).status,401);
});
test('смена пароля: проверка старого, новый bcrypt и отзыв старого JWT',async()=>{
  const subject=await register('password@test.kz');
  const patch=body=>send('/api/auth/password',{method:'PATCH',body,token:subject.token});
  assert.equal((await patch({oldPassword:'wrong',newPassword:'New-pass-123'})).status,400);
  assert.equal((await patch({oldPassword:password,newPassword:'123'})).status,400);
  const changed=await patch({oldPassword:password,newPassword:'New-pass-123'});
  assert.equal(changed.status,200);assert.equal('password_hash' in changed.data.user,false);
  assert.equal((await send('/api/auth/me',{token:subject.token})).status,401);
  assert.equal((await send('/api/auth/me',{token:changed.data.token})).status,200);
  const instance=await start();
  try{
    assert.equal((await send('/api/auth/login',{url:instance.base,method:'POST',body:{email:subject.user.email,password}})).status,401);
    assert.equal((await send('/api/auth/login',{url:instance.base,method:'POST',body:{email:subject.user.email,password:'New-pass-123'}})).status,200);
  }finally{await close(instance.server);}
});
test('удалённый пользователь и устаревшая роль не дают доступ',async()=>{
  const subject=await register('deleted@test.kz');
  await fixture.database.query('DELETE FROM users WHERE id=$1',[subject.user.id]);
  assert.equal((await send('/api/auth/me',{token:subject.token})).status,401);
  const current=await register('demoted@test.kz');
  const signed=jwt.sign({sub:String(current.user.id),role:'admin',ver:0},process.env.JWT_SECRET,{expiresIn:'2h'});
  assert.equal((await send('/api/orders',{token:signed})).status,403);
});
test('limiter: 6-й неверный вход 429, успешные входы не считаются',async()=>{
  const instance=await start();
  try{
    for(let i=0;i<6;i++)assert.equal((await send('/api/auth/login',{url:instance.base,method:'POST',body:{email:process.env.ADMIN_EMAIL,password:process.env.ADMIN_PASSWORD}})).status,200);
    for(let i=0;i<5;i++)assert.equal((await send('/api/auth/login',{url:instance.base,method:'POST',body:{email:'nobody@test.kz',password:'wrong'}})).status,401);
    const blocked=await send('/api/auth/login',{url:instance.base,method:'POST',body:{email:'nobody@test.kz',password:'wrong'}});
    assert.equal(blocked.status,429);assert.ok(blocked.response.headers.get('ratelimit'));assert.ok(Number(blocked.response.headers.get('retry-after'))>0);
  }finally{await close(instance.server);}
});
test('helmet, CORS preflight, JSON 400, 10 КБ 413 и отсутствие JWT_SECRET',async()=>{
  const response=await fetch(base+'/api/health');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.equal(response.headers.get('x-frame-options'),'SAMEORIGIN');
  const options=await fetch(base+'/api/products',{method:'OPTIONS',headers:{Origin:'http://localhost:5173','Access-Control-Request-Method':'POST','Access-Control-Request-Headers':'authorization,content-type'}});
  assert.equal(options.status,204);assert.match(options.headers.get('access-control-allow-headers'),/authorization/);assert.equal(options.headers.get('access-control-allow-origin'),'http://localhost:5173');
  const broken=await fetch(base+'/api/auth/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{"email":"a@a.kz",'});assert.equal(broken.status,400);
  assert.equal((await send('/api/auth/register',{method:'POST',body:{name:'x'.repeat(11000)}})).status,413);
  assert.throws(()=>getAuthConfig({}),/JWT_SECRET/);assert.throws(()=>getAuthConfig({JWT_SECRET:'change-me'}),/JWT_SECRET/);
});
test('30-секундный токен истекает после реального ожидания',async()=>{
  const token=jwt.sign({sub:String(account.user.id),role:'user',ver:0},process.env.JWT_SECRET,{expiresIn:'30s'});
  const decoded=jwt.decode(token);assert.equal(decoded.exp-decoded.iat,30);
  assert.equal((await send('/api/auth/me',{token})).status,200);
  await delay(31000);
  const expired=await send('/api/auth/me',{token});assert.equal(expired.status,401);assert.match(expired.data.error,/истёк/);
});
