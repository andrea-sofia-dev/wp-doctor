// Timed HTTP requests. Node's fetch resolves when the response headers arrive,
// so the time to that point is a fair approximation of TTFB.

export const USER_AGENT = 'wp-doctor/1.1 (+https://github.com/andrea-sofia-dev/wp-doctor)';

// Optional check on every address before it is requested, redirects included. The CLI does not set one;
// the web version does, so a public site cannot redirect the server to a private network address.
let guard = null;
export function setUrlGuard(fn) {
  guard = fn;
}

export async function timedFetch(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const start = performance.now();
  const init = {
    redirect: guard ? 'manual' : 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8', ...headers },
  };
  let current = url;
  let res;
  for (let hops = 0; ; hops++) {
    if (guard) await guard(current);
    res = await fetch(current, init);
    const location = res.headers.get('location');
    if (!guard || res.status < 300 || res.status > 399 || !location) break;
    if (hops >= 10) throw new Error('redirect count exceeded');
    await res.body?.cancel();
    current = new URL(location, current).toString();
  }
  const ttfbMs = Math.round(performance.now() - start);
  const body = await res.text();
  const totalMs = Math.round(performance.now() - start);

  const headerMap = {};
  for (const [name, value] of res.headers) headerMap[name.toLowerCase()] = value;

  return { url: guard ? current : res.url || url, requestedUrl: url, status: res.status, headers: headerMap, body, ttfbMs, totalMs };
}

// Adds query parameters without losing the ones already in the URL.
export function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
