import { timedFetch } from './http.js';

// Finds a few real pages to test besides the one given: robots.txt → sitemap index →
// first child sitemap → URLs. Works with the WordPress core sitemap, Yoast and Rank Math.
// `base` is where WordPress lives (see wpbase.js): in a subfolder install, only sitemaps
// and pages under that folder belong to the site being checked.
export async function samplePages(base, limit, { timeoutMs, transport } = {}) {
  if (limit <= 0) return [];
  const basePath = new URL(base).pathname;
  const candidates = [];
  try {
    // robots.txt only ever lives at the domain root.
    const robots = await timedFetch(new URL('/robots.txt', base).toString(), { timeoutMs, transport });
    if (robots.status === 200) {
      for (const m of robots.body.matchAll(/^\s*sitemap:\s*(\S+)/gim)) candidates.push(m[1]);
    }
  } catch { /* no robots.txt: fall back to the usual locations */ }
  candidates.push(...['wp-sitemap.xml', 'sitemap_index.xml', 'sitemap.xml'].map(f => new URL(f, base).toString()));
  // Sitemaps of this WordPress first, anything else on the domain after.
  const ordered = [...new Set(candidates)].sort((a, b) => underBase(b, base) - underBase(a, base));

  for (const sitemapUrl of ordered) {
    const urls = await readSitemap(sitemapUrl, { timeoutMs, transport, depth: 0 });
    const pages = urls.filter(u => sameSite(u, base) && underBase(u, base) && new URL(u).pathname !== basePath);
    if (pages.length) return spread(pages, limit);
  }
  return [];
}

function underBase(u, base) {
  try { return new URL(u).pathname.startsWith(new URL(base).pathname) ? 1 : 0; } catch { return 0; }
}

async function readSitemap(url, { timeoutMs, transport, depth }) {
  let res;
  try {
    res = await timedFetch(url, { timeoutMs, transport, headers: { accept: 'application/xml,text/xml,*/*' } });
  } catch {
    return [];
  }
  if (res.status !== 200 || !/<(urlset|sitemapindex)\b/i.test(res.body)) return [];
  const locs = [...res.body.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map(m => decodeXml(m[1]));
  if (/<sitemapindex\b/i.test(res.body) && depth < 2) {
    // Prefer posts and pages over taxonomies and users.
    const children = locs.sort((a, b) => rank(a) - rank(b));
    for (const child of children.slice(0, 3)) {
      const urls = await readSitemap(child, { timeoutMs, transport, depth: depth + 1 });
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
