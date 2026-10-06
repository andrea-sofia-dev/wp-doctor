// A minimal Model Context Protocol server: JSON-RPC 2.0 over stdio, one message per line.
// No SDK dependency; it implements the parts a tool server needs (initialize, ping,
// tools/list, tools/call) and nothing else.

import { collect } from './collect.js';
import { runChecks } from './checks.js';
import { isWordPress } from './html.js';
import { textReport } from './report.js';
import { EXPLANATIONS, explain } from './explain.js';

const SUPPORTED_VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

const TOOLS = [
  {
    name: 'check_site',
    title: 'Check a WordPress site',
    description:
      'Audit a public WordPress site from the outside (four ordinary GET requests): server response time, page cache ' +
      '(also for visitors with cookies and with UTM parameters), compression, viewport tag position, main image priority, ' +
      'render-blocking files, reCAPTCHA and plugin files. Returns a readable report and the results as JSON. ' +
      'Use explain_check on any warning or failure to get concrete fixes. Only check sites the user owns or may test.',
    inputSchema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'Page to check, e.g. https://example.com/ (https:// is added if missing)' },
      },
      required: ['url'],
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  {
    name: 'list_checks',
    title: 'List the checks',
    description: 'List the checks wp-doctor runs, with their ids.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
  {
    name: 'explain_check',
    title: 'Explain a check',
    description:
      'Why a check matters, how to verify it by hand, and the usual fixes for WP Super Cache, W3 Total Cache, ' +
      'LiteSpeed, Cloudflare, nginx and theme code. Pass the id from a check_site result.',
    inputSchema: {
      type: 'object',
      properties: { id: { type: 'string', enum: Object.keys(EXPLANATIONS) } },
      required: ['id'],
    },
    annotations: { readOnlyHint: true, openWorldHint: false },
  },
];

export function createServer({ version = '0.0.0', check = defaultCheck } = {}) {
  return async function handle(msg) {
    // Notifications (no id) never get a response.
    if (msg.id === undefined || msg.id === null) return null;
    try {
      const result = await dispatch(msg, { version, check });
      return { jsonrpc: '2.0', id: msg.id, result };
    } catch (err) {
      return { jsonrpc: '2.0', id: msg.id, error: { code: err.code ?? -32603, message: err.message } };
    }
  };
}

async function dispatch(msg, { version, check }) {
  switch (msg.method) {
    case 'initialize': {
      const asked = msg.params?.protocolVersion;
      return {
        protocolVersion: SUPPORTED_VERSIONS.includes(asked) ? asked : SUPPORTED_VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: 'wp-doctor', title: 'wp-doctor', version },
        instructions:
          'wp-doctor audits WordPress sites from the outside. Run check_site, then call explain_check for each ' +
          'warning or failure before proposing changes, and tell the user which fixes need server or plugin access.',
      };
    }
    case 'ping':
      return {};
    case 'tools/list':
      return { tools: TOOLS };
    case 'tools/call':
      return callTool(msg.params?.name, msg.params?.arguments ?? {}, check);
    default:
      throw Object.assign(new Error(`Method not found: ${msg.method}`), { code: -32601 });
  }
}

async function callTool(name, args, check) {
  if (name === 'list_checks') {
    const lines = Object.entries(EXPLANATIONS).map(([id, e]) => `- ${id}: ${e.title}`);
    return text(lines.join('\n'));
  }
  if (name === 'explain_check') {
    const out = explain(args.id);
    return out ? text(out) : toolError(`Unknown check id "${args.id}". Known ids: ${Object.keys(EXPLANATIONS).join(', ')}`);
  }
  if (name === 'check_site') {
    if (typeof args.url !== 'string' || !args.url.trim()) return toolError('The "url" argument is required.');
    let url = args.url.trim();
    if (!/^https?:\/\//i.test(url)) url = `https://${url}`;
    try {
      const { finalUrl, results, isWp } = await check(url);
      const report = textReport(finalUrl, results, { color: false, isWp });
      const json = JSON.stringify({ url: finalUrl, wordpress: isWp, results }, null, 2);
      return {
        content: [
          { type: 'text', text: report },
          { type: 'text', text: json },
        ],
        isError: false,
      };
    } catch (err) {
      return toolError(`Could not check ${url}: ${err.cause?.code || err.message}`);
    }
  }
  throw Object.assign(new Error(`Unknown tool: ${name}`), { code: -32602 });
}

async function defaultCheck(url) {
  const data = await collect(url);
  return { finalUrl: data.url, results: runChecks(data), isWp: isWordPress(data.warm.body, data.warm.headers) };
}

const text = t => ({ content: [{ type: 'text', text: t }], isError: false });
const toolError = t => ({ content: [{ type: 'text', text: t }], isError: true });

// Reads newline-delimited JSON-RPC from input, writes responses to output.
// Logs go to stderr only: stdout belongs to the protocol.
export function serveStdio(handle, { input = process.stdin, output = process.stdout } = {}) {
  let buffer = '';
  input.setEncoding('utf8');
  input.on('data', chunk => {
    buffer += chunk;
    let nl;
    while ((nl = buffer.indexOf('\n')) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        output.write(JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }) + '\n');
        continue;
      }
      Promise.resolve(handle(msg)).then(res => {
        if (res) output.write(JSON.stringify(res) + '\n');
      });
    }
  });
}
