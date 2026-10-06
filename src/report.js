const SYMBOL = { pass: '✔', warn: '!', fail: '✖', info: 'i' };
const COLOR = { pass: 32, warn: 33, fail: 31, info: 36 };

export function textReport(url, results, { color = false, isWp = true } = {}) {
  const paint = (status, s) => (color ? `\x1b[${COLOR[status]}m${s}\x1b[0m` : s);
  const dim = s => (color ? `\x1b[2m${s}\x1b[0m` : s);
  const lines = [`wp-doctor · ${url}`, ''];
  if (!isWp) lines.push(paint('info', 'Note: this does not look like a WordPress site. The checks still apply to any page.'), '');

  for (const r of results) {
    lines.push(`${paint(r.status, SYMBOL[r.status])} ${r.title}: ${r.summary}`);
    for (const d of r.details) lines.push(dim(`    ${d}`));
    if (r.fix) lines.push(`    → ${r.fix}`);
  }

  const count = s => results.filter(r => r.status === s).length;
  lines.push('', `${count('pass')} passed · ${count('warn')} warnings · ${count('fail')} failed`);
  return lines.join('\n');
}

export function jsonReport(url, results, { isWp = true } = {}) {
  return JSON.stringify({ url, wordpress: isWp, checkedAt: new Date().toISOString(), results }, null, 2);
}
