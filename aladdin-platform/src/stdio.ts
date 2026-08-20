#!/usr/bin/env bun
/**
 * stdio.ts — MCP server over stdio transport.
 *
 * 這是 Claude Code 會直接 spawn 的進入點。呼叫端透過 stdin/stdout 講 JSON-RPC，
 * 任何寫到 stdout 但不是 JSON-RPC 訊息的內容都會弄壞協定——log 一律走 stderr。
 *
 * 註冊到 Claude Code（已寫入根目錄 .mcp.json，通常不需要手動再跑一次）：
 *   claude mcp add aladdin-platform \
 *     --command bun \
 *     --args /Users/user/aladdin/obsidian/mcps/aladdin-platform/src/stdio.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerPlatformTools } from './tools/index.ts';
import { buildPlatformInstructions } from './instructions.ts';
import { IS_PROD } from './session.ts';

// H38：prod confirm 閘門（assertProdConfirmed）只看環境變數 IS_PROD，跟 transport
// 類型無關——比照 admin 端 H12 review 收尾的教訓（stdio.ts 一度寫死 false，讓 instructions
// 與 hosted 路徑的閘門判斷基準不一致），這裡從一開始就傳真正的 IS_PROD，不重蹈覆轍。
const server = new McpServer(
    { name: 'aladdin-platform', version: '0.1.0' },
    { capabilities: { tools: {} }, instructions: buildPlatformInstructions(IS_PROD) },
);

registerPlatformTools(server, 'stdio');

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[aladdin-platform MCP] stdio server ready');
