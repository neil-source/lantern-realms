const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const { server, safeFile } = require('./server.cjs');

test('blocks path traversal', () => assert.equal(safeFile('/../package.json'), null));
test('serves the playable page and health endpoint', async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const get = route => new Promise((resolve,reject) => http.get(`http://127.0.0.1:${port}${route}`, r => { let body=''; r.on('data',d=>body+=d); r.on('end',()=>resolve({status:r.statusCode,body})); }).on('error',reject));
  const [page, health] = await Promise.all([get('/'),get('/health')]);
  assert.equal(page.status,200); assert.match(page.body,/Lantern Realms/);
  assert.equal(health.status,200); assert.equal(JSON.parse(health.body).ok,true);
  await new Promise(resolve => server.close(resolve));
});
