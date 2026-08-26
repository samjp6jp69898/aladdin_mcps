/**
 * tools/get_login_rules.ts — aladdin_platform_security_restriction_platform_get_login_rules
 *
 * rajah: SecurityRestrictionPlatform.GetLoginRules
 * （security_restriction_back_office.rajah:216，@Permission "PlatCapCfg.Security"）
 *
 * 對應前端頁面：「產品系統」→「安全管理」→「登入規則」分頁，一次回傳三組子設定
 * （登入提示 loginPromptConfig / 登入驗證 loginVerificationConfig / 找回密碼 passwordResetConfig）。
 * 無參數，單例設定。三組各自有獨立的 Update method（見同目錄
 * update_login_prompt_config.ts / update_login_verification_config.ts / update_password_reset_config.ts），
 * 修改時只需呼叫對應那一支，不是整包一起送。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, LOGIN_VERIFICATION_TYPE_MAP, PASSWORD_RESET_PERIOD_UNIT_MAP, describeEnum, toPlainNumber } from '../const.ts';

/** 供 update_login_prompt_config.ts 共用。 */
export function formatLoginPromptConfig(c: Record<string, unknown>): Record<string, unknown> {
    return {
        ...c,
        id: toPlainNumber(c.id),
        mobileAccountRegistrationStatus: describeEnum(ACTIVE_STATUS_MAP, c.mobileAccountRegistrationStatus as number),
        mobilePasswordLoginStatus: describeEnum(ACTIVE_STATUS_MAP, c.mobilePasswordLoginStatus as number),
    };
}

/** 供 update_login_verification_config.ts 共用。 */
export function formatLoginVerificationConfig(c: Record<string, unknown>): Record<string, unknown> {
    return {
        ...c,
        id: toPlainNumber(c.id),
        ipVerificationStatus: describeEnum(ACTIVE_STATUS_MAP, c.ipVerificationStatus as number),
        ipVerificationType: describeEnum(LOGIN_VERIFICATION_TYPE_MAP, c.ipVerificationType as number),
        remoteLoginVerificationStatus: describeEnum(ACTIVE_STATUS_MAP, c.remoteLoginVerificationStatus as number),
        remoteLoginVerificationType: describeEnum(LOGIN_VERIFICATION_TYPE_MAP, c.remoteLoginVerificationType as number),
        deviceVerificationStatus: describeEnum(ACTIVE_STATUS_MAP, c.deviceVerificationStatus as number),
        deviceVerificationType: describeEnum(LOGIN_VERIFICATION_TYPE_MAP, c.deviceVerificationType as number),
        passwordErrorVerificationStatus: describeEnum(ACTIVE_STATUS_MAP, c.passwordErrorVerificationStatus as number),
        passwordErrorVerificationType: describeEnum(LOGIN_VERIFICATION_TYPE_MAP, c.passwordErrorVerificationType as number),
    };
}

/** 供 update_password_reset_config.ts 共用。 */
export function formatPasswordResetConfig(c: Record<string, unknown>): Record<string, unknown> {
    return { ...c, id: toPlainNumber(c.id), resetPeriodUnit: describeEnum(PASSWORD_RESET_PERIOD_UNIT_MAP, c.resetPeriodUnit as number) };
}

export function registerGetLoginRulesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_get_login_rules',
        {
            title: 'Get login rules (prompt / verification / password reset)',
            description:
                '讀取本平台「產品系統」→「安全管理」→「登入規則」分頁目前的完整設定' +
                '（rajah: SecurityRestrictionPlatform.GetLoginRules，無參數，單例設定）。' +
                '回傳三組子設定：loginPromptConfig（手機號註冊/登入開關）、' +
                'loginVerificationConfig（真實姓名錯誤次數、IP/異地/設備/密碼錯誤等異常登入驗證規則）、' +
                'passwordResetConfig（找回密碼限制週期與次數）。三組各自獨立修改，' +
                '分別對應 update_login_prompt_config / update_login_verification_config / ' +
                'update_password_reset_config 三支 tool，修改時只需呼叫對應那一支（會自動先讀這支再合併覆蓋）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetLoginRules());
            if (r.failed) return asErrorResult(r);

            const rule = r.data?.rule;
            if (!rule) return asTextResult({ success: true, rule: null });

            return asTextResult({
                success: true,
                rule: {
                    loginPromptConfig: rule.loginPromptConfig
                        ? formatLoginPromptConfig(rule.loginPromptConfig as unknown as Record<string, unknown>) : null,
                    loginVerificationConfig: rule.loginVerificationConfig
                        ? formatLoginVerificationConfig(rule.loginVerificationConfig as unknown as Record<string, unknown>) : null,
                    passwordResetConfig: rule.passwordResetConfig
                        ? formatPasswordResetConfig(rule.passwordResetConfig as unknown as Record<string, unknown>) : null,
                },
            });
        },
    );
}
