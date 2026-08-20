/**
 * tools/index.ts — 把所有 tool 註冊函式掛到同一個 McpServer 實例。純聚合層，不放業務邏輯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerIssueKitTool } from './issue.ts';
import { registerListKitsTool } from './list.ts';

export function registerKitAdminTools(server: McpServer): void {
    registerIssueKitTool(server);
    registerListKitsTool(server);
}
