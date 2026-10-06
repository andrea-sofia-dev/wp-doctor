#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { collect } from '../src/collect.js';
import { runChecks } from '../src/checks.js';
import { isWordPress } from '../src/html.js';
import { textReport, jsonReport } from '../src/report.js';
import { htmlReport, defaultReportName } from '../src/html-report.js';

const HELP = `Usage: wp-doctor <url> [--json] [--html[=file]] [--pages=N]

Checks a WordPress site from the outside, the way real visitors reach it: page cache
after accepting the cookie banner, with UTM parameters and on phones, other pages
from the sitemap, missing pages (404), server response time, compression, viewport
tag position, main image priority, render-blocking files, reCAPTCHA, plugin files.

Options:
  --json         print the results as JSON
  --html         also save a self-contained HTML report (wp-doctor-<site>-<date>.html)
  --html=file    save the HTML report with that name
  --pages=N      also check N pages from the sitemap (default 3, 0 to skip)
  --help         show this help
  --version      show the version

Exit code: 0 if nothing failed, 1 if a check failed, 2 if the site could not be checked.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(HELP);
  process.exit(args.length === 0 ? 2 : 0);
}
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
if (args.includes('--version')) {
  console.log(pkg.version);
  process.exit(0);
}

const asJson = args.includes('--json');
const htmlArg = args.find(a => a === '--html' || a.startsWith('--html='));
let url = args.find(a => !a.startsWith('--'));
if (!url) {
  console.error('wp-doctor: missing <url>. Try --help.');
  process.exit(2);
}
if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

try {
  const pagesArg = args.find(a => a.startsWith('--pages='));
  const pages = pagesArg ? Math.max(0, Math.min(20, Number(pagesArg.slice(8)) || 0)) : 3;
  const data = await collect(url, { pages });
  const results = runChecks(data);
  // An error page says nothing about the platform: skip the "not WordPress" note when blocked.
  const isWp = data.blocked || isWordPress(data.warm.body, data.warm.headers);
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  console.log(asJson ? jsonReport(data.url, results, { isWp }) : textReport(data.url, results, { color, isWp }));

  if (htmlArg) {
    const file = resolve(htmlArg.includes('=') ? htmlArg.slice('--html='.length) : defaultReportName(data.url));
    writeFileSync(file, htmlReport(data.url, results, { isWp, version: pkg.version }));
    // Keep stdout clean for --json: the report path goes to stderr.
    console.error(`HTML report saved to ${file}`);
  }
  if (data.blocked) process.exit(2); // the site could not be checked
  process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
} catch (err) {
  console.error(`wp-doctor: could not check ${url}: ${err.cause?.code || err.message}`);
  process.exit(2);
}
