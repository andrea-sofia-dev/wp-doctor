// Runs the real collector against fake sites on localhost:
// - "/" behaves like a well-cached WordPress site with a sitemap and real 404s
// - in strict mode the same site skips its cache for cookies, UTM parameters and phones, and its 404s are soft and long-cached
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { collect } from '../src/collect.js';
import { runChecks } from '../src/checks.js';

const page = banner => `<!doctype html><html><head>
<meta name="viewport" content="width=device-width, initial-scale=1">
<link rel="stylesheet" href="/wp-content/themes/t/style.css">
<link rel="preload" as="image" href="/hero.webp">
${banner}
</head><body><h1>Hello</h1></body></html>`;

let server;
let base;
const seenCookies = [];
let strictMode = false;

before(async () => {
  server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const strict = strictMode;
    const mobile = /Mobile/.test(req.headers['user-agent'] || '');
    if (req.headers.cookie) seenCookies.push(req.headers.cookie);
    res.setHeader('content-type', 'text/html; charset=utf-8');

    if (url.pathname === '/robots.txt') {
      res.setHeader('content-type', 'text/plain');
      return res.end(`Sitemap: ${base}/wp-sitemap.xml\n`);
    }
    if (url.pathname === '/wp-sitemap.xml') {
      res.setHeader('content-type', 'application/xml');
      return res.end(`<?xml version="1.0"?><sitemapindex><sitemap><loc>${base}/wp-sitemap-posts-post-1.xml</loc></sitemap></sitemapindex>`);
    }
    if (url.pathname === '/wp-sitemap-posts-post-1.xml') {
      res.setHeader('content-type', 'application/xml');
      return res.end(`<?xml version="1.0"?><urlset><url><loc>${base}/a/</loc></url><url><loc>${base}/b/</loc></url><url><loc>${base}/c/</loc></url><url><loc>${base}/d/</loc></url></urlset>`);
    }
    if (url.pathname.includes('wp-doctor-missing')) {
      if (strict) {
        res.statusCode = 200;
        res.setHeader('cf-cache-status', 'HIT');
        return res.end(page(''));
      }
      res.statusCode = 404;
      res.setHeader('cache-control', 'max-age=60');
      res.setHeader('cf-cache-status', 'MISS');
      return res.end('not found');
    }
    const bypass = strict && (req.headers.cookie || url.searchParams.has('utm_source') || mobile);
    res.setHeader('cf-cache-status', bypass ? 'BYPASS' : 'HIT');
    res.end(page('<script src="https://cdn.iubenda.com/cs/iubenda_cs.js"></script><script>var _iub = {csConfiguration:{"siteId":12345}}</script>'));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

test('a well-cached site passes, with the banner cookie, phones, other pages and real 404s', async () => {
  const data = await collect(`${base}/`, { pages: 3 });
  const results = Object.fromEntries(runChecks(data).map(r => [r.id, r]));
  assert.equal(data.consent.name, 'iubenda');
  assert.ok(seenCookies.some(c => c.startsWith('_iub_cs-12345=')), 'sent the iubenda consent cookie');
  assert.equal(results['page-cache'].status, 'pass');
  assert.match(results['page-cache'].summary, /iubenda/);
  assert.equal(results['mobile-cache'].status, 'pass');
  assert.equal(results['site-pages'].status, 'pass');
  assert.equal(data.pages.length, 3);
  assert.equal(results['not-found'].status, 'pass');
});

test('a cache that skips banner cookies, UTM visits and phones, with soft 404s, is flagged', async () => {
  strictMode = true;
  const results = Object.fromEntries(runChecks(await collect(`${base}/strict`, { pages: 0 })).map(r => [r.id, r]));
  strictMode = false;
  assert.equal(results['page-cache'].status, 'warn');
  assert.match(results['page-cache'].summary, /iubenda banner skip the cache/);
  assert.match(results['page-cache'].summary, /utm/i);
  assert.equal(results['mobile-cache'].status, 'warn');
  assert.equal(results['not-found'].status, 'fail');
  assert.equal(results['site-pages'].status, 'info');
});
