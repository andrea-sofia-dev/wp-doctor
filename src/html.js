// Small, dependency-free HTML helpers. They do not build a DOM: they read tags in
// document order, which is all the checks need (what comes first in <head>, which
// scripts block rendering, which plugins load files).

export function extractHead(html) {
  const start = html.search(/<head[\s>]/i);
  if (start === -1) return '';
  const end = html.search(/<\/head>/i);
  return html.slice(start, end === -1 ? undefined : end);
}

export function parseAttrs(tag) {
  const attrs = {};
  const inner = tag.replace(/^<\s*[\w-]+/, '').replace(/\/?>$/, '');
  const re = /([^\s=/>"']+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;
  let m;
  while ((m = re.exec(inner))) {
    attrs[m[1].toLowerCase()] = m[2] ?? m[3] ?? m[4] ?? '';
  }
  return attrs;
}

// Opening tags of the given names, in document order, with their attributes.
export function listTags(html, names = ['meta', 'link', 'script', 'style', 'title', 'img']) {
  const re = new RegExp(`<(${names.join('|')})\\b[^>]*>`, 'gi');
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ name: m[1].toLowerCase(), attrs: parseAttrs(m[0]), index: m.index });
  }
  return out;
}

export function isWordPress(html, headers = {}) {
  return (
    /\/wp-(content|includes)\//i.test(html) ||
    /<meta[^>]+name=["']generator["'][^>]+WordPress/i.test(html) ||
    /wp-json/i.test(headers.link || '')
  );
}

// Every asset served from /wp-content/plugins/<slug>/, grouped by plugin.
export function pluginAssets(html) {
  const bySlug = {};
  for (const tag of listTags(html, ['link', 'script'])) {
    const src = tag.attrs.src || tag.attrs.href || '';
    const m = src.match(/\/wp-content\/plugins\/([^/?#]+)\//i);
    if (!m) continue;
    (bySlug[m[1]] ||= []).push(src);
  }
  return bySlug;
}
