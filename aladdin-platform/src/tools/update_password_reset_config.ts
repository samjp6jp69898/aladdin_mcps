/**
 * tools/update_password_reset_config.ts — aladdin_platform_security_restriction_platform_update_password_reset_config
 *
 * rajah: SecurityRestrictionPlatform.GetLoginRules + UpdatePasswordResetConfig
 * （security_restriction_back_office.rajah:216-225，@Permission "PlatCapCfg.Security.LoginRule.PwReset.Save"）
 *
 * PasswordResetConfig 沒有 @Optional 標記，先呼叫 GetLoginRules 取現值（取其中的 passwordResetConfig
 * 子物件），只覆蓋呼叫端明確帶的欄位，其餘原樣帶回，完成後 round-trip 再讀一次驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PasswordResetConfig } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PASSWORD_RESET_PERIOD_UNIT_MAP } from '../const.ts';
import { formatPasswordResetConfig } from './get_login_rules.ts';

const periodUnit = z.enum([ 'day', 'week', 'month', 'year' ]);

export function registerUpdatePasswordResetConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_update_password_reset_config',
        {
            title: 'Update password reset (forgot password) limit config',
            description:
                '修改本平台「產品系統」→「安全管理」→「登入規則」分頁中「找回密碼配置」設定並儲存' +
                '（rajah: SecurityRestrictionPlatform.UpdatePasswordResetConfig）。單例設定，' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，不會被清空或歸零。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion 明確詢問使用者是否同意，' +
                '取得同意後才可以帶上 confirm 參數；非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                resetPeriod: z.number().int().min(1).optional().describe('找回密碼限制週期數值（配合 resetPeriodUnit）'),
                resetPeriodUnit: periodUnit.optional().describe('找回密碼限制週期單位：day/week/month/year'),
                resetLimit: z.number().int().min(1).optional().describe('週期內可找回密碼次數上限'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetLoginRules());
            if (getR.failed) return asErrorResult(getR);

            const base = getR.data?.rule?.passwordResetConfig;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.resetPeriod !== undefined) overrides.resetPeriod = input.resetPeriod;
            if (input.resetPeriodUnit !== undefined) overrides.resetPeriodUnit = PASSWORD_RESET_PERIOD_UNIT_MAP[ input.resetPeriodUnit ];
            if (input.resetLimit !== undefined) overrides.resetLimit = input.resetLimit;

            const merged = PasswordResetConfig.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.UpdatePasswordResetConfig(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetLoginRules());
            const checkConfig = checkR.failed ? undefined : checkR.data?.rule?.passwordResetConfig;
            return asTextResult({
                success: true,
                message: '找回密碼配置已更新',
                config: checkConfig ? formatPasswordResetConfig(checkConfig as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
