/**
 * tools/index.ts — 把所有 tool 註冊函式掛到同一個 McpServer 實例。
 * 純聚合層，不放任何業務邏輯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerLoginTool } from './login.ts';
import { registerCreateGameVendorTool } from './create_game_vendor.ts';
import { registerUpsertGameTool } from './upsert_game.ts';
import { registerListGameVendorsTool } from './list_game_vendors.ts';
import { registerListVendorGamesTool } from './list_vendor_games.ts';
import { registerListPlatformsTool } from './list_platforms.ts';
import { registerListPlatformGameVendorsTool } from './list_platform_game_vendors.ts';
import { registerUpdatePlatformGameVendorStatusTool } from './update_platform_game_vendor_status.ts';
import { registerListGameVendorAdaptersTool } from './list_game_vendor_adapters.ts';
import { registerUpdateGameVendorStatusTool } from './update_game_vendor_status.ts';
import { registerUpdateVendorGameStatusTool } from './update_vendor_game_status.ts';
import { registerGetGameVendorTool } from './get_game_vendor.ts';
import { registerListGameTagNamesTool } from './list_game_tag_names.ts';
import { registerUpdateGameTagNameTool } from './update_game_tag_name.ts';
import { registerSetGameVendorMaintenanceTool } from './set_game_vendor_maintenance.ts';
import { registerCreatePlatformTool } from './create_platform.ts';

export type ServerMode = 'stdio' | 'hosted';

/**
 * H7：hosted 模式停用 login tool（plan.md D4）——企劃端沒有帳密可透過這支
 * tool 使用，且帳密不該經由 MCP tool 參數進入 LLM 對話紀錄；hosted 模式改走
 * POST /login REST 端點（見 http.ts）。stdio 模式（工程師本機）維持註冊，
 * TOTP 互動情境可能還需要它。
 */
export function registerAdminTools(server: McpServer, mode: ServerMode = 'stdio'): void {
    if (mode === 'stdio') {
        registerLoginTool(server);
    }
    registerCreateGameVendorTool(server);
    registerUpsertGameTool(server);
    registerListGameVendorsTool(server);
    registerListVendorGamesTool(server);
    registerListPlatformsTool(server);
    registerListPlatformGameVendorsTool(server);
    registerUpdatePlatformGameVendorStatusTool(server);
    registerListGameVendorAdaptersTool(server);
    registerUpdateGameVendorStatusTool(server);
    registerUpdateVendorGameStatusTool(server);
    registerGetGameVendorTool(server);
    registerListGameTagNamesTool(server);
    registerUpdateGameTagNameTool(server);
    registerSetGameVendorMaintenanceTool(server);
    registerCreatePlatformTool(server);
}
