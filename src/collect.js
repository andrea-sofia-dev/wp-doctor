import { timedFetch, withParams } from './http.js';
import { consentCookie } from './consent.js';
import { samplePages } from './sitemap.js';
import { wordpressBase } from './wpbase.js';
import { reachability } from './checks.js';

export const MOBILE_UA =
  'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36 wp-doctor';

// One set of requests shared by every check, so each check stays a pure function.
// All requests are plain GETs, sent one after the other to stay polite.
// - first / warm: the URL twice; a working page cache serves the second
// - cookie: the consent cookie of the site's own banner (almost every real visitor has it)
// - utm: campaign parameters with a fresh value, like every ad or newsletter click
// - mobileFirst / mobileWarm: the same visit from a phone
// - notFound / notFoundWarm: a page that cannot exist, twice
// - pages: a few other pages from the sitemap, twice each
export async function collect(url, { timeoutMs, pages = 3 } = {}) {
  const opts = { timeoutMs };
  const first = await timedFetch(url, opts);
  const target = first.url;
  const warm = await timedFetch(target, opts);

  // A site that refuses the first two requests gets no more: the checks stop at "reachability".
  if (reachability({ first, warm })) return { url: target, first, warm, blocked: true, pages: [] };

  const consent = consentCookie(first.body);
  const cookie = await timedFetch(target, { ...opts, headers: { cookie: consent.cookie } });

  const campaign = `audit-${Date.now().toString(36)}`;
  const utm = await timedFetch(withParams(target, { utm_source: 'wp-doctor', utm_campaign: campaign }), opts);

  const mobileHeaders = { 'user-agent': MOBILE_UA };
  const mobileFirst = await timedFetch(target, { ...opts, headers: mobileHeaders });
  const mobileWarm = await timedFetch(target, { ...opts, headers: mobileHeaders });

  const base = wordpressBase(first.body, target);
  const missing = new URL(`wp-doctor-missing-${campaign}/`, base).toString();
  const notFound = await safeFetch(missing, opts);
  const notFoundWarm = notFound ? await safeFetch(missing, opts) : null;

  const pageResults = [];
  for (const pageUrl of await samplePages(base, pages, opts)) {
    const p1 = await safeFetch(pageUrl, opts);
    const p2 = p1 ? await safeFetch(pageUrl, opts) : null;
    if (p1 && p2) pageResults.push({ url: pageUrl, first: p1, warm: p2 });
  }

  return { url: target, first, warm, cookie, consent, utm, mobileFirst, mobileWarm, notFound, notFoundWarm, pages: pageResults };
}

// Secondary requests must never sink the whole audit.
async function safeFetch(url, opts) {
  try {
    return await timedFetch(url, opts);
  } catch {
    return null;
  }
}
