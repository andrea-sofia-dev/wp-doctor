import { timedFetch, withParams } from './http.js';
import { consentCookie } from './consent.js';
import { samplePages } from './sitemap.js';
import { wordpressBase } from './wpbase.js';
import { reachability } from './checks.js';
import { isWordPress } from './html.js';

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
// onStep(name) is called before each group of requests (the web version shows it as progress).
// transport: send the requests through a real browser instead (see collectAuto and src/browser.js).
export async function collect(url, { timeoutMs, pages = 3, onStep = () => {}, transport } = {}) {
  const opts = { timeoutMs, transport };
  onStep('first');
  const first = await timedFetch(url, opts);
  const target = first.url;
  const warm = await timedFetch(target, opts);

  // A site that refuses the first two requests gets no more: the checks stop at "reachability".
  if (reachability({ first, warm })) return { url: target, first, warm, blocked: true, pages: [] };

  onStep('cookie');
  const consent = consentCookie(first.body);
  const cookie = await timedFetch(target, { ...opts, headers: { cookie: consent.cookie } });

  onStep('utm');
  const campaign = `audit-${Date.now().toString(36)}`;
  const utm = await timedFetch(withParams(target, { utm_source: 'wp-doctor', utm_campaign: campaign }), opts);

  onStep('mobile');
  const mobileHeaders = { 'user-agent': MOBILE_UA };
  const mobileFirst = await timedFetch(target, { ...opts, headers: mobileHeaders });
  const mobileWarm = await timedFetch(target, { ...opts, headers: mobileHeaders });

  // Some protections let the first requests through and block the next ones (rate limits, 429):
  // the main visits must all be the real page, or the checks would describe an error page.
  const refused = [cookie, utm, mobileFirst, mobileWarm].find(r => reachability({ first, warm: r }));
  if (refused) return { url: target, first, warm: refused, blocked: true, pages: [] };

  onStep('notFound');
  const base = wordpressBase(first.body, target);
  // On WordPress, next to the install; elsewhere, in the section being checked (example.com/it/it/ → /it/it/…):
  // a missing page at the domain root may be handled by something else, like a redirect to a language home.
  const isWpFirst = isWordPress(first.body, first.headers);
  const missing = new URL(`wp-doctor-missing-${campaign}/`, isWpFirst ? base : sectionOf(target)).toString();
  const notFound = await safeFetch(missing, opts);
  const notFoundWarm = notFound ? await safeFetch(missing, opts) : null;

  onStep('pages');
  const pageResults = [];
  for (const pageUrl of await samplePages(base, pages, opts)) {
    const p1 = await safeFetch(pageUrl, opts);
    const p2 = p1 ? await safeFetch(pageUrl, opts) : null;
    if (p1 && p2) pageResults.push({ url: pageUrl, first: p1, warm: p2 });
  }

  const isWp = isWordPress(first.body, first.headers) || isWordPress(warm.body, warm.headers);
  return { url: target, isWp, first, warm, cookie, consent, utm, mobileFirst, mobileWarm, notFound, notFoundWarm, pages: pageResults };
}

// Plain requests first; if the site refuses them, the same checks again through a real browser.
// browser: 'auto' (fall back when blocked), 'always', or 'never'. launch() returns { executablePath, args }.
export async function collectAuto(url, { browser = 'auto', launch, onBrowser = () => {}, ...options } = {}) {
  if (browser !== 'always') {
    const data = await collect(url, options);
    if (!data.blocked || browser === 'never') return { ...data, mode: 'plain' };
    onBrowser();
  }
  const { launchBrowser } = await import('./browser.js');
  let chrome;
  try {
    chrome = await launchBrowser(launch ? await launch() : {});
  } catch (error) {
    // No browser here: in auto mode, keep the "blocked" answer and say why there was no second try.
    if (browser === 'always') throw error;
    return { ...(await collect(url, { ...options, pages: 0 })), mode: 'plain', browserUnavailable: error.message };
  }
  try {
    return { ...(await collect(url, { ...options, transport: chrome.transport })), mode: 'browser' };
  } finally {
    await chrome.close();
  }
}

// The folder of a page: /it/it → /it/it/, /blog/post.html → /blog/.
function sectionOf(pageUrl) {
  const u = new URL(pageUrl);
  u.search = '';
  u.hash = '';
  const last = u.pathname.split('/').pop();
  if (last.includes('.')) return new URL('./', u).toString();
  if (!u.pathname.endsWith('/')) u.pathname += '/';
  return u.toString();
}

// Secondary requests must never sink the whole audit.
async function safeFetch(url, opts) {
  try {
    return await timedFetch(url, opts);
  } catch {
    return null;
  }
}
