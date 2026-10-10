import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { handleCheck, score } from '../web/handler.js';
import { setUrlGuard, timedFetch } from '../src/http.js';

async function ask(url) {
  const response = await handleCheck(new Request(`http://localhost/api/check?url=${encodeURIComponent(url)}`));
  return { status: response.status, body: JSON.parse((await response.text()).trim()) };
}

test('the web version refuses anything that is not a public site', async () => {
  for (const [input, message] of [
    ['', /Enter the address/],
    ['localhost', /domain name of a public site/],
    ['127.0.0.1', /domain name of a public site/],
    ['http://[::1]/', /domain name of a public site/],
    ['intranet.local', /domain name of a public site/],
    ['ftp://example.com', /Only http and https/],
    ['example.com:8080', /standard web ports/],
    ['https://user:pw@example.com', /Only http and https/],
  ]) {
    const { status, body } = await ask(input);
    assert.equal(status, 400, input);
    assert.equal(body.type, 'error');
    assert.match(body.message, message, input);
  }
});

test('score: passed checks count fully, warnings half, info not at all', () => {
  assert.equal(score([{ status: 'pass' }, { status: 'warn' }, { status: 'fail' }, { status: 'info' }]), 50);
  assert.equal(score([{ status: 'pass' }, { status: 'pass' }]), 100);
  assert.equal(score([{ status: 'info' }]), null);
});

test('score: the cache checks weigh more, and an unverified page cache caps the score', () => {
  // page-cache weighs 3: a warning there costs more than a warning on a minor check.
  assert.equal(score([{ id: 'page-cache', status: 'warn' }, { id: 'viewport', status: 'pass' }]), 63);
  assert.equal(score([{ id: 'page-cache', status: 'pass' }, { id: 'viewport', status: 'warn' }]), 88);
  // Everything else passes, but nobody could tell whether pages come from a cache.
  assert.equal(score([{ id: 'page-cache', status: 'info' }, { id: 'viewport', status: 'pass' }, { id: 'compression', status: 'pass' }]), 80);
});

test('with a guard set, every redirect is checked before it is followed', async (t) => {
  const server = createServer((req, res) => {
    if (req.url === '/start') res.writeHead(302, { location: '/private' }).end();
    else res.writeHead(200).end('reached');
  }).listen(0);
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  t.after(() => {
    setUrlGuard(null);
    server.close();
  });

  const seen = [];
  setUrlGuard(async (url) => {
    seen.push(new URL(url).pathname);
    if (url.endsWith('/private')) throw new Error('blocked');
  });
  await assert.rejects(timedFetch(`${base}/start`), /blocked/);
  assert.deepEqual(seen, ['/start', '/private']);

  setUrlGuard(null);
  const res = await timedFetch(`${base}/start`);
  assert.equal(res.body, 'reached');
  assert.equal(res.url, `${base}/private`);
});
