import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { collect } from '../src/collect.js';
import { timedFetch } from '../src/http.js';
import { findChrome, launchBrowser } from '../src/browser.js';

function serve(handler) {
  const server = createServer(handler).listen(0, '127.0.0.1');
  return new Promise((r) => server.once('listening', () => r({ server, base: `http://127.0.0.1:${server.address().port}` })));
}

const page = '<!doctype html><html><head><meta name="viewport" content="width=device-width"><title>t</title></head><body>hello</body></html>';

test('a site that lets the first visits in and then rate-limits is reported as blocked', async (t) => {
  let n = 0;
  const { server, base } = await serve((req, res) => {
    n += 1;
    if (n > 2) return res.writeHead(429, { 'content-type': 'text/html' }).end('<h1>Too many requests</h1>');
    res.writeHead(200, { 'content-type': 'text/html' }).end(page);
  });
  t.after(() => server.close());
  const data = await collect(`${base}/`, { pages: 0 });
  assert.equal(data.blocked, true);
  assert.equal(data.warm.status, 429);
});

test('browser mode answers like a plain request, and sends only the page', { skip: !findChrome() && 'Chrome is not installed' }, async (t) => {
  const seen = [];
  const { server, base } = await serve((req, res) => {
    seen.push({ url: req.url, ua: req.headers['user-agent'], cookie: req.headers.cookie });
    if (req.url === '/old') return res.writeHead(301, { location: '/' }).end();
    if (req.url === '/') {
      return res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'x-cache': 'HIT' })
        .end(page.replace('</head>', '<link rel="stylesheet" href="/style.css"><script src="/app.js"></script></head>'));
    }
    res.writeHead(404).end();
  });
  const chrome = await launchBrowser();
  t.after(async () => {
    await chrome.close();
    server.close();
  });

  const plain = await timedFetch(`${base}/old`);
  const viaBrowser = await timedFetch(`${base}/old`, { transport: chrome.transport, headers: { cookie: 'consent=yes' } });
  assert.equal(viaBrowser.status, plain.status);
  assert.equal(viaBrowser.url, plain.url);
  assert.equal(viaBrowser.body, plain.body);
  assert.equal(viaBrowser.headers['x-cache'], 'HIT');
  assert.ok(viaBrowser.ttfbMs >= 0);

  const fromBrowser = seen.slice(2);
  assert.deepEqual(fromBrowser.map((r) => r.url), ['/old', '/'], 'no stylesheet, script or favicon requests');
  assert.match(fromBrowser[0].ua, /Chrome\/\d+.* wp-doctor\//);
  assert.doesNotMatch(fromBrowser[0].ua, /Headless/);
  assert.equal(fromBrowser[1].cookie, 'consent=yes');
});
