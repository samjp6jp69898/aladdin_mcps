/**
 * tools/index.ts — 把所有 tool 註冊函式掛到同一個 McpServer 實例。
 * 純聚合層，不放任何業務邏輯。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { registerLoginTool } from './login.ts';
import { registerListGameVendorsTool } from './list_game_vendors.ts';
import { registerListVendorGamesTool } from './list_vendor_games.ts';
import { registerOnboardVendorGameTool } from './onboard_vendor_game.ts';
import { registerGetMessageBoardSettingTool } from './get_message_board_setting.ts';
import { registerUpdateMessageBoardSettingTool } from './update_message_board_setting.ts';

export type ServerMode = 'stdio' | 'hosted';

/**
 * H7：hosted 模式停用 login tool（plan.md D4），設計理由與 admin 端逐字相同，
 * 完整說明見 obsidian/mcps/aladdin-admin/src/tools/index.ts 同一段註解。
 */
export function registerPlatformTools(server: McpServer, mode: ServerMode = 'stdio'): void {
    if (mode === 'stdio') {
        registerLoginTool(server);
    }
    registerListGameVendorsTool(server);
    registerListVendorGamesTool(server);
    registerOnboardVendorGameTool(server);
    registerGetMessageBoardSettingTool(server);
    registerUpdateMessageBoardSettingTool(server);
}
