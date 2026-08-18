/**
 * tools/index.ts — 把所有 tool 註冊函式掛到同一個 McpServer 實例。
 * 純聚合層，不放任何業務邏輯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerLoginTool } from './login.ts';
import { registerCreateGameVendorTool } from './create_game_vendor.ts';
import { registerCreateGameTool } from './create_game.ts';
import { registerEditGameTool } from './edit_game.ts';
import { registerListVendorGamesTool } from './list_vendor_games.ts';

export function registerAdminTools(server: McpServer): void {
    registerLoginTool(server);
    registerCreateGameVendorTool(server);
    registerCreateGameTool(server);
    registerEditGameTool(server);
    registerListVendorGamesTool(server);
}
