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
import { registerGetActivityTabsTool } from './get_activity_tabs.ts';
import { registerCreateOrUpdateActivityTabTool } from './create_or_update_activity_tab.ts';
import { registerToggleActivityTabTool } from './toggle_activity_tab.ts';
import { registerGetActivityConfigsTool } from './get_activity_configs.ts';
import { registerGetUserIdByIdentifierTool } from './get_user_id_by_identifier.ts';
import { registerGetFissionActivityOptionsTool } from './get_fission_activity_options.ts';
import { registerListHomePagePopupsTool } from './list_home_page_popups.ts';
import { registerCreateHomePagePopupTool } from './create_home_page_popup.ts';
import { registerSetHomePagePopupStatusTool } from './set_home_page_popup_status.ts';
import { registerEditHomePagePopupTool } from './edit_home_page_popup.ts';
import { registerListHomePagePopupFissionActivitiesTool } from './list_home_page_popup_fission_activities.ts';
import { registerListFloatingWindowsTool } from './list_floating_windows.ts';
import { registerCreateFloatingWindowTool } from './create_floating_window.ts';
import { registerUpdateRoomSortOrderTool } from './update_room_sort_order.ts';
import { registerGetMuteHistoryTool } from './get_mute_history.ts';
import { registerCreateOrUpdateRoomMuteTool } from './create_or_update_room_mute.ts';
import { registerUpdateGameVendorMaintenanceStatusTool } from './update_game_vendor_maintenance_status.ts';
import { registerUpdateGameVendorGameStatusTool } from './update_game_vendor_game_status.ts';
import { registerListAllBrandsTool } from './list_all_brands.ts';
import { registerGetBrandForEditTool } from './get_brand_for_edit.ts';
import { registerUpdateBrandStatusTool } from './update_brand_status.ts';
import { registerListAllGameDisplayTagsTool } from './list_all_game_display_tags.ts';
import { registerUpdateGameTagStatusTool } from './update_game_tag_status.ts';
import { registerUpdateGameTagSortOrderTool } from './update_game_tag_sort_order.ts';
import { registerCreateOrUpdateGameDisplayTagTool } from './create_or_update_game_display_tag.ts';
import { registerListCustomerCategoryDetailsTool } from './list_customer_category_details.ts';
import { registerUpdateCustomerCategorySortOrderTool } from './update_customer_category_sort_order.ts';
import { registerUpdateCustomerCategoryStatusTool } from './update_customer_category_status.ts';
import { registerGetCustomerConfigRestrictTool } from './get_customer_config_restrict.ts';
import { registerSetCustomerConfigRestrictTool } from './set_customer_config_restrict.ts';
import { registerGetCustomerTicketsTool } from './get_customer_tickets.ts';

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
    registerGetActivityTabsTool(server);
    registerCreateOrUpdateActivityTabTool(server);
    registerToggleActivityTabTool(server);
    registerGetActivityConfigsTool(server);
    registerGetUserIdByIdentifierTool(server);
    registerGetFissionActivityOptionsTool(server);
    registerListHomePagePopupsTool(server);
    registerCreateHomePagePopupTool(server);
    registerSetHomePagePopupStatusTool(server);
    registerEditHomePagePopupTool(server);
    registerListHomePagePopupFissionActivitiesTool(server);
    registerListFloatingWindowsTool(server);
    registerCreateFloatingWindowTool(server);
    registerUpdateRoomSortOrderTool(server);
    registerGetMuteHistoryTool(server);
    registerCreateOrUpdateRoomMuteTool(server);
    registerUpdateGameVendorMaintenanceStatusTool(server);
    registerUpdateGameVendorGameStatusTool(server);
    registerListAllBrandsTool(server);
    registerGetBrandForEditTool(server);
    registerUpdateBrandStatusTool(server);
    registerListAllGameDisplayTagsTool(server);
    registerUpdateGameTagStatusTool(server);
    registerUpdateGameTagSortOrderTool(server);
    registerCreateOrUpdateGameDisplayTagTool(server);
    registerListCustomerCategoryDetailsTool(server);
    registerUpdateCustomerCategorySortOrderTool(server);
    registerUpdateCustomerCategoryStatusTool(server);
    registerGetCustomerConfigRestrictTool(server);
    registerSetCustomerConfigRestrictTool(server);
    registerGetCustomerTicketsTool(server);
}
