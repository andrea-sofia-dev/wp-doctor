// Runs the real collector against two fake sites on localhost: one that behaves
// like a well-cached WordPress site, one that bypasses its cache for cookies and UTM.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { collect } from '../src/collect.js';
import { runChecks } from '../src/checks.js';

const PAGE = `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/wp-content/themes/t/style.css">
<link rel="preload" as="image" href="/hero.webp">
</head><body><h1>Hello</h1></body></html>`;

let server;
let base;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const strict = url.pathname.startsWith('/strict');
    const bypass = strict && (req.headers.cookie || url.searchParams.has('utm_source'));
    res.setHeader('content-type', 'text/html; charset=utf-8');
    res.setHeader('cf-cache-status', bypass ? 'BYPASS' : 'HIT');
    res.end(PAGE);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('a well-cached site passes the cache check', async () => {
  const results = runChecks(await collect(`${base}/`));
  const cache = results.find(r => r.id === 'page-cache');
  assert.equal(cache.status, 'pass');
  assert.equal(results.find(r => r.id === 'viewport').status, 'pass');
  assert.equal(results.find(r => r.id === 'lcp-hint').status, 'pass');
});

test('a cache that skips cookies and UTM visits is flagged', async () => {
  const cache = runChecks(await collect(`${base}/strict`)).find(r => r.id === 'page-cache');
  assert.equal(cache.status, 'warn');
  assert.match(cache.summary, /cookie/);
  assert.match(cache.summary, /utm/i);
});
