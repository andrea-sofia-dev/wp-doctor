// The page: send the address to /api/check, show the progress as it streams in, then the report.
// Everything that comes from the checked site is inserted as text, never as HTML.

const STEPS = [
  ['first', 'First visit and repeat visit'],
  ['cookie', 'Visitor with the consent cookie'],
  ['utm', 'Visitor from an ad or newsletter link'],
  ['mobile', 'Visitor on a phone'],
  ['notFound', 'Missing page (404)'],
  ['pages', 'Other pages from the sitemap'],
];
const LABEL = { pass: 'Passed', warn: 'Warning', fail: 'Failed', info: 'Info' };
const ORDER = { fail: 0, warn: 1, info: 2, pass: 3 };

const $ = (id) => document.getElementById(id);
const form = $('form');
const input = $('url');
const button = $('go');
let last = null;

form.addEventListener('submit', (event) => {
  event.preventDefault();
  run(input.value);
});
for (const example of document.querySelectorAll('[data-example]')) {
  example.addEventListener('click', () => {
    input.value = example.dataset.example;
    run(input.value);
  });
}
$('share').addEventListener('click', async () => {
  const link = `${location.origin}/?url=${encodeURIComponent(last.url)}`;
  try {
    await navigator.clipboard.writeText(link);
    flash($('share'), 'Copied');
  } catch {
    prompt('Copy this link', link);
  }
});
$('download').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(last, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `wp-doctor-${new URL(last.url).hostname}.json`;
  a.click();
  URL.revokeObjectURL(a.href);
});

// A shared link (?url=...) runs the check straight away.
const shared = new URLSearchParams(location.search).get('url');
if (shared) {
  input.value = shared;
  run(shared);
}

async function run(value) {
  const address = value.trim();
  if (!address) return input.focus();
  button.disabled = true;
  button.textContent = 'Checking…';
  $('error').hidden = true;
  $('report').hidden = true;
  showSteps();
  history.replaceState(null, '', `?url=${encodeURIComponent(address)}`);

  try {
    const response = await fetch(`/api/check?url=${encodeURIComponent(address)}`);
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value: chunk, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(chunk, { stream: true });
      let newline;
      while ((newline = buffer.indexOf('\n')) >= 0) {
        handle(JSON.parse(buffer.slice(0, newline)));
        buffer = buffer.slice(newline + 1);
      }
    }
  } catch {
    fail('The check could not be completed. Try again in a moment.');
  } finally {
    button.disabled = false;
    button.textContent = 'Check';
  }
}

function handle(message) {
  if (message.type === 'step') markStep(message.step);
  else if (message.type === 'error') fail(message.message);
  else if (message.type === 'result') showReport(message);
}

// ---------- progress ----------

function showSteps() {
  const list = $('steps');
  list.replaceChildren(
    ...STEPS.map(([id, text]) => {
      const li = document.createElement('li');
      li.dataset.step = id;
      li.textContent = text;
      return li;
    }),
  );
  $('progress').hidden = false;
}

function markStep(id) {
  let reached = false;
  for (const li of $('steps').children) {
    if (li.dataset.step === id) {
      li.className = 'is-active';
      reached = true;
    } else {
      li.className = reached ? '' : 'is-done';
    }
  }
}

function fail(text) {
  $('progress').hidden = true;
  $('error').textContent = text;
  $('error').hidden = false;
}

// ---------- report ----------

function showReport(report) {
  last = report;
  $('progress').hidden = true;
  const host = new URL(report.url).hostname;
  const notes = [host];
  if (!report.isWp) notes.push('does not look like WordPress: some checks may not apply');
  if (report.cached) notes.push('checked in the last few minutes');
  $('site').textContent = notes.join(' · ');
  $('cli-url').textContent = host;

  const count = (status) => report.results.filter((r) => r.status === status).length;
  const fails = count('fail');
  const warns = count('warn');
  $('verdict').textContent = report.blocked
    ? 'The site did not let wp-doctor in'
    : fails
      ? `${fails} problem${fails > 1 ? 's' : ''} to fix`
      : warns
        ? `Good, with ${warns} thing${warns > 1 ? 's' : ''} to improve`
        : report.cacheUnverified
          ? 'No problems found, but the cache could not be verified'
          : 'Everything checks out';
  $('score-note').hidden = !report.cacheUnverified;

  const score = report.score ?? 0;
  const ring = document.querySelector('.ring');
  ring.style.strokeDashoffset = String(327 * (1 - score / 100));
  $('score').dataset.level = score >= 90 ? 'good' : score >= 60 ? 'ok' : 'bad';
  $('score-value').textContent = report.score === null ? '–' : String(score);

  $('counts').replaceChildren(
    ...['fail', 'warn', 'pass', 'info']
      .filter((s) => count(s))
      .map((s) => el('li', { className: s }, `${count(s)} ${s === 'warn' ? `warning${count(s) > 1 ? 's' : ''}` : LABEL[s].toLowerCase()}`)),
  );

  const sorted = [...report.results].sort((a, b) => ORDER[a.status] - ORDER[b.status]);
  $('checks').replaceChildren(...sorted.map(card));
  $('report').hidden = false;
  $('report').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
}

function card(result) {
  const article = el('article', { className: `check ${result.status}` });
  article.append(
    el('header', {}, el('span', { className: 'badge' }, LABEL[result.status]), el('h3', {}, result.title)),
    el('p', {}, result.summary),
  );
  if (result.details?.length) article.append(el('ul', { className: 'details' }, ...result.details.map((d) => el('li', {}, d))));
  if (result.fix) article.append(el('p', { className: 'fix' }, el('strong', {}, 'How to fix: '), result.fix));
  // The background for each check: why it matters, how to verify it, the usual fixes per stack.
  if (result.explain && result.status !== 'pass') {
    const more = el('details', { className: 'more' }, el('summary', {}, 'Why it matters and how to fix it'));
    more.append(
      el('p', {}, result.explain.why),
      el('p', { className: 'verify' }, el('strong', {}, 'Check it yourself: '), result.explain.verify),
      el('ul', {}, ...result.explain.fixes.map((f) => el('li', {}, f))),
    );
    article.append(more);
  }
  return article;
}

// ---------- helpers ----------

function el(tag, props, ...children) {
  const node = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
}

function flash(target, text) {
  const original = target.textContent;
  target.textContent = text;
  setTimeout(() => (target.textContent = original), 1500);
}
