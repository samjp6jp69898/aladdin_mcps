/**
 * tools/update_login_verification_config.ts — aladdin_platform_security_restriction_platform_update_login_verification_config
 *
 * rajah: SecurityRestrictionPlatform.GetLoginRules + UpdateLoginVerificationConfig
 * （security_restriction_back_office.rajah:216-222，@Permission "PlatCapCfg.Security.LoginRule.Ver.Save"）
 *
 * LoginVerificationConfig 沒有 @Optional 標記，先呼叫 GetLoginRules 取現值（取其中的
 * loginVerificationConfig 子物件），只覆蓋呼叫端明確帶的欄位，其餘原樣帶回，完成後 round-trip 再讀一次驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { LoginVerificationConfig } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, LOGIN_VERIFICATION_TYPE_MAP } from '../const.ts';
import { formatLoginVerificationConfig } from './get_login_rules.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);
const verificationType = z.enum([ 'otp', 'realName' ]);

export function registerUpdateLoginVerificationConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_security_restriction_platform_update_login_verification_config',
        {
            title: 'Update login verification config',
            description:
                '修改本平台「產品系統」→「安全管理」→「登入規則」分頁中「登入驗證」設定並儲存' +
                '（rajah: SecurityRestrictionPlatform.UpdateLoginVerificationConfig）。單例設定，' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，不會被清空或歸零。' +
                '涵蓋 IP 異常登入驗證、異地登入驗證、設備異常登入驗證、密碼錯誤驗證四組獨立開關，' +
                '各自的 xxxVerificationType 決定該規則觸發時要求 otp（手機短信）或 realName（真實姓名）驗證。' +
                '互斥限制（後端實測查證，agrabah security_restriction_platform.ts）：' +
                'passwordErrorVerificationStatus 設為 enabled 時，若「凍結管理」' +
                '（aladdin_platform_security_restriction_platform_get_freeze_config 的 passwordError 規則）已經是 enabled，' +
                '後端會直接拒絕並回傳 loginRulePasswordErrorConflictWithFreeze（兩者互斥，同一個鎖保護，不可同時啟用），' +
                '需要先用 update_freeze_config 停用 passwordError 規則才能開啟這裡的密碼錯誤驗證。' +
                '完成後會自動讀回最新設定一併回傳。' +
                'prod 執行前確認：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion 明確詢問使用者是否同意，' +
                '取得同意後才可以帶上 confirm 參數；非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                realNameErrorLimit: z.number().int().min(1).optional().describe('真實姓名驗證錯誤次數上限'),
                ipVerificationStatus: statusToggle.optional().describe('IP 登入異常驗證開關'),
                ipVerificationType: verificationType.optional().describe('IP 登入異常驗證方式'),
                remoteLoginVerificationStatus: statusToggle.optional().describe('異地登入驗證開關'),
                remoteLoginMonths: z.number().int().min(1).optional().describe('異地登入驗證統計時間區間（單位：月）'),
                remoteLoginVerificationType: verificationType.optional().describe('異地登入驗證方式'),
                deviceVerificationStatus: statusToggle.optional().describe('設備登入異常驗證開關'),
                deviceRecordLimit: z.number().int().min(1).optional().describe('記錄設備數量上限'),
                deviceVerificationType: verificationType.optional().describe('設備登入異常驗證方式'),
                passwordErrorVerificationStatus: statusToggle.optional().describe('密碼錯誤驗證開關'),
                passwordErrorLimit: z.number().int().min(1).optional().describe('密碼錯誤限制次數'),
                passwordErrorVerificationType: verificationType.optional().describe('密碼錯誤驗證方式'),
                fingerprintMerchantIds: z.string().optional().describe('指紋辨識商家 ID'),
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

            const base = getR.data?.rule?.loginVerificationConfig;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.realNameErrorLimit !== undefined) overrides.realNameErrorLimit = input.realNameErrorLimit;
            if (input.ipVerificationStatus !== undefined) overrides.ipVerificationStatus = ACTIVE_STATUS_MAP[ input.ipVerificationStatus ];
            if (input.ipVerificationType !== undefined) overrides.ipVerificationType = LOGIN_VERIFICATION_TYPE_MAP[ input.ipVerificationType ];
            if (input.remoteLoginVerificationStatus !== undefined) {
                overrides.remoteLoginVerificationStatus = ACTIVE_STATUS_MAP[ input.remoteLoginVerificationStatus ];
            }
            if (input.remoteLoginMonths !== undefined) overrides.remoteLoginMonths = input.remoteLoginMonths;
            if (input.remoteLoginVerificationType !== undefined) {
                overrides.remoteLoginVerificationType = LOGIN_VERIFICATION_TYPE_MAP[ input.remoteLoginVerificationType ];
            }
            if (input.deviceVerificationStatus !== undefined) overrides.deviceVerificationStatus = ACTIVE_STATUS_MAP[ input.deviceVerificationStatus ];
            if (input.deviceRecordLimit !== undefined) overrides.deviceRecordLimit = input.deviceRecordLimit;
            if (input.deviceVerificationType !== undefined) overrides.deviceVerificationType = LOGIN_VERIFICATION_TYPE_MAP[ input.deviceVerificationType ];
            if (input.passwordErrorVerificationStatus !== undefined) {
                overrides.passwordErrorVerificationStatus = ACTIVE_STATUS_MAP[ input.passwordErrorVerificationStatus ];
            }
            if (input.passwordErrorLimit !== undefined) overrides.passwordErrorLimit = input.passwordErrorLimit;
            if (input.passwordErrorVerificationType !== undefined) {
                overrides.passwordErrorVerificationType = LOGIN_VERIFICATION_TYPE_MAP[ input.passwordErrorVerificationType ];
            }
            if (input.fingerprintMerchantIds !== undefined) overrides.fingerprintMerchantIds = input.fingerprintMerchantIds;

            const merged = LoginVerificationConfig.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.UpdateLoginVerificationConfig(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.securityRestrictionBackOffice.securityRestrictionPlatform.GetLoginRules());
            const checkConfig = checkR.failed ? undefined : checkR.data?.rule?.loginVerificationConfig;
            return asTextResult({
                success: true,
                message: '登入驗證設定已更新',
                config: checkConfig ? formatLoginVerificationConfig(checkConfig as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
