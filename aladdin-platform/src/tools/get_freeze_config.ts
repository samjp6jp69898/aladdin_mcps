/**
 * tools/get_freeze_config.ts — aladdin_platform_security_restriction_platform_get_freeze_config
 *
 * rajah: SecurityRestrictionPlatform.GetFreezeConfig
 * （security_restriction_back_office.rajah:240，@Permission "PlatCapCfg.Security.FreezeManagement"）
 *
 * 對應前端頁面：「產品系統」→「安全管理」→「凍結管理」分頁。無參數，單例設定，
 * 固定回傳兩組規則：passwordError（登錄密碼錯誤凍結規則）、cancelOrder（取消充值訂單凍結規則）。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, FREEZE_DURATION_UNIT_MAP, describeEnum } from '../const.ts';

/** 供 update_freeze_config.ts 共用。 */
export function formatFreezeRuleConfig(rule: Record<string, unknown>): Record<string, unknown> {
    return {
        ...rule,
        enabled: describeEnum(ACTIVE_STATUS_MAP, rule.enabled as number),
        autoUnfreeze: describeEnum(ACTIVE_STATUS_MAP, rule.autoUnfreeze as number),
        freezeDurationUnit: describeEnum(FREEZE_DURATION_UNIT_MAP, rule.freezeDurationUnit as number),
    };
}

export function registerGetFreezeConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_get_freeze_config',
        {
            title: 'Get account freeze management config',
            description:
                '讀取本平台「產品系統」→「安全管理」→「凍結管理」分頁目前的設定' +
                '（rajah: SecurityRestrictionPlatform.GetFreezeConfig，無參數，單例設定）。' +
                '固定回傳兩組規則：passwordError（登錄密碼錯誤累計達 triggerLimit 次後的凍結規則）、' +
                'cancelOrder（取消充值訂單累計達 triggerLimit 次後的凍結規則）。' +
                'autoUnfreeze 開關代表凍結時長（freezeDuration + freezeDurationUnit）到期後是否自動解凍，' +
                'userMessage 是觸發凍結時顯示給使用者的多語提示文字。要修改請改用' +
                'aladdin_platform_security_restriction_platform_update_freeze_config' +
                '（內部會先呼叫這支讀現值再合併覆蓋）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetFreezeConfig());
            if (r.failed) return asErrorResult(r);

            const c = r.data?.config;
            if (!c) return asTextResult({ success: true, config: null });
            return asTextResult({
                success: true,
                config: {
                    passwordError: c.passwordError ? formatFreezeRuleConfig(c.passwordError as unknown as Record<string, unknown>) : null,
                    cancelOrder: c.cancelOrder ? formatFreezeRuleConfig(c.cancelOrder as unknown as Record<string, unknown>) : null,
                },
            });
        },
    );
}
