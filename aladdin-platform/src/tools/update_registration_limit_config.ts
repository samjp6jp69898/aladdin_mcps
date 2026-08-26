/**
 * tools/update_registration_limit_config.ts — aladdin_platform_security_restriction_platform_update_registration_limit_config
 *
 * rajah: SecurityRestrictionPlatform.GetRegistrationLimitConfig + UpdateRegistrationLimitConfig
 * （security_restriction_back_office.rajah:210-213，@Permission "PlatCapCfg.Security.RegRule.Lmt.Save"）
 *
 * RegistrationLimitConfig 沒有 @Optional 標記，method-category-checklist.md 第 4 節要求無條件先讀
 * 現值再合併：先呼叫 GetRegistrationLimitConfig 取得完整現值（含 id），只覆蓋呼叫端明確帶的欄位，
 * 其餘原樣帶回，完成後 round-trip 再讀一次驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RegistrationLimitConfig, LocalizationString } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, REGISTRATION_LIMIT_PERIOD_MAP } from '../const.ts';
import { formatRegistrationLimitConfig } from './get_registration_limit_config.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);
const periodType = z.enum([ 'day', 'week', 'permanent' ]);
const localizationSchema = z.object({ code: z.string(), value: z.string() });

export function registerUpdateRegistrationLimitConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_update_registration_limit_config',
        {
            title: 'Update registration limit config (IP / device)',
            description:
                '修改本平台「產品系統」→「安全管理」→「註冊規則」分頁中「註冊上限配置」的設定並儲存' +
                '（rajah: SecurityRestrictionPlatform.UpdateRegistrationLimitConfig）。無參數的 platformId，' +
                '單例設定，平台由連線本身判定。所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，' +
                '不會被清空或歸零。*LimitPrompt 若要修改必須帶完整陣列（覆蓋整個陣列，不是逐筆合併），' +
                '建議先呼叫 get 版本工具看目前完整陣列內容再決定要不要修改。完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion 明確詢問使用者是否同意，' +
                '取得同意後才可以帶上 confirm 參數；非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                ipStatus: statusToggle.optional().describe('IP 限制開關'),
                ipLimitPeriodType: periodType.optional().describe('IP 限制統計週期：day=1天、week=1週、permanent=永久'),
                ipMaxCount: z.number().int().min(0).optional().describe('同一 IP 在統計週期內可註冊帳號數量上限'),
                ipLimitPrompt: z.array(localizationSchema).optional().describe('達 IP 上限時的多語提示文字（覆蓋整個陣列）'),
                deviceStatus: statusToggle.optional().describe('裝置限制開關'),
                deviceLimitPeriodType: periodType.optional().describe('裝置限制統計週期：day=1天、week=1週、permanent=永久'),
                deviceMaxCount: z.number().int().min(0).optional().describe('同一裝置在統計週期內可註冊帳號數量上限'),
                deviceLimitPrompt: z.array(localizationSchema).optional().describe('達裝置上限時的多語提示文字（覆蓋整個陣列）'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetRegistrationLimitConfig());
            if (getR.failed) return asErrorResult(getR);

            const base = getR.data?.config;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.ipStatus !== undefined) overrides.ipStatus = ACTIVE_STATUS_MAP[ input.ipStatus ];
            if (input.ipLimitPeriodType !== undefined) overrides.ipLimitPeriodType = REGISTRATION_LIMIT_PERIOD_MAP[ input.ipLimitPeriodType ];
            if (input.ipMaxCount !== undefined) overrides.ipMaxCount = input.ipMaxCount;
            if (input.ipLimitPrompt !== undefined) overrides.ipLimitPrompt = input.ipLimitPrompt.map((p) => LocalizationString.create(p));
            if (input.deviceStatus !== undefined) overrides.deviceStatus = ACTIVE_STATUS_MAP[ input.deviceStatus ];
            if (input.deviceLimitPeriodType !== undefined) overrides.deviceLimitPeriodType = REGISTRATION_LIMIT_PERIOD_MAP[ input.deviceLimitPeriodType ];
            if (input.deviceMaxCount !== undefined) overrides.deviceMaxCount = input.deviceMaxCount;
            if (input.deviceLimitPrompt !== undefined) overrides.deviceLimitPrompt = input.deviceLimitPrompt.map((p) => LocalizationString.create(p));

            const merged = RegistrationLimitConfig.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.UpdateRegistrationLimitConfig(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetRegistrationLimitConfig());
            const checkConfig = checkR.failed ? undefined : checkR.data?.config;
            return asTextResult({
                success: true,
                message: '註冊上限配置已更新',
                config: checkConfig ? formatRegistrationLimitConfig(checkConfig as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
