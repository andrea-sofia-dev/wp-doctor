// Timed HTTP requests. Node's fetch resolves when the response headers arrive,
// so the time to that point is a fair approximation of TTFB.

export const USER_AGENT = 'wp-doctor/0.2 (+https://github.com/andrea-sofia-dev/wp-doctor)';

export async function timedFetch(url, { headers = {}, timeoutMs = 20000 } = {}) {
  const start = performance.now();
  const res = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(timeoutMs),
    headers: { 'user-agent': USER_AGENT, accept: 'text/html,*/*;q=0.8', ...headers },
  });
  const ttfbMs = Math.round(performance.now() - start);
  const body = await res.text();
  const totalMs = Math.round(performance.now() - start);

  const headerMap = {};
  for (const [name, value] of res.headers) headerMap[name.toLowerCase()] = value;

  return { url: res.url || url, status: res.status, headers: headerMap, body, ttfbMs, totalMs };
}

// Adds query parameters without losing the ones already in the URL.
export function withParams(url, params) {
  const u = new URL(url);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}
