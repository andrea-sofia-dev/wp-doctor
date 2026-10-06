import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createServer } from '../src/mcp.js';
import { EXPLANATIONS } from '../src/explain.js';
import { ALL_CHECKS } from '../src/checks.js';

const fakeCheck = async url => ({
  finalUrl: url,
  isWp: true,
  results: [{ id: 'page-cache', title: 'Page cache', status: 'warn', summary: 'UTM skips the cache.', details: [], fix: 'Ignore utm_*.' }],
});

test('initialize answers with a supported protocol version and the tools capability', async () => {
  const handle = createServer({ version: '9.9.9', check: fakeCheck });
  const res = await handle({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } });
  assert.equal(res.result.protocolVersion, '2025-06-18');
  assert.ok(res.result.capabilities.tools);
  assert.equal(res.result.serverInfo.version, '9.9.9');
  const unknown = await handle({ jsonrpc: '2.0', id: 2, method: 'initialize', params: { protocolVersion: '1999-01-01' } });
  assert.match(unknown.result.protocolVersion, /^\d{4}-\d{2}-\d{2}$/);
});

test('notifications get no response, unknown methods get -32601', async () => {
  const handle = createServer({ check: fakeCheck });
  assert.equal(await handle({ jsonrpc: '2.0', method: 'notifications/initialized' }), null);
  const res = await handle({ jsonrpc: '2.0', id: 3, method: 'resources/list' });
  assert.equal(res.error.code, -32601);
});

test('tools/list exposes the three tools with input schemas', async () => {
  const handle = createServer({ check: fakeCheck });
  const { result } = await handle({ jsonrpc: '2.0', id: 4, method: 'tools/list' });
  assert.deepEqual(result.tools.map(t => t.name), ['check_site', 'list_checks', 'explain_check']);
  for (const t of result.tools) assert.equal(t.inputSchema.type, 'object');
});

test('check_site returns a text report and JSON; bad input is a tool error, not a crash', async () => {
  const handle = createServer({ check: fakeCheck });
  const ok = await handle({ jsonrpc: '2.0', id: 5, method: 'tools/call', params: { name: 'check_site', arguments: { url: 'example.com' } } });
  assert.equal(ok.result.isError, false);
  assert.match(ok.result.content[0].text, /https:\/\/example\.com/);
  assert.equal(JSON.parse(ok.result.content[1].text).results[0].id, 'page-cache');
  const bad = await handle({ jsonrpc: '2.0', id: 6, method: 'tools/call', params: { name: 'check_site', arguments: {} } });
  assert.equal(bad.result.isError, true);
});

test('every check has an explanation, and explain_check returns fixes', async () => {
  const ids = ALL_CHECKS.map(fn => fn({ first: r(), warm: r(), cookie: r(), utm: r() }).id);
  for (const id of ids) assert.ok(EXPLANATIONS[id], `missing explanation for ${id}`);
  const handle = createServer({ check: fakeCheck });
  const { result } = await handle({ jsonrpc: '2.0', id: 7, method: 'tools/call', params: { name: 'explain_check', arguments: { id: 'page-cache' } } });
  assert.match(result.content[0].text, /wp_cache_not_logged_in = 2/);
});

test('the stdio server speaks newline-delimited JSON-RPC', async () => {
  const bin = fileURLToPath(new URL('../bin/wp-doctor-mcp.js', import.meta.url));
  const child = spawn(process.execPath, [bin], { stdio: ['pipe', 'pipe', 'inherit'] });
  const responses = [];
  let buf = '';
  const done = new Promise(resolve => {
    child.stdout.on('data', d => {
      buf += d;
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        responses.push(JSON.parse(buf.slice(0, nl)));
        buf = buf.slice(nl + 1);
        if (responses.length === 2) resolve();
      }
    });
  });
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }) + '\n');
  child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }) + '\n');
  await done;
  child.kill();
  assert.equal(responses[0].id, 1);
  assert.equal(responses[1].result.tools.length, 3);
});

function r() {
  return { body: '<head></head>', headers: {}, ttfbMs: 100, totalMs: 100, status: 200 };
}
