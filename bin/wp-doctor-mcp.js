#!/usr/bin/env node
// MCP server entry point: lets an AI agent (Claude Code, Claude Desktop, any MCP client) run wp-doctor.
import { readFileSync } from 'node:fs';
import { createServer, serveStdio } from '../src/mcp.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));
serveStdio(createServer({ version: pkg.version }));
