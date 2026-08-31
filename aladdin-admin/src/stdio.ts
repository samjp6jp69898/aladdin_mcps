#!/usr/bin/env bun
/**
 * stdio.ts — MCP server over stdio transport.
 *
 * 這是 Claude Code 會直接 spawn 的進入點。呼叫端透過 stdin/stdout 講 JSON-RPC，
 * 任何寫到 stdout 但不是 JSON-RPC 訊息的內容都會弄壞協定——log 一律走 stderr。
 *
 * 註冊到 Claude Code（已寫入根目錄 .mcp.json，通常不需要手動再跑一次）：
 *   claude mcp add aladdin-admin \
 *     --command bun \
 *     --args /Users/user/aladdin/aladdin_mcps/aladdin-admin/src/stdio.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerAdminTools } from './tools/index.ts';
import { buildAdminInstructions } from './instructions.ts';
import { IS_PROD } from './session.ts';

// H12 review 收尾：prod confirm 閘門（assertProdConfirmed）只看環境變數 IS_PROD，跟
// transport 類型無關——stdio 模式同樣可能連到 ALADDIN_ADMIN_IS_PROD=true 的實例（閘門會
// 照常攔截寫入），instructions 的判斷基準必須跟閘門一致，不能寫死 false 假設本機不會是
// prod。hosted 模式的 http.ts 同樣讀這個常數，兩條路徑現在判斷基準一致。
const server = new McpServer(
    { name: 'aladdin-admin', version: '0.2.0' },
    { capabilities: { tools: {} }, instructions: buildAdminInstructions(IS_PROD) },
);

registerAdminTools(server, 'stdio');

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[aladdin-admin MCP] stdio server ready');
