// Background for each check, written for an AI agent (or a person) who has to act on a result:
// why it matters, how to confirm it by hand, and the usual fixes per stack.

export const EXPLANATIONS = {
  'server-response': {
    title: 'Server response time',
    why: 'Time to first byte delays everything else: nothing can render until the HTML starts arriving. On WordPress a slow TTFB almost always means PHP and the database run on every visit.',
    verify: 'curl -s -o /dev/null -w "%{time_starttransfer}\\n" https://example.com/ (run it twice: the second run should be fast if a page cache works).',
    fixes: [
      'Enable a page cache so anonymous visitors get a stored copy (see the page-cache check).',
      'If TTFB is slow even on cache hits, the cache is not in front of PHP: check the cache layer order or the hosting.',
      'For pages that cannot be cached, profile slow queries and plugins (Query Monitor) and add an object cache (Redis).',
    ],
  },
  'page-cache': {
    title: 'Page cache',
    why: 'A page cache serves stored HTML instead of running WordPress. It only helps if real visitors hit it: consent banners give almost everyone a cookie, and every ad or newsletter click adds utm_* parameters.',
    verify: 'Request the page twice and look for cache headers (cf-cache-status, x-litespeed-cache, x-cache, age) or the cache plugin HTML comment. Repeat with a cookie header and with ?utm_source=test.',
    fixes: [
      'WP Super Cache: set "Disable caching for logged in visitors" (wp_cache_not_logged_in = 2). Value 1 disables caching for any visitor with a cookie.',
      'WP Super Cache: list utm_source, utm_medium, utm_campaign, utm_content, utm_term, fbclid, gclid, gbraid, wbraid, msclkid, ttclid under "Tracking parameters to ignore".',
      'W3 Total Cache: Page Cache → "Accepted query strings" / "Ignored query strings"; do not reject pages just because cookies exist.',
      'LiteSpeed Cache: Cache → Advanced → "Drop Query String": add utm_*, fbclid, gclid.',
      'Cloudflare: a Cache Rule that caches HTML, with a "Cache key → Query string → Ignore" exception for campaign parameters, and bypass only on wordpress_logged_in_* and woocommerce cart cookies.',
      'nginx fastcgi_cache: strip campaign parameters from the cache key and bypass only on WordPress login/cart cookies, not on any cookie.',
    ],
  },
  'mobile-cache': {
    title: 'Cache on phones',
    why: 'Many setups keep separate cached copies for phones and computers. If the phone copy is never stored, or the CDN purges only one of them, phones (usually most of the traffic) get slow or stale pages.',
    verify: 'Request the page twice with a mobile User-Agent and compare cache headers with a desktop request. On Cloudflare with device caching, purge by URL once per CF-Device-Type (desktop, mobile, tablet).',
    fixes: [
      'WP Super Cache: if "Mobile device support" is on, check that mobile files are created; otherwise turn it off and serve one responsive page.',
      'Cloudflare: when a Cache Rule varies by device type, purge each URL for desktop, mobile and tablet, or the phone keeps the old page.',
      'Remove "Vary: User-Agent" sent by a plugin or the server; if device variants are needed, normalise the User-Agent into a few classes at the CDN.',
    ],
  },
  'site-pages': {
    title: 'Other pages',
    why: 'The home page is often the best-cached page. Posts, landing pages or pages with forms may be excluded from the cache by broad rules and be the ones visitors actually land on from search and ads.',
    verify: 'Pick a few URLs from the sitemap and request each twice, checking cache headers and time to first byte.',
    fixes: [
      'Review cache exclusions: exclude single URLs that really need it (cart, checkout, pages with short-lived tokens), not whole post types or every page with a form.',
      'For pages that must stay dynamic, cache the page and load the dynamic part (form tokens, personalised content) with a small AJAX request.',
      'If a specific page is slow even on a cache hit, it is heavy to render in the browser: check it with Lighthouse.',
    ],
  },
  'not-found': {
    title: 'Missing pages (404)',
    why: 'A missing page must answer 404. A "soft 404" (status 200, often a redirect to the home page) gets indexed by search engines and cached as a real page. A 404 cached for hours means a page published later at a URL someone already tried keeps showing "not found".',
    verify: 'curl -s -o /dev/null -w "%{http_code}\\n" https://example.com/this-page-does-not-exist/ (twice, checking cache headers on the second).',
    fixes: [
      'Soft 404: find the redirect plugin rule or theme template that catches missing URLs and sends them to the home page; let WordPress return 404.',
      'W3 Total Cache: do not cache 404 pages (Page Cache → "Cache 404 (not found) pages" off), or keep the lifetime short.',
      'Cloudflare: Cache Rule with a status-code TTL so 404 responses are kept for a few minutes at most; purge the URL when a page is published.',
    ],
  },
  compression: {
    title: 'Compression',
    why: 'HTML, CSS and JS compress by 70–85%. Uncompressed HTML is wasted transfer time on every page view, worst on mobile networks.',
    verify: 'curl -s -I -H "Accept-Encoding: br, gzip" https://example.com/ | grep -i content-encoding',
    fixes: [
      'Apache: enable mod_deflate (AddOutputFilterByType DEFLATE text/html text/css application/javascript application/json image/svg+xml) or mod_brotli.',
      'nginx: gzip on; gzip_types text/css application/javascript application/json image/svg+xml; (brotli if the module is available).',
      'Behind Cloudflare, compression is applied at the edge; if it is missing, check that the origin does not send Cache-Control: no-transform.',
    ],
  },
  viewport: {
    title: 'Viewport meta tag',
    why: 'Until the browser reads <meta name="viewport">, a phone lays out the page as if the screen were 980 px wide. Preloads and media queries evaluated before that point can fetch desktop-sized images.',
    verify: 'View the source and check that the viewport meta is among the first tags in <head>, before stylesheets and preloads.',
    fixes: [
      'Theme prints it via a wp_head callback: remove_action("wp_head", "<callback>"); add_action("wp_head", "<callback>", 0);',
      'Divi: the callback is et_add_viewport_meta; move it to priority 0 in a small mu-plugin.',
      'If the theme hardcodes it late in header.php, move the line to just after <meta charset> in a child theme.',
    ],
  },
  'lcp-hint': {
    title: 'Main image priority',
    why: 'The Largest Contentful Paint is often a hero image. Without a hint the browser discovers it late and downloads it with normal priority, behind scripts and fonts.',
    verify: 'In Chrome DevTools → Performance or Lighthouse, see which element is the LCP; check its request priority in the Network panel.',
    fixes: [
      'Add fetchpriority="high" to the hero <img> and remove loading="lazy" from it.',
      'For CSS background heroes, add <link rel="preload" as="image" href="..." fetchpriority="high"> on that page only, with media/imagesrcset for mobile and desktop variants.',
      'Serve the hero as WebP/AVIF at the displayed size.',
    ],
  },
  'render-blocking': {
    title: 'Render-blocking files',
    why: 'A <script src> in <head> without defer or async stops the parser until it downloads and runs. Each one adds a round trip before the first paint.',
    verify: 'Lighthouse → "Eliminate render-blocking resources", or view source and list head scripts without defer/async.',
    fixes: [
      'WordPress 6.3+: wp_enqueue_script(..., [ "strategy" => "defer", "in_footer" => true ]) or the script_loader_tag filter for third-party plugins.',
      'Load plugin scripts only on pages that use the plugin (check for the shortcode or block before enqueuing).',
      'Keep scripts that must run early (consent manager, critical inline config) small and inline.',
    ],
  },
  recaptcha: {
    title: 'reCAPTCHA',
    why: 'reCAPTCHA v3 downloads several hundred KB of JS and keeps the main thread busy, on every page where it is loaded, whether or not anyone uses a form.',
    verify: 'Network panel: look for google.com/recaptcha or gstatic.com/recaptcha on pages without forms.',
    fixes: [
      'Load reCAPTCHA on the first focus/touch of a form field, and make the form wait for the token before submitting.',
      'Put the loader in an external .js file: consent managers (e.g. iubenda) can block inline scripts that contain "grecaptcha" until consent, which silently sends forms without a token.',
      'Contact Form 7: dequeue google-recaptcha and wpcf7-recaptcha on pages without a form.',
    ],
  },
  'plugin-assets': {
    title: 'Plugin files',
    why: 'Many plugins enqueue CSS and JS on every page, even where their feature is not used. Each file is a request and often render-blocking CSS.',
    verify: 'Count /wp-content/plugins/<slug>/ files in the page source; compare a page that uses the plugin with one that does not.',
    fixes: [
      'Dequeue per page: if (!has_shortcode($post->post_content, "x")) wp_dequeue_script("x"); in a small mu-plugin.',
      'Remove plugins that are no longer used rather than just deactivating their features.',
      'Asset managers (Asset CleanUp, Perfmatters) can do this without code, at the cost of another plugin.',
    ],
  },
};

export function explain(id) {
  const e = EXPLANATIONS[id];
  if (!e) return null;
  return [
    `# ${e.title}`,
    '',
    `Why it matters: ${e.why}`,
    '',
    `How to verify by hand: ${e.verify}`,
    '',
    'Usual fixes:',
    ...e.fixes.map(f => `- ${f}`),
  ].join('\n');
}
