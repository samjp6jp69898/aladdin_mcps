/**
 * tools/get_registration_limit_config.ts — aladdin_platform_security_restriction_platform_get_registration_limit_config
 *
 * rajah: SecurityRestrictionPlatform.GetRegistrationLimitConfig
 * （security_restriction_back_office.rajah:210，@Permission "PlatCapCfg.Security"）
 *
 * 對應前端頁面：「產品系統」→「安全管理」→「註冊規則」分頁的「註冊上限配置」區塊
 * （IP 限制 + 裝置限制）。無參數，單例設定（dev 實測 id 固定為 1）。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, REGISTRATION_LIMIT_PERIOD_MAP, describeEnum, toPlainNumber } from '../const.ts';

/** 供 update_registration_limit_config.ts 共用：把後端 config 轉成呼叫端友善的形狀。 */
export function formatRegistrationLimitConfig(c: Record<string, unknown>): Record<string, unknown> {
    return {
        ...c,
        id: toPlainNumber(c.id),
        ipStatus: describeEnum(ACTIVE_STATUS_MAP, c.ipStatus as number),
        ipLimitPeriodType: describeEnum(REGISTRATION_LIMIT_PERIOD_MAP, c.ipLimitPeriodType as number),
        deviceStatus: describeEnum(ACTIVE_STATUS_MAP, c.deviceStatus as number),
        deviceLimitPeriodType: describeEnum(REGISTRATION_LIMIT_PERIOD_MAP, c.deviceLimitPeriodType as number),
    };
}

export function registerGetRegistrationLimitConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_get_registration_limit_config',
        {
            title: 'Get registration limit config (IP / device)',
            description:
                '讀取本平台「產品系統」→「安全管理」→「註冊規則」分頁中「註冊上限配置」的目前設定' +
                '（rajah: SecurityRestrictionPlatform.GetRegistrationLimitConfig，無參數，單例設定）。' +
                '涵蓋 IP 限制（同一 IP 在統計週期內可註冊帳號數量上限）與裝置限制（同一裝置可註冊帳號數量上限）' +
                '兩組規則，*LimitPrompt 是達到上限時顯示給使用者的多語提示文字（陣列，每筆 {code, value}）。' +
                '要修改請改用 aladdin_platform_security_restriction_platform_update_registration_limit_config' +
                '（內部會先呼叫這支讀現值再合併覆蓋）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetRegistrationLimitConfig());
            if (r.failed) return asErrorResult(r);

            const c = r.data?.config;
            if (!c) return asTextResult({ success: true, config: null });
            return asTextResult({ success: true, config: formatRegistrationLimitConfig(c as unknown as Record<string, unknown>) });
        },
    );
}
