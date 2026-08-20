/**
 * tools/index.ts — 把所有 tool 註冊函式掛到同一個 McpServer 實例。
 * 純聚合層，不放任何業務邏輯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerGenerateToolTool } from './generate_tool.ts';
import { registerQueryLogTool } from './query_log.ts';

export function registerToolsmithTools(server: McpServer): void {
    registerGenerateToolTool(server);
    registerQueryLogTool(server);
}
