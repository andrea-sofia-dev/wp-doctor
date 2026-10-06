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

export function pageCache({ first, warm, cookie, utm }) {
  const w = cacheVerdict(warm);
  const c = cacheVerdict(cookie);
  const u = cacheVerdict(utm);
  const details = [
    `repeat visit: ${label(w.hit)} (${ms(warm.ttfbMs)})${w.evidence.length ? ' — ' + w.evidence.join(', ') : ''}`,
    `visitor with a cookie: ${label(c.hit)} (${ms(cookie.ttfbMs)})`,
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
      fix: 'Turn on a page cache (WP Super Cache, W3 Total Cache, LiteSpeed Cache, or a CDN rule that caches HTML).',
    };
  }

  const problems = [];
  if (c.hit === false || (c.hit === null && cookie.ttfbMs > warm.ttfbMs * 3 + 200)) {
    problems.push('Visitors with any cookie skip the cache. With a consent banner that is almost everyone.');
  }
  if (u.hit === false || (u.hit === null && utm.ttfbMs > warm.ttfbMs * 3 + 200)) {
    problems.push('Campaign parameters (utm_*) skip the cache, so ad and newsletter traffic gets the slow page.');
  }
  return {
    id: 'page-cache',
    title: 'Page cache',
    status: problems.length ? 'warn' : 'pass',
    summary: problems.length ? problems.join(' ') : 'Repeat visits are served from cache, also with cookies and UTM parameters.',
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
  const loads = /(google\.com|recaptcha\.net)\/recaptcha\/|gstatic\.com\/recaptcha\//i.test(warm.body);
  if (!loads) return { id: 'recaptcha', title: 'reCAPTCHA', status: 'pass', summary: 'reCAPTCHA is not loaded on this page.', details: [] };
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

export const ALL_CHECKS = [serverResponse, pageCache, compression, viewportPosition, lcpHint, renderBlocking, recaptcha, plugins];

export function runChecks(data) {
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
