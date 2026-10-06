#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { collect } from '../src/collect.js';
import { runChecks } from '../src/checks.js';
import { isWordPress } from '../src/html.js';
import { textReport, jsonReport } from '../src/report.js';

const HELP = `Usage: wp-doctor <url> [--json]

Checks a WordPress site from the outside: server response time, page cache
(also for visitors with cookies or UTM parameters), compression, the position
of the viewport tag, main image priority, render-blocking files, reCAPTCHA and
plugin files.

Options:
  --json      print the results as JSON
  --help      show this help
  --version   show the version

Exit code: 0 if nothing failed, 1 if a check failed, 2 if the site could not be checked.`;

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h') || args.length === 0) {
  console.log(HELP);
  process.exit(args.length === 0 ? 2 : 0);
}
if (args.includes('--version')) {
  const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
  console.log(pkg.version);
  process.exit(0);
}

const asJson = args.includes('--json');
let url = args.find(a => !a.startsWith('--'));
if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

try {
  const data = await collect(url);
  const results = runChecks(data);
  const isWp = isWordPress(data.warm.body, data.warm.headers);
  const color = process.stdout.isTTY && !process.env.NO_COLOR;
  console.log(asJson ? jsonReport(data.url, results, { isWp }) : textReport(data.url, results, { color, isWp }));
  process.exit(results.some(r => r.status === 'fail') ? 1 : 0);
} catch (err) {
  console.error(`wp-doctor: could not check ${url}: ${err.cause?.code || err.message}`);
  process.exit(2);
}
