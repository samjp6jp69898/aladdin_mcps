/**
 * tools/update_otp_sms_settings.ts — aladdin_platform_otp_code_setting_platform_update_sms_settings
 *
 * rajah: OtpCodeSettingPlatform.GetSmsSettings + UpdateSmsSettings（otp_code_back_office.rajah:132-137，
 * @Permission "PlatCapCfg.Security.SmsManage.Save"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（otp_code_setting_platform.ts:67-142，
 * OtpSmsSettingManager.applyUpdate 於 managers/otp_sms_setting_manager.ts:129-142）：
 * UpdateSmsSettings 吃的是完整 OtpSmsSettings 物件，applyUpdate 對呼叫端傳入的每個
 * 欄位一律無條件覆蓋（不是 partial patch，也沒有先比對是否真的有變更才寫入的邏輯），
 * 且 rajah 全庫沒有 @Optional/@Partial 這類「欄位存在性」標記可以判斷——比照
 * method-category-checklist.md 第 4 節與 update_message_board_setting.ts 既有模式：
 * 先呼叫 GetSmsSettings 讀現值，只覆蓋呼叫端明確帶的欄位，其餘（含 id/updatedAtTimestamp
 * 等內部欄位）原樣帶回，完成後再讀一次做 round-trip 驗證。
 *
 * 後端 OtpSmsSettingManager.validate() 會擋：sendLimitStatus=enabled 時 limitCount 必須
 * >0；phoneProtectionSeconds/uidProtectionSeconds/phoneExpirySeconds/uidExpirySeconds
 * 皆必須 >0（不論對應開關是否 enabled，無條件檢查）。
 *
 * **實測澄清（2026-08-25 讀 otp_sms_setting_manager.ts:118-124 查證）**：validate() 的
 * 錯誤訊息文字寫「must be between OtpCodeMinExpirySeconds and OtpCodeMaxExpirySeconds」
 * （即 60~600），但實際判斷式 isValidExpirySeconds()（同檔 148-150 行）只檢查
 * `expirySeconds > 0`，完全沒有用到這兩個常數——後端目前對 60~600 這個邊界並未真的強制
 * 執行，錯誤訊息文字與判斷邏輯不一致（疑似後端既有 bug，非本工具臆測）。本工具的
 * phoneExpirySeconds/uidExpirySeconds zod schema 刻意收緊為 60~600（比後端目前實際接受
 * 的範圍更嚴），是工具自主選擇的保守預設，不是在轉述後端行為；若之後需要設定 1~59 或
 * >600 秒（後端目前實際上不會擋），須先放寬這裡的 schema。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { OtpSmsSettings } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ACTIVE_STATUS_MAP,
    OTP_LIMIT_CONDITION_MAP,
    OTP_LIMIT_PERIOD_MAP,
    OTP_CODE_MIN_EXPIRY_SECONDS,
    OTP_CODE_MAX_EXPIRY_SECONDS,
} from '../const.ts';
import { formatOtpSmsSettings } from './get_otp_sms_settings.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);

export function registerUpdateOtpSmsSettingsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_otp_code_setting_platform_update_sms_settings',
        {
            title: 'Update this platform OTP SMS settings',
            description:
                '修改本平台的簡訊驗證碼（OTP SMS）發送限制設定並儲存（rajah: OtpCodeSettingPlatform.UpdateSmsSettings，' +
                '需要權限節點 PlatCapCfg.Security.SmsManage.Save）。無參數 platformId，單例設定，平台由連線本身判定。' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，不會被清空或歸零（後端這支 method ' +
                '吃整包物件、不是 partial patch，見檔頭註解）。完成後會自動讀回最新設定一併回傳，方便核對是否真的改成功。' +
                '這組設定直接影響 OtpCode.OtpCodeSender.SendOtpCode 實際發送簡訊時的頻率限制行為，放寬限制' +
                '（例如把 limitCount 調很大、關閉 uidProtectionStatus）可能導致簡訊被濫發、增加成本，執行前確認這是' +
                '操作者本人明確要的變更。sendLimitStatus=enabled 時 limitCount 必須 >0；phoneProtectionSeconds/' +
                'uidProtectionSeconds/phoneExpirySeconds/uidExpirySeconds 皆必須 >0——這些由後端強制檢查，不符合' +
                '會回業務錯誤，不會部分寫入。phoneExpirySeconds/uidExpirySeconds 本工具額外收緊為 60~600 秒' +
                '（工具自主的保守預設，後端實際判斷式目前只檢查 >0，並未真的強制 60~600，見檔頭註解）。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                smsSendStatus: statusToggle.optional().describe('簡訊驗證碼總開關'),
                sendLimitStatus: statusToggle.optional().describe('簡訊驗證碼次數限制開關'),
                limitCondition: z.enum([ 'ip', 'phone' ]).optional().describe('次數限制條件：ip=依 IP 計算、phone=依手機號碼計算；sendLimitStatus=enabled 時為必要欄位'),
                limitPeriodType: z.enum([ 'day', 'week', 'permanent' ]).optional().describe('次數限制週期：day=1天、week=1週、permanent=永久；sendLimitStatus=enabled 時為必要欄位'),
                limitCount: z.number().int().min(1).optional().describe('週期內允許發送次數上限；sendLimitStatus=enabled 時必須 >0'),
                phoneProtectionStatus: statusToggle.optional().describe('手機保護/過期時間開關'),
                phoneProtectionSeconds: z.number().int().min(1).optional().describe('同一手機號碼的發送冷卻時間（秒），必須 >0'),
                phoneExpirySeconds: z.number().int().min(OTP_CODE_MIN_EXPIRY_SECONDS).max(OTP_CODE_MAX_EXPIRY_SECONDS)
                    .optional().describe(`驗證碼有效時間（秒），本工具收緊為 ${ OTP_CODE_MIN_EXPIRY_SECONDS }~${ OTP_CODE_MAX_EXPIRY_SECONDS } 之間（工具自主保守預設，後端目前實際只檢查 >0）`),
                uidProtectionStatus: statusToggle.optional().describe('使用者帳號（UID）保護/過期時間開關'),
                uidProtectionSeconds: z.number().int().min(1).optional().describe('同一使用者帳號的發送冷卻時間（秒），必須 >0'),
                uidExpirySeconds: z.number().int().min(OTP_CODE_MIN_EXPIRY_SECONDS).max(OTP_CODE_MAX_EXPIRY_SECONDS)
                    .optional().describe(`驗證碼有效時間（秒），本工具收緊為 ${ OTP_CODE_MIN_EXPIRY_SECONDS }~${ OTP_CODE_MAX_EXPIRY_SECONDS } 之間（工具自主保守預設，後端目前實際只檢查 >0）`),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.otpCodeBackOffice.otpCodeSettingPlatform.GetSmsSettings());
            if (getR.failed) return asErrorResult(getR);

            const base = getR.data?.config;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.smsSendStatus !== undefined) overrides.smsSendStatus = ACTIVE_STATUS_MAP[ input.smsSendStatus ];
            if (input.sendLimitStatus !== undefined) overrides.sendLimitStatus = ACTIVE_STATUS_MAP[ input.sendLimitStatus ];
            if (input.limitCondition !== undefined) overrides.limitCondition = OTP_LIMIT_CONDITION_MAP[ input.limitCondition ];
            if (input.limitPeriodType !== undefined) overrides.limitPeriodType = OTP_LIMIT_PERIOD_MAP[ input.limitPeriodType ];
            if (input.limitCount !== undefined) overrides.limitCount = input.limitCount;
            if (input.phoneProtectionStatus !== undefined) overrides.phoneProtectionStatus = ACTIVE_STATUS_MAP[ input.phoneProtectionStatus ];
            if (input.phoneProtectionSeconds !== undefined) overrides.phoneProtectionSeconds = input.phoneProtectionSeconds;
            if (input.phoneExpirySeconds !== undefined) overrides.phoneExpirySeconds = input.phoneExpirySeconds;
            if (input.uidProtectionStatus !== undefined) overrides.uidProtectionStatus = ACTIVE_STATUS_MAP[ input.uidProtectionStatus ];
            if (input.uidProtectionSeconds !== undefined) overrides.uidProtectionSeconds = input.uidProtectionSeconds;
            if (input.uidExpirySeconds !== undefined) overrides.uidExpirySeconds = input.uidExpirySeconds;

            const merged = OtpSmsSettings.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.otpCodeBackOffice.otpCodeSettingPlatform.UpdateSmsSettings(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.otpCodeBackOffice.otpCodeSettingPlatform.GetSmsSettings());
            const checkConfig = checkR.failed ? undefined : checkR.data?.config;
            return asTextResult({
                success: true,
                message: 'OTP 簡訊設定已更新',
                config: checkConfig ? formatOtpSmsSettings(checkConfig as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
