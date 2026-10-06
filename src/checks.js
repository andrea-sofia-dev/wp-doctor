import { cacheVerdict } from './cache.js';
import { extractHead, listTags, pluginAssets } from './html.js';

// Every check takes the collected responses and returns
// { id, title, status: 'pass' | 'warn' | 'fail' | 'info', summary, details: [], fix? }.

const ms = n => `${n} ms`;
const kb = n => `${Math.round(n / 1024)} KB`;

export function serverResponse({ first, warm }) {
  // Thresholds from web.dev: good TTFB is 0.8 s or less, poor is above 1.8 s.
  const t = warm.ttfbMs;
  const status = t <= 800 ? 'pass' : t <= 1800 ? 'warn' : 'fail';
  return {
    id: 'server-response',
    title: 'Server response time',
    status,
    summary: `The HTML starts arriving after ${ms(t)} (repeat visit).`,
    details: [`first request: ${ms(first.ttfbMs)}`],
    fix: status === 'pass' ? undefined : 'Serve pages from a page cache (plugin or CDN) so PHP and the database are skipped for anonymous visitors.',
  };
}

export function pageCache({ first, warm, cookie, utm, consent = { name: null } }) {
  const w = cacheVerdict(warm);
  const c = cacheVerdict(cookie);
  const u = cacheVerdict(utm);
  const details = [
    `repeat visit: ${label(w.hit)} (${ms(warm.ttfbMs)})${w.evidence.length ? ' — ' + w.evidence.join(', ') : ''}`,
    `${consent.name ? `visitor who accepted the ${consent.name} banner` : 'visitor with a cookie'}: ${label(c.hit)} (${ms(cookie.ttfbMs)})`,
    `visit with UTM parameters: ${label(u.hit)} (${ms(utm.ttfbMs)})`,
  ];
  const sources = [...new Set([...w.sources, ...cacheVerdict(first).sources])];
  if (sources.length) details.unshift(`cache layers seen: ${sources.join(', ')}`);

  if (w.hit !== true) {
    // Same "good" threshold as the server response check, so the two never contradict each other.
    const fast = warm.ttfbMs <= 800;
    return {
      id: 'page-cache',
      title: 'Page cache',
      status: w.hit === false ? 'fail' : fast ? 'info' : 'warn',
      summary: w.hit === false
        ? 'Repeat visits are generated from scratch: no page cache is serving this page.'
        : fast
          ? 'No cache headers, but repeat visits are fast: a cache may be in place without announcing itself.'
          : 'No sign of a page cache, and the page is not fast.',
      details,
      fix: w.hit === null && fast
        ? undefined
        : 'Turn on a page cache (WP Super Cache, W3 Total Cache, LiteSpeed Cache, or a CDN rule that caches HTML).',
    };
  }

  const problems = [];
  if (c.hit === false || (c.hit === null && cookie.ttfbMs > warm.ttfbMs * 3 + 200)) {
    problems.push(consent.name
      ? `Visitors who accepted the ${consent.name} banner skip the cache: after the first page, that is almost everyone.`
      : 'Visitors with any cookie skip the cache. With a consent banner that is almost everyone.');
  }
  if (u.hit === false || (u.hit === null && utm.ttfbMs > warm.ttfbMs * 3 + 200)) {
    problems.push('Campaign parameters (utm_*) skip the cache, so ad and newsletter traffic gets the slow page.');
  }
  return {
    id: 'page-cache',
    title: 'Page cache',
    status: problems.length ? 'warn' : 'pass',
    summary: problems.length ? problems.join(' ') : `Repeat visits are served from cache, also ${consent.name ? `after accepting the ${consent.name} banner` : 'with cookies'} and with UTM parameters.`,
    details,
    fix: problems.length
      ? 'Skip the cache only for logged-in users (WP Super Cache: "known users" is too broad), and tell the cache to ignore utm_*, fbclid, gclid and similar parameters.'
      : undefined,
  };
}

export function compression({ warm }) {
  const enc = (warm.headers['content-encoding'] || '').toLowerCase();
  const size = Buffer.byteLength(warm.body);
  if (/br|gzip|zstd|deflate/.test(enc)) {
    return { id: 'compression', title: 'Compression', status: 'pass', summary: `HTML is compressed with ${enc} (${kb(size)} uncompressed).`, details: [] };
  }
  return {
    id: 'compression',
    title: 'Compression',
    status: size > 10 * 1024 ? 'fail' : 'warn',
    summary: `HTML is sent uncompressed (${kb(size)}).`,
    details: [],
    fix: 'Enable gzip or Brotli on the server (mod_deflate on Apache, gzip on nginx) or at the CDN.',
  };
}

export function viewportPosition({ warm }) {
  const tags = listTags(extractHead(warm.body), ['meta', 'link', 'script', 'style']);
  const vp = tags.findIndex(t => t.name === 'meta' && (t.attrs.name || '').toLowerCase() === 'viewport');
  if (vp === -1) {
    return { id: 'viewport', title: 'Viewport meta tag', status: 'fail', summary: 'No <meta name="viewport"> in <head>: phones render the desktop layout.', details: [], fix: 'Add <meta name="viewport" content="width=device-width, initial-scale=1"> at the top of <head>.' };
  }
  const before = tags.slice(0, vp).filter(t =>
    (t.name === 'link' && /stylesheet|preload/i.test(t.attrs.rel || '')) || t.name === 'style');
  if (before.length === 0) {
    return { id: 'viewport', title: 'Viewport meta tag', status: 'pass', summary: 'The viewport tag comes before styles and preloads.', details: [] };
  }
  return {
    id: 'viewport',
    title: 'Viewport meta tag',
    status: 'warn',
    summary: `The viewport tag comes after ${before.length} stylesheet/preload tags. Until a phone reads it, media queries run as if the screen were 980 px wide, so it may download desktop images too.`,
    details: [],
    fix: 'Print the viewport meta first in <head> (in WordPress: re-add the theme\'s wp_head callback with priority 0).',
  };
}

export function lcpHint({ warm }) {
  const tags = listTags(warm.body, ['link', 'img']);
  const preload = tags.some(t => t.name === 'link' && /preload/i.test(t.attrs.rel || '') && (t.attrs.as || '') === 'image');
  const priority = tags.some(t => t.name === 'img' && (t.attrs.fetchpriority || '').toLowerCase() === 'high');
  if (preload || priority) {
    return { id: 'lcp-hint', title: 'Main image priority', status: 'pass', summary: `The page marks an image as important (${[preload && 'preload', priority && 'fetchpriority="high"'].filter(Boolean).join(' and ')}).`, details: [] };
  }
  return {
    id: 'lcp-hint',
    title: 'Main image priority',
    status: 'warn',
    summary: 'No image is preloaded or marked fetchpriority="high". If the largest element above the fold is an image, the browser finds it late.',
    details: [],
    fix: 'Add fetchpriority="high" to the hero image (and remove loading="lazy" from it), or preload it in <head>.',
  };
}

export function renderBlocking({ warm }) {
  const head = listTags(extractHead(warm.body), ['script', 'link']);
  const scripts = head.filter(t =>
    t.name === 'script' && t.attrs.src && !('async' in t.attrs) && !('defer' in t.attrs) &&
    (t.attrs.type || '').toLowerCase() !== 'module');
  const styles = head.filter(t => t.name === 'link' && /stylesheet/i.test(t.attrs.rel || '') && !/print/i.test(t.attrs.media || ''));
  const status = scripts.length > 3 ? 'warn' : 'pass';
  return {
    id: 'render-blocking',
    title: 'Render-blocking files',
    status,
    summary: `${scripts.length} blocking script(s) and ${styles.length} stylesheet(s) in <head>.`,
    details: scripts.slice(0, 8).map(t => `script: ${short(t.attrs.src)}`),
    fix: status === 'pass' ? undefined : 'Add defer to scripts that do not need to run before the page paints, or load them only on the pages that use them.',
  };
}

export function recaptcha({ warm }) {
  const RECAPTCHA = /(google\.com|recaptcha\.net)\/recaptcha\/|gstatic\.com\/recaptcha\//i;
  // Only a <script src> loads it with the page; the same URL inside inline code means a loader
  // that fetches it later (on the first touch of a form, for example), which is the good case.
  const loads = listTags(warm.body, ['script']).some(t => RECAPTCHA.test(t.attrs.src || ''));
  if (!loads) {
    const onDemand = RECAPTCHA.test(warm.body) || /grecaptcha/.test(warm.body);
    return {
      id: 'recaptcha', title: 'reCAPTCHA', status: 'pass',
      summary: onDemand ? 'reCAPTCHA is referenced but not loaded with the page: it is loaded on demand.' : 'reCAPTCHA is not loaded on this page.',
      details: [],
    };
  }
  const hasForm = /<form\b/i.test(warm.body);
  return {
    id: 'recaptcha',
    title: 'reCAPTCHA',
    status: hasForm ? 'info' : 'warn',
    summary: hasForm
      ? 'reCAPTCHA loads with the page. It costs main-thread time even before anyone touches the form.'
      : 'reCAPTCHA loads on a page with no form.',
    details: [],
    fix: 'Load reCAPTCHA on the first interaction with a form, and keep the loader in an external file: consent managers often block inline scripts that mention grecaptcha.',
  };
}

export function plugins({ warm }) {
  const bySlug = pluginAssets(warm.body);
  const entries = Object.entries(bySlug).sort((a, b) => b[1].length - a[1].length);
  const total = entries.reduce((n, [, files]) => n + files.length, 0);
  return {
    id: 'plugin-assets',
    title: 'Plugin files',
    status: total > 25 ? 'warn' : 'info',
    summary: `${entries.length} plugins load ${total} CSS/JS files on this page.`,
    details: entries.slice(0, 10).map(([slug, files]) => `${slug}: ${files.length}`),
    fix: total > 25 ? 'Check which plugins are needed here; load their files only on pages that use their shortcode or block.' : undefined,
  };
}

export function mobileCache({ warm, mobileWarm }) {
  if (!mobileWarm) return { id: 'mobile-cache', title: 'Cache on phones', status: 'info', summary: 'Could not test a visit from a phone.', details: [] };
  const d = cacheVerdict(warm);
  const m = cacheVerdict(mobileWarm);
  const vary = (mobileWarm.headers.vary || warm.headers.vary || '').toLowerCase();
  const details = [
    `computer, repeat visit: ${label(d.hit)} (${ms(warm.ttfbMs)})`,
    `phone, repeat visit: ${label(m.hit)} (${ms(mobileWarm.ttfbMs)})`,
  ];
  if (vary) details.push(`vary: ${vary}`);
  const varyUa = /user-agent/.test(vary);
  const slower = mobileWarm.ttfbMs > warm.ttfbMs * 3 + 200;

  if ((d.hit === true && m.hit === false) || (m.hit === null && d.hit !== false && slower)) {
    return {
      id: 'mobile-cache', title: 'Cache on phones', status: 'warn',
      summary: 'Phones skip the cache that computers get. On most sites phones are the majority of visits.',
      details,
      fix: 'Check that the cache (or the CDN rule) also stores the mobile version; with separate mobile caches, purge both when content changes.',
    };
  }
  if (varyUa) {
    return {
      id: 'mobile-cache', title: 'Cache on phones', status: 'warn',
      summary: 'The page sends "Vary: User-Agent": shared caches must keep a copy per browser version, so most visits miss.',
      details,
      fix: 'Remove User-Agent from Vary, or normalise it at the CDN into a few device classes (mobile, tablet, desktop).',
    };
  }
  return {
    id: 'mobile-cache', title: 'Cache on phones',
    status: m.hit === true ? 'pass' : 'info',
    summary: m.hit === true ? 'Phones get the cached page too.' : 'No cache signal on phones either way; response times are similar to computers.',
    details,
  };
}

export function sitePages({ pages = [] }) {
  if (pages.length === 0) {
    return { id: 'site-pages', title: 'Other pages', status: 'info', summary: 'No sitemap found, so only the start page was checked.', details: [], fix: 'Pass a specific page URL to check it, or enable the WordPress sitemap.' };
  }
  const rows = pages.map(p => ({ path: short(p.url), v: cacheVerdict(p.warm), t: p.warm.ttfbMs }));
  const slowest = Math.max(...rows.map(r => r.t));
  const misses = rows.filter(r => r.v.hit === false);
  // Slow and not served from cache is a real failure; slow on a cache hit is more often the
  // server or the network at that moment, so it is a warning worth re-checking.
  const slowUncached = rows.filter(r => r.v.hit !== true && r.t > 1800);
  const slowHits = rows.filter(r => r.v.hit === true && r.t > 800);
  const slow = rows.filter(r => r.t > 800);
  const status = slowUncached.length ? 'fail' : misses.length || slow.length ? 'warn' : 'pass';

  const parts = [];
  if (misses.length) parts.push(`${misses.length} of ${pages.length} pages from the sitemap miss the cache.`);
  if (slowUncached.length) parts.push(`${slowUncached.length} take more than 1.8 s on a repeat visit (slowest ${ms(slowest)}).`);
  else if (slowHits.length) parts.push(`${slowHits.length} came from the cache but still took up to ${ms(slowest)}: the server or the network was slow at that moment. Re-run to confirm.`);
  else if (slow.length) parts.push(`The slowest takes ${ms(slowest)} on a repeat visit.`);

  return {
    id: 'site-pages',
    title: 'Other pages',
    status,
    summary: status === 'pass' ? `${pages.length} pages from the sitemap are fast on a repeat visit (slowest ${ms(slowest)}).` : parts.join(' '),
    details: rows.map(r => `${r.path}: ${label(r.v.hit)} (${ms(r.t)})`),
    fix: misses.length || slowUncached.length
      ? 'Look for cache exclusions that are too broad (whole post types, pages with a form or a shortcode) and for pages that are slow to generate.'
      : slowHits.length ? 'If it happens again, the cache is served slowly: check server load, or serve the cache without PHP (WP Super Cache expert mode, or a CDN).' : undefined,
  };
}

export function notFound({ notFound: nf, notFoundWarm }) {
  if (!nf) return { id: 'not-found', title: 'Missing pages (404)', status: 'info', summary: 'Could not test a missing page.', details: [] };
  const requested = short(nf.requestedUrl || '');
  const landed = short(nf.url);
  if (nf.status === 200) {
    const redirected = Boolean(nf.requestedUrl) && landed !== requested;
    return {
      id: 'not-found', title: 'Missing pages (404)', status: 'fail',
      summary: redirected
        ? `Missing pages redirect to ${landed} with status 200 ("soft 404"): search engines and caches treat them as real pages.`
        : 'Missing pages answer with status 200 ("soft 404"): search engines index them and caches store them as real pages.',
      details: [`requested ${requested || 'a random URL'} → ${nf.status}${redirected ? ` at ${landed}` : ''}`],
      fix: 'Make missing pages return 404 (a redirect plugin or a theme template may be catching them).',
    };
  }
  if (nf.status !== 404 && nf.status !== 410) {
    return { id: 'not-found', title: 'Missing pages (404)', status: 'info', summary: `A missing page answers with status ${nf.status}.`, details: [] };
  }
  const v = notFoundWarm ? cacheVerdict(notFoundWarm) : { hit: null };
  const maxAge = cacheSeconds((notFoundWarm || nf).headers);
  const longCache = v.hit === true && (maxAge === null || maxAge > 3600);
  return {
    id: 'not-found', title: 'Missing pages (404)',
    status: longCache ? 'warn' : 'pass',
    summary: longCache
      ? `404 pages are cached${maxAge ? ` for ${Math.round(maxAge / 3600)} h` : ''}. A page published later at a URL someone already tried keeps showing "not found" until the cache is purged.`
      : 'Missing pages return a real 404.',
    details: [`status ${nf.status}, repeat request: ${label(v.hit)}${maxAge !== null ? `, cacheable for ${maxAge} s` : ''}`],
    fix: longCache ? 'Cache 404s for minutes, not hours (or not at all), and purge the URL when a page is published.' : undefined,
  };
}

// Seconds a shared cache may keep the response (s-maxage wins over max-age), or null if not stated.
function cacheSeconds(headers = {}) {
  const cc = headers['cache-control'] || '';
  const m = cc.match(/s-maxage=(\d+)/i) || cc.match(/max-age=(\d+)/i);
  return m ? Number(m[1]) : null;
}

export const ALL_CHECKS = [serverResponse, pageCache, mobileCache, sitePages, notFound, compression, viewportPosition, lcpHint, renderBlocking, recaptcha, plugins];

// Pages that bot protection serves instead of the site, often with status 200.
const CHALLENGE = /<title>\s*(Just a moment|Attention Required|Access denied|Request Rejected|Pardon Our Interruption|DDoS-Guard|Security check)/i;

// If the site refused the request, the other checks would describe an error page, not the site.
export function reachability({ first, warm }) {
  const res = warm.status >= 400 ? warm : first;
  const blockedPage = CHALLENGE.test(first.body) || CHALLENGE.test(warm.body);
  if (res.status < 400 && !blockedPage) return null;
  const via = res.headers['x-cache']?.match(/error from (\w+)/i)?.[1] || res.headers.server || res.headers['cf-ray'] && 'cloudflare';
  const why = res.status === 403 || blockedPage
    ? 'blocks automated requests'
    : res.status === 429 ? 'is rate-limiting requests' : res.status >= 500 ? 'is returning a server error' : `answers ${res.status}`;
  return {
    id: 'reachability',
    title: 'Site reachable',
    status: 'fail',
    summary: `The site ${why} (status ${res.status}${via ? `, ${via}` : ''}). wp-doctor received an error page instead of the site, so it did not run the other checks: their results would describe the error page.`,
    details: [`first request: ${first.status}`, `repeat request: ${warm.status}`],
    fix: 'Run wp-doctor on a site you manage. wp-doctor identifies itself as "wp-doctor" in the User-Agent: allow it in the firewall or bot protection while you test.',
  };
}

export function runChecks(data) {
  const blocked = reachability(data);
  if (blocked) return [blocked];
  return ALL_CHECKS.map(check => check(data));
}

function label(hit) {
  return hit === true ? 'HIT' : hit === false ? 'MISS' : 'unknown';
}

function short(url) {
  try {
    const u = new URL(url, 'https://x.invalid');
    return u.pathname.length > 70 ? '…' + u.pathname.slice(-69) : u.pathname;
  } catch {
    return url;
  }
}
