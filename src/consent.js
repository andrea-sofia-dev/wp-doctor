import { listTags } from './html.js';

// Recognises the cookie banner a site uses and builds the cookie a visitor has after
// accepting it. Caches that skip "any cookie" skip exactly these visitors.
//
// Detection looks only at what loads the banner (script and stylesheet URLs, the
// banner's own config object or container id), never at the page text: an article
// that mentions "iubenda" must not count as an iubenda banner.

const MANAGERS = [
  {
    name: 'iubenda',
    // Classic loader (cdn.iubenda.com/cs/...), autoblocking, and the newer embed widget (embeds.iubenda.com/widgets/<uuid>.js).
    src: /iubenda\.com\/(cs|cookie-solution|sync|autoblocking|widgets)\//i,
    marker: /_iub\.csConfiguration|_iub\s*=\s*_iub/,
    cookie: html => {
      const id = html.match(/["']?siteId["']?\s*[:=]\s*["']?(\d+)/i)?.[1]
        ?? html.match(/iubenda\.com\/autoblocking\/(\d+)\.js/i)?.[1]
        ?? '0';
      return `_iub_cs-${id}=${encodeURIComponent('{"timestamp":"2026-01-01T00:00:00.000Z","version":"1.0","purposes":{"1":true,"2":true,"3":true,"4":true,"5":true}}')}`;
    },
  },
  {
    name: 'Cookiebot',
    src: /consent\.cookiebot\.(com|eu)/i,
    marker: /id=["']Cookiebot["']/i,
    cookie: () => `CookieConsent=${encodeURIComponent("{stamp:'wp-doctor',necessary:true,preferences:true,statistics:true,marketing:true,method:'explicit',ver:1}")}`,
  },
  {
    name: 'Complianz',
    src: /\/plugins\/complianz-gdpr(-premium)?\//i,
    marker: /id=["']cmplz-cookiebanner-container["']|var\s+complianz\s*=/i,
    cookie: () => 'cmplz_banner-status=dismissed; cmplz_functional=allow; cmplz_statistics=allow; cmplz_marketing=allow',
  },
  {
    name: 'CookieYes',
    src: /cdn-cookieyes\.com|\/plugins\/cookie-law-info\/lite\//i,
    marker: /id=["']cookieyes["']|cky-consent-container/i,
    cookie: () => 'cookieyes-consent=consentid:wp-doctor,consent:yes,action:yes,necessary:yes,functional:yes,analytics:yes,performance:yes,advertisement:yes',
  },
  {
    name: 'OneTrust',
    src: /cookielaw\.org|onetrust\.com\/.*otSDKStub/i,
    marker: /otSDKStub|OptanonWrapper/,
    cookie: () => 'OptanonAlertBoxClosed=2026-01-01T00:00:00.000Z; OptanonConsent=isGpcEnabled=0&groups=C0001%3A1%2CC0002%3A1%2CC0003%3A1%2CC0004%3A1',
  },
  {
    name: 'Borlabs Cookie',
    src: /\/plugins\/borlabs-cookie\//i,
    marker: /id=["']BorlabsCookieBox["']/i,
    cookie: () => `borlabs-cookie=${encodeURIComponent('{"consents":{"essential":["borlabs-cookie"],"statistics":[],"marketing":[]},"version":"1"}')}`,
  },
  {
    name: 'CookieLawInfo (WebToffee)',
    src: /\/plugins\/(cookie-law-info|webtoffee-gdpr-cookie-consent)\//i,
    marker: /id=["']cookie-law-info-bar["']/i,
    cookie: () => 'viewed_cookie_policy=yes; cookielawinfo-checkbox-necessary=yes; cookielawinfo-checkbox-analytics=yes',
  },
  {
    name: 'Cookie Notice',
    src: /\/plugins\/cookie-notice\//i,
    marker: /id=["']cookie-notice["']/i,
    cookie: () => 'cookie_notice_accepted=true',
  },
];

const GENERIC = { name: null, cookie: 'wp_doctor_consent=1' };

// The first banner found wins; without one, a harmless generic cookie stands in.
export function consentCookie(html) {
  // Only files that are actually loaded: scripts and stylesheets, not preconnect or dns-prefetch hints.
  const urls = listTags(html, ['script', 'link'])
    .filter(t => t.name === 'script' || /stylesheet/i.test(t.attrs.rel || ''))
    .map(t => t.attrs.src || t.attrs.href || '')
    .filter(Boolean);
  for (const m of MANAGERS) {
    if (urls.some(u => m.src.test(u)) || m.marker.test(html)) return { name: m.name, cookie: m.cookie(html) };
  }
  return GENERIC;
}
