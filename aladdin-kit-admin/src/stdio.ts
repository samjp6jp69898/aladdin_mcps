#!/usr/bin/env bun
/**
 * stdio.ts — aladdin-kit-admin MCP server（stdio-only，沒有 http.ts，也不應該有）。
 *
 * 只給工程師自己的 .mcp.json 用，絕對不要把這支 server 掛進任何會交給企劃的 kit、
 * 也絕對不要為它做 hosted（http.ts + launchd 常駐 + proxy 路由）。這支 server 的
 * tool 本質是「核發企劃的完整 agrabah 帳號權限」（呼叫
 * ../aladdin-ai-assistant-kit/make-starter-kit.ts），跟 aladdin-admin/aladdin-platform
 * 給企劃用的業務 tool 完全不是同一個信任等級——只有能在這台機器上執行 Claude Code
 * 的人（就是工程師本人）才應該碰得到這支 server。
 *
 * 註冊到 Claude Code（根目錄 /Users/user/aladdin/.mcp.json）：
 *   claude mcp add aladdin-kit-admin \
 *     --command bun \
 *     --args /Users/user/aladdin/aladdin_mcps/aladdin-kit-admin/src/stdio.ts
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';

import { registerKitAdminTools } from './tools/index.ts';

const server = new McpServer(
    { name: 'aladdin-kit-admin', version: '0.1.0' },
    {
        capabilities: { tools: {} },
        instructions:
            '這支 server 只給工程師本機使用，用來核發/查詢企劃 starter kit 的個人 Bearer token' +
            '（包裝 make-starter-kit.ts）。絕對不要把這支 server 註冊進任何會交付給企劃的 .mcp.json，' +
            '也不要嘗試把它部署成 hosted 服務。',
    },
);

registerKitAdminTools(server);

const transport = new StdioServerTransport();
await server.connect(transport);

console.error('[aladdin-kit-admin MCP] stdio server ready');
