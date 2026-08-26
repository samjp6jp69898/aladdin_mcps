/**
 * tools/update_login_prompt_config.ts — aladdin_platform_security_restriction_platform_update_login_prompt_config
 *
 * rajah: SecurityRestrictionPlatform.GetLoginRules + UpdateLoginPromptConfig
 * （security_restriction_back_office.rajah:216-219，@Permission "PlatCapCfg.Security.LoginRule.Prompt.Save"）
 *
 * LoginPromptConfig 沒有 @Optional 標記，先呼叫 GetLoginRules 取現值（取其中的 loginPromptConfig 子物件），
 * 只覆蓋呼叫端明確帶的欄位，其餘原樣帶回，完成後 round-trip 再讀一次驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { LoginPromptConfig } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';
import { formatLoginPromptConfig } from './get_login_rules.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);

export function registerUpdateLoginPromptConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_update_login_prompt_config',
        {
            title: 'Update login prompt config',
            description:
                '修改本平台「產品系統」→「安全管理」→「登入規則」分頁中「登入提示」設定並儲存' +
                '（rajah: SecurityRestrictionPlatform.UpdateLoginPromptConfig）。單例設定，' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，不會被清空或歸零。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion 明確詢問使用者是否同意，' +
                '取得同意後才可以帶上 confirm 參數；非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                mobileAccountRegistrationStatus: statusToggle.optional().describe('手機號註冊開關'),
                mobilePasswordLoginStatus: statusToggle.optional().describe('手機號/密碼登入開關'),
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

            const base = getR.data?.rule?.loginPromptConfig;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.mobileAccountRegistrationStatus !== undefined) {
                overrides.mobileAccountRegistrationStatus = ACTIVE_STATUS_MAP[ input.mobileAccountRegistrationStatus ];
            }
            if (input.mobilePasswordLoginStatus !== undefined) {
                overrides.mobilePasswordLoginStatus = ACTIVE_STATUS_MAP[ input.mobilePasswordLoginStatus ];
            }

            const merged = LoginPromptConfig.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.UpdateLoginPromptConfig(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetLoginRules());
            const checkConfig = checkR.failed ? undefined : checkR.data?.rule?.loginPromptConfig;
            return asTextResult({
                success: true,
                message: '登入提示設定已更新',
                config: checkConfig ? formatLoginPromptConfig(checkConfig as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
