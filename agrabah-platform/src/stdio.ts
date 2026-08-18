#!/usr/bin/env bun
/**
 * stdio.ts — MCP server over stdio transport.
 *
 * 這是 Claude Code 會直接 spawn 的進入點。呼叫端透過 stdin/stdout 講 JSON-RPC，
 * 任何寫到 stdout 但不是 JSON-RPC 訊息的內容都會弄壞協定——log 一律走 stderr。
 *
 * 註冊到 Claude Code（已寫入根目錄 .mcp.json，通常不需要手動再跑一次）：
 *   claude mcp add agrabah-platform \
 *     --command bun \
 *     --args /Users/user/aladdin/obsidian/mcps/agrabah-platform/src/stdio.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerPlatformTools } from './tools/index.ts';

const server = new McpServer(
    { name: 'agrabah-platform', version: '0.1.0' },
    { capabilities: { tools: {} } },
);

registerPlatformTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[agrabah-platform MCP] stdio server ready');
