/**
 * tools/index.ts — 把所有 tool 註冊函式掛到同一個 McpServer 實例。
 * 純聚合層，不放任何業務邏輯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerLoginTool } from './login.ts';
import { registerListGameVendorsTool } from './list_game_vendors.ts';
import { registerListVendorGamesTool } from './list_vendor_games.ts';
import { registerOnboardVendorGameTool } from './onboard_vendor_game.ts';

export function registerPlatformTools(server: McpServer): void {
    registerLoginTool(server);
    registerListGameVendorsTool(server);
    registerListVendorGamesTool(server);
    registerOnboardVendorGameTool(server);
}
