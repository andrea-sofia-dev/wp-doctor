// The web version of wp-doctor: one request in, the same checks as the CLI out.
// GET /api/check?url=example.com answers with newline-delimited JSON, so the page can show progress:
//   {"type":"step","step":"first"} ... {"type":"result", ...}   or   {"type":"error","message":"..."}
// Written against the standard Request/Response API: it runs on Vercel and in web/dev-server.js.

import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { collectAuto } from '../src/collect.js';
import { runChecks } from '../src/checks.js';
import { EXPLANATIONS } from '../src/explain.js';
import { isWordPress } from '../src/html.js';
import { setUrlGuard } from '../src/http.js';
import pkg from '../package.json' with { type: 'json' };

setUrlGuard(assertPublic);

// Each analysis sends ~20 requests to the target: a public tool must not become a way to flood a site.
const LIMIT = { perWindow: 10, windowMs: 10 * 60 * 1000 };
const CACHE_MS = 10 * 60 * 1000; // the same site checked again within 10 minutes gets the stored result
const recent = new Map(); // ip -> timestamps of recent analyses
const results = new Map(); // normalised url -> { at, payload }

export async function handleCheck(request) {
  const params = new URL(request.url).searchParams;
  let target;
  try {
    target = await checkTarget(params.get('url') || '');
  } catch (error) {
    return json({ type: 'error', message: error.message }, 400);
  }

  const cached = results.get(target);
  if (cached && Date.now() - cached.at < CACHE_MS) return stream(async (send) => send({ ...cached.payload, cached: true }));

  const ip = clientIp(request);
  const waitMs = allow(ip);
  if (waitMs) {
    const minutes = Math.max(1, Math.ceil(waitMs / 60000));
    return json({ type: 'error', message: `${LIMIT.perWindow} checks in 10 minutes is the limit for one connection: try again in ${minutes} minute${minutes > 1 ? 's' : ''}, or run wp-doctor in your terminal (no limits).` }, 429);
  }

  return stream(async (send) => {
    try {
      const data = await collectAuto(target, {
        pages: 3,
        timeoutMs: 15000,
        launch: launchOptions,
        onStep: (step) => send({ type: 'step', step }),
        onBrowser: () => send({ type: 'step', step: 'browser' }),
      });
      const checks = runChecks(data);
      const isWp = data.blocked || isWordPress(data.warm.body, data.warm.headers);
      const payload = {
        type: 'result',
        url: data.url,
        isWp,
        blocked: Boolean(data.blocked),
        mode: data.mode,
        version: pkg.version,
        checkedAt: new Date().toISOString(),
        // A blocked site was not measured: no score, rather than a 0 that reads as a verdict on the site.
        score: data.blocked ? null : score(checks),
        cacheUnverified: cacheUnverified(checks),
        results: checks.map((r) => ({ ...r, explain: EXPLANATIONS[r.id] ?? null })),
      };
      if (!data.blocked) results.set(target, { at: Date.now(), payload });
      send(payload);
    } catch (error) {
      send({ type: 'error', message: describe(error) });
    }
  });
}

// On Vercel, a Chromium built for serverless functions; locally, the Chrome installed on the computer.
async function launchOptions() {
  if (!process.env.VERCEL) return {};
  const { default: chromium } = await import('@sparticuz/chromium');
  return { executablePath: await chromium.executablePath(), args: chromium.args };
}

// ---------- the address ----------

class NotPublic extends Error {}

// The typed address: add https:// if missing, then the same rules as every request.
async function checkTarget(input) {
  let text = input.trim();
  if (!text) throw new NotPublic('Enter the address of a site, e.g. example.com');
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(text) && !/^https?:\/\//i.test(text)) throw new NotPublic('Only http and https addresses can be checked.');
  if (!/^https?:\/\//i.test(text)) text = `https://${text}`;
  let url;
  try {
    url = new URL(text);
  } catch {
    throw new NotPublic('That is not a web address. Try something like example.com');
  }
  await assertPublic(url);
  url.hash = '';
  return url.toString();
}

// Only public web sites: no IP addresses, no local names, nothing that resolves to a private network.
// Runs before every request of an analysis, redirects included (see setUrlGuard in src/http.js).
async function assertPublic(address) {
  const url = new URL(address);
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (!/^https?:$/.test(url.protocol) || url.username || url.password) throw new NotPublic('Only http and https addresses can be checked.');
  if (url.port && !['80', '443'].includes(url.port)) throw new NotPublic('Only the standard web ports (80 and 443) can be checked.');
  if (isIP(host) || !host.includes('.') || /\.(local|localhost|internal|lan|home|corp)$/i.test(host)) {
    throw new NotPublic('Enter the domain name of a public site (IP addresses and local names are not checked).');
  }
  const addresses = await resolve(host);
  if (addresses.some((a) => isPrivate(a.address))) throw new NotPublic('That domain points to a private network address.');
}

const dns = new Map(); // host -> { at, addresses }
async function resolve(host) {
  const hit = dns.get(host);
  if (hit && Date.now() - hit.at < 60_000) return hit.addresses;
  let addresses;
  try {
    addresses = await lookup(host, { all: true });
  } catch {
    throw new NotPublic('That domain does not exist: check the address.');
  }
  if (dns.size > 2000) dns.clear();
  dns.set(host, { at: Date.now(), addresses });
  return addresses;
}

function isPrivate(ip) {
  if (ip.includes(':')) {
    const v6 = ip.toLowerCase();
    const mapped = v6.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivate(mapped[1]);
    return v6 === '::1' || v6 === '::' || /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6);
  }
  const [a, b] = ip.split('.').map(Number);
  return a === 0 || a === 10 || a === 127 || a >= 224 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

// ---------- fairness ----------

function clientIp(request) {
  const forwarded = request.headers.get('x-forwarded-for');
  return (forwarded ? forwarded.split(',')[0] : request.headers.get('x-real-ip') || 'local').trim();
}

// 0 when the check can run, otherwise how long until the oldest check in the window expires.
function allow(ip) {
  const now = Date.now();
  const times = (recent.get(ip) || []).filter((t) => now - t < LIMIT.windowMs);
  if (times.length >= LIMIT.perWindow) return times[0] + LIMIT.windowMs - now;
  times.push(now);
  recent.set(ip, times);
  // Keep the maps small on a long-lived instance.
  if (recent.size > 5000) recent.clear();
  if (results.size > 500) results.clear();
  return 0;
}

// ---------- answers ----------

// 0-100: passed checks count fully, warnings half; "info" results don't count.
// The cache checks weigh more: they are what wp-doctor is for, and what PageSpeed does not see.
const WEIGHTS = { 'page-cache': 3, 'server-response': 2, 'mobile-cache': 2, 'site-pages': 2 };
// When the page cache cannot be verified from outside, a perfect score would claim more than was checked.
export const UNVERIFIED_CAP = 80;

export function score(checks) {
  const counted = checks.filter((c) => c.status !== 'info');
  if (!counted.length) return null;
  const weight = (c) => WEIGHTS[c.id] ?? 1;
  const total = counted.reduce((sum, c) => sum + weight(c), 0);
  const points = counted.reduce((sum, c) => sum + weight(c) * (c.status === 'pass' ? 1 : c.status === 'warn' ? 0.5 : 0), 0);
  const value = Math.round((points / total) * 100);
  return cacheUnverified(checks) ? Math.min(value, UNVERIFIED_CAP) : value;
}

export function cacheUnverified(checks) {
  return checks.some((c) => c.id === 'page-cache' && c.status === 'info');
}

function describe(error) {
  if (error instanceof NotPublic) return `The site sent wp-doctor somewhere it does not go. ${error.message}`;
  if (error.name === 'TimeoutError') return 'The site did not answer within 15 seconds: it may be down, very slow, or dropping automated requests.';
  if (/redirect count exceeded/i.test(error.cause?.message || error.message)) return 'The site redirects in a loop.';
  const code = error.cause?.code || error.cause?.errors?.[0]?.code;
  if (code === 'ECONNREFUSED') return 'The site refused the connection.';
  if (code && /CERT|SSL|TLS/i.test(code)) return 'The site has a certificate problem (HTTPS could not be verified).';
  return 'The site could not be reached.';
}

function json(body, status) {
  return new Response(`${JSON.stringify(body)}\n`, {
    status,
    headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' },
  });
}

function stream(run) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    async start(controller) {
      const send = (obj) => controller.enqueue(encoder.encode(`${JSON.stringify(obj)}\n`));
      await run(send);
      controller.close();
    },
  });
  return new Response(body, {
    headers: {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    },
  });
}
