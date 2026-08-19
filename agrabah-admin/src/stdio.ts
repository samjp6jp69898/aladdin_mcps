#!/usr/bin/env bun
/**
 * stdio.ts — MCP server over stdio transport.
 *
 * 這是 Claude Code 會直接 spawn 的進入點。呼叫端透過 stdin/stdout 講 JSON-RPC，
 * 任何寫到 stdout 但不是 JSON-RPC 訊息的內容都會弄壞協定——log 一律走 stderr。
 *
 * 註冊到 Claude Code（已寫入根目錄 .mcp.json，通常不需要手動再跑一次）：
 *   claude mcp add agrabah-admin \
 *     --command bun \
 *     --args /Users/user/aladdin/obsidian/mcps/agrabah-admin/src/stdio.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerAdminTools } from './tools/index.ts';
import { buildAdminInstructions } from './instructions.ts';

// stdio 模式是工程師本機直接執行，一律不是 prod（isProd 固定 false）；hosted 模式的
// http.ts 依實際 IS_PROD 動態組字，見該檔對應段落。
const server = new McpServer(
    { name: 'agrabah-admin', version: '0.2.0' },
    { capabilities: { tools: {} }, instructions: buildAdminInstructions(false) },
);

registerAdminTools(server, 'stdio');

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[agrabah-admin MCP] stdio server ready');
