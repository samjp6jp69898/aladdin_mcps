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
import { registerListPlatformRiskStrategiesTool } from './list_platform_risk_strategies.ts';
import { registerGetPlatformRiskStrategiesTool } from './get_platform_risk_strategies.ts';
import { registerGetPlatformRiskStrategyForEditTool } from './get_platform_risk_strategy_for_edit.ts';
import { registerUpdatePlatformRiskStrategyStatusTool } from './update_platform_risk_strategy_status.ts';
import { registerListPlatformRiskEventsTool } from './list_platform_risk_events.ts';
import { registerGetIpRegionListTool } from './get_ip_region_list.ts';
import { registerCreateOrUpdateIpRegionTool } from './create_or_update_ip_region.ts';
import { registerUpdateIpRegionStatusTool } from './update_ip_region_status.ts';
import { registerBatchUpdateIpRegionStatusTool } from './batch_update_ip_region_status.ts';
import { registerDeleteIpRegionTool } from './delete_ip_region.ts';
import { registerBatchDeleteIpRegionTool } from './batch_delete_ip_region.ts';

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
    registerListPlatformRiskStrategiesTool(server);
    registerGetPlatformRiskStrategiesTool(server);
    registerGetPlatformRiskStrategyForEditTool(server);
    registerUpdatePlatformRiskStrategyStatusTool(server);
    registerListPlatformRiskEventsTool(server);
    registerGetIpRegionListTool(server);
    registerCreateOrUpdateIpRegionTool(server);
    registerUpdateIpRegionStatusTool(server);
    registerBatchUpdateIpRegionStatusTool(server);
    registerDeleteIpRegionTool(server);
    registerBatchDeleteIpRegionTool(server);
}
