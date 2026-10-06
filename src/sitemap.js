import { timedFetch } from './http.js';

// Finds a few real pages to test besides the one given: robots.txt → sitemap index →
// first child sitemap → URLs. Works with the WordPress core sitemap, Yoast and Rank Math.
export async function samplePages(origin, limit, { timeoutMs } = {}) {
  if (limit <= 0) return [];
  const candidates = [];
  try {
    const robots = await timedFetch(new URL('/robots.txt', origin).toString(), { timeoutMs });
    if (robots.status === 200) {
      for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.push(m[1]);
    }
  } catch { /* no robots.txt: fall back to the usual locations */ }
  candidates.push(new URL('/wp-sitemap.xml', origin).toString(), new URL('/sitemap_index.xml', origin).toString(), new URL('/sitemap.xml', origin).toString());

  for (const sitemapUrl of [...new Set(candidates)]) {
    const urls = await readSitemap(sitemapUrl, { timeoutMs, depth: 0 });
    const pages = urls.filter(u => sameSite(u, origin) && new URL(u).pathname !== new URL(origin).pathname);
    if (pages.length) return spread(pages, limit);
  }
  return [];
}

async function readSitemap(url, { timeoutMs, depth }) {
  let res;
  try {
    res = await timedFetch(url, { timeoutMs, headers: { accept: 'application/xml,text/xml,*/*' } });
  } catch {
    return [];
  }
  if (res.status !== 200 || !/<(urlset|sitemapindex)\b/i.test(res.body)) return [];
  const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decodeXml(m[1]));
  if (/<sitemapindex\b/i.test(res.body) && depth < 2) {
    // Prefer posts and pages over taxonomies and users.
    const children = locs.sort((a, b) => rank(a) - rank(b));
    for (const child of children.slice(0, 3)) {
      const urls = await readSitemap(child, { timeoutMs, depth: depth + 1 });
      if (urls.length) return urls;
    }
    return [];
  }
  return locs;
}

function rank(u) {
  if (/post|page/i.test(u) && !/tag|categor|author|user|taxonom/i.test(u)) return 0;
  return /tag|author|user/i.test(u) ? 2 : 1;
}

// Pages spread across the list, so the sample is not only the newest posts.
function spread(list, n) {
  if (list.length <= n) return list;
  const step = list.length / n;
  return Array.from({ length: n }, (_, i) => list[Math.floor(i * step)]);
}

function sameSite(u, origin) {
  try { return new URL(u).host === new URL(origin).host; } catch { return false; }
}

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
