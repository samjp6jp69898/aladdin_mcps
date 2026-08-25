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
import { registerGetGameLocalizationsTool } from './get_game_localizations.ts';
import { registerListTwoEightGamesTool } from './list_two_eight_games.ts';
import { registerListInHouseVendorsTool } from './list_in_house_vendors.ts';
import { registerGetGameVendorTool } from './get_game_vendor.ts';
import { registerUpdateGameVendorTool } from './update_game_vendor.ts';
import { registerResolveInHousePlayGroupGameIdsTool } from './resolve_in_house_play_group_game_ids.ts';
import { registerUpdateGameVendorStatusTool } from './update_game_vendor_status.ts';
import { registerGetShowCategoryTool } from './get_show_category.ts';
import { registerUpdateShowCategoryTool } from './update_show_category.ts';
import { registerListClassificationCategoriesTool } from './list_classification_categories.ts';
import { registerCreateOrUpdateClassificationTool } from './create_or_update_classification.ts';
import { registerDeleteClassificationTool } from './delete_classification.ts';
import { registerGetCategoriesByClassificationTool } from './get_categories_by_classification.ts';
import { registerListUserTransactionsTool } from './list_user_transactions.ts';
import { registerGetAuditLogsTool } from './get_audit_logs.ts';

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
    registerGetGameLocalizationsTool(server);
    registerListTwoEightGamesTool(server);
    registerListInHouseVendorsTool(server);
    registerGetGameVendorTool(server);
    registerUpdateGameVendorTool(server);
    registerResolveInHousePlayGroupGameIdsTool(server);
    registerUpdateGameVendorStatusTool(server);
    registerGetShowCategoryTool(server);
    registerUpdateShowCategoryTool(server);
    registerListClassificationCategoriesTool(server);
    registerCreateOrUpdateClassificationTool(server);
    registerDeleteClassificationTool(server);
    registerGetCategoriesByClassificationTool(server);
    registerListUserTransactionsTool(server);
    registerGetAuditLogsTool(server);
}
