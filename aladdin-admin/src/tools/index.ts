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
import { registerListPlatformModulesTool } from './list_platform_modules.ts';
import { registerEnablePlatformModuleTool } from './enable_platform_module.ts';
import { registerEnablePlatformModulesTool } from './enable_platform_modules.ts';
import { registerGetCaptchaConfigTool } from './get_captcha_config.ts';
import { registerUpdateCaptchaConfigTool } from './update_captcha_config.ts';
import { registerGetPlatformVerificationConfigsTool } from './get_platform_verification_configs.ts';
import { registerUpdatePlatformVerificationConfigTool } from './update_platform_verification_config.ts';
import { registerListPlatformRiskStrategiesTool } from './list_platform_risk_strategies.ts';
import { registerGetPlatformRiskStrategyForEditTool } from './get_platform_risk_strategy_for_edit.ts';
import { registerCreateOrUpdatePlatformRiskStrategyTool } from './create_or_update_platform_risk_strategy.ts';
import { registerGetGameListTool } from './get_game_list.ts';
import { registerListAvailableGameCodesTool } from './list_available_game_codes.ts';
import { registerGetInHouseVendorListTool } from './get_in_house_vendor_list.ts';
import { registerGetInHousePlayGroupListTool } from './get_in_house_play_group_list.ts';
import { registerGetInHouseGameEditTool } from './get_in_house_game_edit.ts';
import { registerGetInHouseVendorEditTool } from './get_in_house_vendor_edit.ts';
import { registerGetInHousePlayGroupEditTool } from './get_in_house_play_group_edit.ts';
import { registerGetTwoEightOddsSettingTool } from './get_two_eight_odds_setting.ts';
import { registerGetTwoEightBetLimitSettingTool } from './get_two_eight_bet_limit_setting.ts';
import { registerGetTwoEightHedgeSettingTool } from './get_two_eight_hedge_setting.ts';
import { registerUpdateInHouseVendorStatusTool } from './update_in_house_vendor_status.ts';
import { registerUpdateInHousePlayGroupStatusTool } from './update_in_house_play_group_status.ts';
import { registerGetAuditLogsTool } from './get_audit_logs.ts';
import { registerGetCurrenciesTool } from './get_currencies.ts';
import { registerUpdateCurrencyTool } from './update_currency.ts';
import { registerGetPlatformDomainsTool } from './get_platform_domains.ts';
import { registerCreateOrUpdatePlatformDomainTool } from './create_or_update_platform_domain.ts';
import { registerListPlatformTotpModesTool } from './list_platform_totp_modes.ts';
import { registerSetPlatformTotpModeTool } from './set_platform_totp_mode.ts';
import { registerListTotpRouteSettingsTool } from './list_totp_route_settings.ts';
import { registerUpdateTotpRouteSettingTool } from './update_totp_route_setting.ts';
import { registerUpdateTotpRouteSettingStatusTool } from './update_totp_route_setting_status.ts';
import { registerGetDepositAdapterKeysTool } from './get_deposit_adapter_keys.ts';
import { registerListDepositAdaptersTool } from './list_deposit_adapters.ts';
import { registerGetDepositAdapterForEditTool } from './get_deposit_adapter_for_edit.ts';
import { registerCreateDepositAdapterTool } from './create_deposit_adapter.ts';
import { registerUpdateDepositAdapterTool } from './update_deposit_adapter.ts';
import { registerUpdateDepositAdapterStatusTool } from './update_deposit_adapter_status.ts';

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
    registerListPlatformModulesTool(server);
    registerEnablePlatformModuleTool(server);
    registerEnablePlatformModulesTool(server);
    registerGetCaptchaConfigTool(server);
    registerUpdateCaptchaConfigTool(server);
    registerGetPlatformVerificationConfigsTool(server);
    registerUpdatePlatformVerificationConfigTool(server);
    registerListPlatformRiskStrategiesTool(server);
    registerGetPlatformRiskStrategyForEditTool(server);
    registerCreateOrUpdatePlatformRiskStrategyTool(server);
    registerGetGameListTool(server);
    registerListAvailableGameCodesTool(server);
    registerGetInHouseVendorListTool(server);
    registerGetInHousePlayGroupListTool(server);
    registerGetInHouseGameEditTool(server);
    registerGetInHouseVendorEditTool(server);
    registerGetInHousePlayGroupEditTool(server);
    registerGetTwoEightOddsSettingTool(server);
    registerGetTwoEightBetLimitSettingTool(server);
    registerGetTwoEightHedgeSettingTool(server);
    registerUpdateInHouseVendorStatusTool(server);
    registerUpdateInHousePlayGroupStatusTool(server);
    registerGetAuditLogsTool(server);
    registerGetCurrenciesTool(server);
    registerUpdateCurrencyTool(server);
    registerGetPlatformDomainsTool(server);
    registerCreateOrUpdatePlatformDomainTool(server);
    registerListPlatformTotpModesTool(server);
    registerSetPlatformTotpModeTool(server);
    registerListTotpRouteSettingsTool(server);
    registerUpdateTotpRouteSettingTool(server);
    registerUpdateTotpRouteSettingStatusTool(server);
    registerGetDepositAdapterKeysTool(server);
    registerListDepositAdaptersTool(server);
    registerGetDepositAdapterForEditTool(server);
    registerCreateDepositAdapterTool(server);
    registerUpdateDepositAdapterTool(server);
    registerUpdateDepositAdapterStatusTool(server);
}
