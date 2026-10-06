import { test } from 'node:test';
import assert from 'node:assert/strict';
import { htmlReport, escapeHtml, defaultReportName } from '../src/html-report.js';

const results = [
  { id: 'a', title: 'Page cache', status: 'pass', summary: 'Served from cache.', details: [] },
  { id: 'b', title: 'Viewport meta tag', status: 'fail', summary: 'Missing <meta name="viewport">', details: ['<script>alert(1)</script>'], fix: 'Add it & retest' },
];

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<a href="x">&</a>'), '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;');
});

test('the report is self-contained and escapes page content', () => {
  const html = htmlReport('https://example.com/', results, { checkedAt: new Date('2026-10-06T08:00:00Z'), version: '0.2.0' });
  assert.match(html, /^<!doctype html>/);
  assert.doesNotMatch(html, /<script/i, 'no script tags, not even from page content');
  assert.doesNotMatch(html, /<link\b/i, 'no external stylesheets');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(html, /1 failed/);
  assert.ok(html.indexOf('Viewport meta tag') < html.indexOf('Page cache'), 'failures come first');
});

test('default file name uses the host and the date', () => {
  assert.equal(defaultReportName('https://www.example.com/news/', new Date('2026-10-06T10:00:00Z')), 'wp-doctor-www.example.com-2026-10-06.html');
});
