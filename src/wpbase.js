// Where WordPress lives on this host. Usually "/", but sites installed in a subfolder
// (example.com/blog/) must be probed there: a missing page or a sitemap at the domain
// root may belong to something else entirely.
export function wordpressBase(html, pageUrl) {
  const link = html.match(/<link[^>]+rel=["']https:\/\/api\.w\.org\/["'][^>]*>/i)?.[0];
  const href = link?.match(/href=["']([^"']+)["']/i)?.[1];
  if (href) {
    try {
      const api = new URL(href, pageUrl);
      if (api.host === new URL(pageUrl).host) {
        const base = api.pathname.replace(/wp-json\/?$/, '');
        return new URL(base.endsWith('/') ? base : `${base}/`, pageUrl).toString();
      }
    } catch { /* fall through */ }
  }
  return new URL('/', pageUrl).toString();
}
