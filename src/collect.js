import { timedFetch, withParams } from './http.js';

// One set of requests shared by every check, so each check stays a pure function.
// - first: whatever the cache holds right now (may be cold)
// - warm: the same URL again, which a working page cache should serve
// - cookie: a harmless cookie, like the one a consent banner sets on almost every visitor
// - utm: campaign parameters, like every visit from an ad or a newsletter
export async function collect(url, { timeoutMs } = {}) {
  const opts = { timeoutMs };
  const first = await timedFetch(url, opts);
  const target = first.url;
  const warm = await timedFetch(target, opts);
  const cookie = await timedFetch(target, { ...opts, headers: { cookie: 'wp_doctor_consent=1' } });
  // A fresh value every run: if the cache keys on campaign parameters, this request cannot be a hit.
  const campaign = `audit-${Date.now().toString(36)}`;
  const utm = await timedFetch(withParams(target, { utm_source: 'wp-doctor', utm_campaign: campaign }), opts);
  return { url: target, first, warm, cookie, utm };
}
