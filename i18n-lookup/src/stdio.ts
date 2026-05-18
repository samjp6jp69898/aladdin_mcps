#!/usr/bin/env bun
/**
 * stdio.ts — MCP server over stdio transport.
 *
 * This is what Claude Code / Claude Desktop / Cursor will spawn.
 * The client launches this file as a subprocess and talks JSON-RPC
 * over stdin/stdout. Anything written to stdout that is NOT a
 * JSON-RPC message will corrupt the protocol — keep logs on stderr.
 *
 * Register with Claude Code:
 *   claude mcp add i18n-lookup \
 *     --command bun \
 *     --args /Users/user/aladdin/obsidian/mcps/i18n-lookup/src/stdio.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerI18nTools } from './tools.ts';

const server = new McpServer(
    { name: 'i18n-lookup', version: '0.1.0' },
    { capabilities: { tools: {} } },
);

registerI18nTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

// All logs must go to stderr — stdout is reserved for JSON-RPC frames.
console.error('[i18n-lookup MCP] stdio server ready');
