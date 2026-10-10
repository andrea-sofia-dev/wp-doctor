// Browser mode: the same requests, sent by a real Chrome.
// Some sites (Cloudflare bot management, Akamai, AWS WAF) refuse anything that is not a browser, whatever it is
// called: they look at how the connection is made. A real Chrome gets the page, and wp-doctor still says who it is
// in the User-Agent. It does not solve CAPTCHAs or "are you human?" challenges: those stay "blocked".
//
// Each visit opens a fresh browser context (no cookies, no cache, like a new visitor) and loads only the HTML
// document: images, scripts and styles are not downloaded, so a visit costs the site one request, as in plain mode.
// No dependencies: Chrome DevTools Protocol over Node's built-in WebSocket (Node 22+).

import { spawn } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { delimiter, join } from 'node:path';
import { guardUrl } from './http.js';

const SIGNATURE = 'wp-doctor/1.2 (+https://github.com/andrea-sofia-dev/wp-doctor)';

// Chrome, Chromium or Edge in the usual places; CHROME_PATH wins.
export function findChrome() {
  if (process.env.CHROME_PATH) return existsSync(process.env.CHROME_PATH) ? process.env.CHROME_PATH : null;
  const candidates = {
    win32: [
      join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env.LOCALAPPDATA || '', 'Google\\Chrome\\Application\\chrome.exe'),
      join(process.env['PROGRAMFILES(X86)'] || 'C:\\Program Files (x86)', 'Microsoft\\Edge\\Application\\msedge.exe'),
      join(process.env.PROGRAMFILES || 'C:\\Program Files', 'Microsoft\\Edge\\Application\\msedge.exe'),
    ],
    darwin: [
      '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
      '/Applications/Chromium.app/Contents/MacOS/Chromium',
      '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    ],
  }[process.platform];
  const list = candidates ?? (process.env.PATH || '').split(delimiter).flatMap((dir) =>
    ['google-chrome', 'google-chrome-stable', 'chromium', 'chromium-browser', 'microsoft-edge'].map((name) => join(dir, name)));
  return list.find((file) => file && existsSync(file)) ?? null;
}

// Starts Chrome and returns { transport, close }. transport(url, { headers, timeoutMs }) answers like timedFetch.
export async function launchBrowser({ executablePath = findChrome(), args = [] } = {}) {
  if (typeof WebSocket === 'undefined') throw new Error('Browser mode needs Node.js 22 or later.');
  if (!executablePath) throw new Error('Browser mode needs Chrome, Chromium or Edge (or set CHROME_PATH).');
  const profile = mkdtempSync(join(tmpdir(), 'wp-doctor-'));
  const chrome = spawn(executablePath, [
    ...args,
    ...(args.some((a) => a.startsWith('--headless')) ? [] : ['--headless=new']),
    '--remote-debugging-port=0', `--user-data-dir=${profile}`,
    '--no-first-run', '--no-default-browser-check', '--disable-extensions', '--disable-background-networking',
    '--disable-sync', '--disable-component-update', '--mute-audio',
    '--disable-dev-shm-usage', // serverless functions have no /dev/shm
    'about:blank',
  ], { stdio: ['ignore', 'ignore', 'pipe'] });

  const endpoint = await new Promise((resolve, reject) => {
    let log = '';
    const timer = setTimeout(() => reject(new Error('Chrome did not start.')), 20000);
    chrome.stderr.on('data', (chunk) => {
      log += chunk;
      const match = log.match(/DevTools listening on (ws:\/\/\S+)/);
      if (match) {
        clearTimeout(timer);
        resolve(match[1]);
      }
    });
    chrome.once('exit', (code) => reject(new Error(`Chrome closed while starting (exit ${code}): ${log.trim().split('\n').slice(-3).join(' | ').slice(0, 400)}`)));
    chrome.once('error', reject);
  });

  const cdp = await connect(endpoint);
  const { product, userAgent } = await cdp.send('Browser.getVersion');
  const major = product.match(/\/(\d+)/)?.[1] ?? '140';
  // The engine's own User-Agent, minus "Headless", plus who we are.
  const desktopUa = `${userAgent.replace('HeadlessChrome', 'Chrome')} ${SIGNATURE}`;

  async function transport(url, { headers = {}, timeoutMs = 20000 } = {}) {
    const { browserContextId } = await cdp.send('Target.createBrowserContext', { disposeOnDetach: true });
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank', browserContextId });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    const page = (method, params) => cdp.send(method, params, sessionId);
    try {
      const { 'user-agent': ua, cookie, accept, ...rest } = Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
      // A cookie header would be dropped after the first redirect: store the cookies for the whole domain instead,
      // as a visitor who accepted the banner has them. (accept: the browser sends its own, as real visitors do.)
      if (cookie) {
        await page('Network.enable');
        const domain = `.${new URL(url).hostname.replace(/^www\./, '')}`;
        for (const pair of cookie.split(/;\s*/).filter(Boolean)) {
          const at = pair.indexOf('=');
          await page('Network.setCookie', { name: pair.slice(0, at), value: pair.slice(at + 1), domain, path: '/' });
        }
      }
      // A phone visit keeps the phone User-Agent, with the version of the engine that actually runs.
      const userAgent = ua ? `${ua.replace(/Chrome\/[\d.]+/, `Chrome/${major}.0.0.0`).replace(/\s*wp-doctor\S*$/, '')} ${SIGNATURE}` : desktopUa;
      await page('Network.enable');
      await page('Network.setUserAgentOverride', { userAgent });
      if (Object.keys(rest).length) await page('Network.setExtraHTTPHeaders', { headers: rest });
      await page('Fetch.enable', { patterns: [{ urlPattern: '*', requestStage: 'Request' }] });
      return await visit(cdp, sessionId, targetId, url, timeoutMs);
    } finally {
      await cdp.send('Target.closeTarget', { targetId }).catch(() => {});
      await cdp.send('Target.disposeBrowserContext', { browserContextId }).catch(() => {});
    }
  }

  async function close() {
    cdp.close();
    chrome.kill();
    await new Promise((r) => (chrome.exitCode !== null ? r() : chrome.once('exit', r)));
    try {
      rmSync(profile, { recursive: true, force: true });
    } catch {
      // Windows may keep a file locked for a moment: a leftover temp folder is harmless.
    }
  }

  return { transport, close };
}

// One navigation: only the main HTML document goes through, every other request is refused.
function visit(cdp, sessionId, targetId, url, timeoutMs) {
  return new Promise((resolve, reject) => {
    let docId = null;
    let startedAt = null;
    let response = null;
    const timer = setTimeout(() => finish(Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' })), timeoutMs);
    const off = cdp.on(sessionId, async (method, params) => {
      try {
        if (method === 'Fetch.requestPaused') {
          const mainDocument = params.resourceType === 'Document' && (params.frameId === targetId || !params.frameId);
          if (!mainDocument) return cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
          try {
            await guardUrl(params.request.url); // every hop, redirects included
          } catch (error) {
            cdp.send('Fetch.failRequest', { requestId: params.requestId, errorReason: 'BlockedByClient' }, sessionId).catch(() => {});
            return finish(error);
          }
          return cdp.send('Fetch.continueRequest', { requestId: params.requestId }, sessionId).catch(() => {});
        }
        if (method === 'Network.requestWillBeSent' && params.type === 'Document' && params.frameId === targetId) {
          if (docId === null) {
            docId = params.requestId;
            startedAt = params.timestamp;
          }
        } else if (method === 'Network.responseReceived' && params.requestId === docId) {
          response = params.response;
        } else if (method === 'Network.loadingFinished' && params.requestId === docId && response) {
          const { body, base64Encoded } = await cdp.send('Network.getResponseBody', { requestId: docId }, sessionId);
          const t = response.timing;
          // Each visit opens a new connection; plain mode reuses one, like a returning visitor. Leave out the
          // connection setup (DNS, TCP, TLS) so both modes measure the same thing: the server's answer.
          const setup = t && t.connectEnd >= 0 ? t.connectEnd - (t.dnsStart >= 0 ? t.dnsStart : t.connectStart) : 0;
          const headerMap = {};
          for (const [name, value] of Object.entries(response.headers)) headerMap[name.toLowerCase()] = value;
          finish(null, {
            url: response.url,
            requestedUrl: url,
            status: response.status,
            headers: headerMap,
            body: base64Encoded ? Buffer.from(body, 'base64').toString('utf8') : body,
            // Same meaning as in plain mode: from the first request (redirects included) to the headers / the end.
            ttfbMs: Math.round(t ? t.requestTime * 1000 + t.receiveHeadersEnd - startedAt * 1000 - setup : 0),
            totalMs: Math.round((params.timestamp - startedAt) * 1000 - setup),
          });
        } else if (method === 'Network.loadingFailed' && params.requestId === docId) {
          finish(new Error(`The site could not be reached (${params.errorText}).`, { cause: { code: params.errorText } }));
        }
      } catch (error) {
        finish(error);
      }
    });
    function finish(error, result) {
      clearTimeout(timer);
      off();
      if (error) reject(error);
      else resolve(result);
    }
    cdp.send('Page.navigate', { url }, sessionId).then((r) => {
      if (r.errorText && !response) finish(new Error(`The site could not be reached (${r.errorText}).`, { cause: { code: r.errorText } }));
    }, finish);
  });
}

// A minimal DevTools Protocol client: commands with ids, events per session.
function connect(endpoint) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(endpoint);
    let id = 0;
    const pending = new Map();
    const listeners = new Map(); // sessionId -> Set(fn)
    ws.addEventListener('message', (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, fail } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) fail(new Error(`${msg.error.message}`));
        else ok(msg.result);
        return;
      }
      for (const fn of listeners.get(msg.sessionId ?? '') ?? []) fn(msg.method, msg.params);
    });
    ws.addEventListener('error', () => reject(new Error('Could not connect to Chrome.')));
    ws.addEventListener('open', () =>
      resolve({
        send(method, params = {}, sessionId) {
          return new Promise((ok, fail) => {
            const msgId = ++id;
            // A command that never answers must not hang the whole check.
            const timer = setTimeout(() => {
              pending.delete(msgId);
              fail(new Error(`Chrome did not answer ${method}`));
            }, 15000);
            pending.set(msgId, { ok: (v) => (clearTimeout(timer), ok(v)), fail: (e) => (clearTimeout(timer), fail(e)) });
            ws.send(JSON.stringify({ id: msgId, method, params, ...(sessionId ? { sessionId } : {}) }));
          });
        },
        on(sessionId, fn) {
          if (!listeners.has(sessionId)) listeners.set(sessionId, new Set());
          listeners.get(sessionId).add(fn);
          return () => listeners.get(sessionId)?.delete(fn);
        },
        close() {
          ws.close();
        },
      }),
    );
  });
}
