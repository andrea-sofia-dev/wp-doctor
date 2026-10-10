const SYMBOL = { pass: '✔', warn: '!', fail: '✖', info: 'i' };
const COLOR = { pass: 32, warn: 33, fail: 31, info: 36 };

export function textReport(url, results, { color = false, isWp = true, mode = 'plain' } = {}) {
  const paint = (status, s) => (color ? `\x1b[${COLOR[status]}m${s}\x1b[0m` : s);
  const dim = s => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const lines = [`wp-doctor · ${url}`, ''];
  if (mode === 'browser') lines.push(dim('Checked with a real browser: the site refuses plain requests.'), '');
  if (!isWp) lines.push(paint('info', 'Not a WordPress site: general checks only (the WordPress-specific ones are skipped).'), '');

  for (const r of results) {
    lines.push(`${paint(r.status, SYMBOL[r.status])} ${r.title}: ${r.summary}`);
    for (const d of r.details) lines.push(dim(`    ${d}`));
    if (r.fix) lines.push(`    → ${r.fix}`);
  }

  const count = s => results.filter(r => r.status === s).length;
  lines.push('', `${count('pass')} passed · ${plural(count('warn'), 'warning')} · ${count('fail')} failed`);
  return lines.join('\n');
}

export function jsonReport(url, results, { isWp = true, mode = 'plain' } = {}) {
  return JSON.stringify({ url, wordpress: isWp, mode, checkedAt: new Date().toISOString(), results }, null, 2);
}

export function plural(n, word) {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}
