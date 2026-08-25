/**
 * tools/get_otp_sms_settings.ts — aladdin_platform_otp_code_setting_platform_get_sms_settings
 *
 * rajah: OtpCodeSettingPlatform.GetSmsSettings（otp_code_back_office.rajah:134，
 * @Permission "PlatCapCfg.Security.SmsManage"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（otp_code_setting_platform.ts:41-50，
 * OtpSmsSettingManager.loadOrCreate）：真實實作，非 stub。無參數，單例設定，平台由
 * 連線本身判定（同 message board 設定模式，見 get_message_board_setting.ts）；
 * 設定不存在時後端會自動建立一筆預設值（全部開關 disabled）再回傳，不會回空值。
 *
 * 2026-08-25 dev 實測發現 id/updatedAtTimestamp（i64 欄位）經 protobufjs decode 後是
 * Long 物件（{low,high,unsigned}），比照 const.ts 既有的 toPlainNumber() 轉成一般數字，
 * 否則回傳給 agent 的 JSON 會是難以閱讀的物件形狀（同 message board 設定既有踩坑）。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, OTP_LIMIT_CONDITION_MAP, OTP_LIMIT_PERIOD_MAP, toPlainNumber } from '../const.ts';

/** 數字 → 對照表 key 的字串；查不到已知 key 時原樣回傳數字，不讓未知值消失。 */
function describeEnum<T extends Record<string, number>>(map: T, value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(map).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

/**
 * 把後端回傳的 OtpSmsSettings 原始物件轉成對呼叫端（agent）友善的形狀：enum 欄位轉成字串。
 * update_otp_sms_settings.ts 的回傳也共用這支，確保「讀到的」與「改完讀回的」格式一致。
 */
export function formatOtpSmsSettings(s: Record<string, unknown>): Record<string, unknown> {
    return {
        ...s,
        id: toPlainNumber(s.id),
        updatedAtTimestamp: toPlainNumber(s.updatedAtTimestamp),
        smsSendStatus: describeEnum(ACTIVE_STATUS_MAP, s.smsSendStatus as number),
        sendLimitStatus: describeEnum(ACTIVE_STATUS_MAP, s.sendLimitStatus as number),
        limitCondition: describeEnum(OTP_LIMIT_CONDITION_MAP, s.limitCondition as number),
        limitPeriodType: describeEnum(OTP_LIMIT_PERIOD_MAP, s.limitPeriodType as number),
        phoneProtectionStatus: describeEnum(ACTIVE_STATUS_MAP, s.phoneProtectionStatus as number),
        uidProtectionStatus: describeEnum(ACTIVE_STATUS_MAP, s.uidProtectionStatus as number),
    };
}

export function registerGetOtpSmsSettingsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_otp_code_setting_platform_get_sms_settings',
        {
            title: 'Get this platform OTP SMS settings',
            description:
                '讀取本平台的簡訊驗證碼（OTP SMS）發送限制設定（rajah: OtpCodeSettingPlatform.GetSmsSettings，' +
                '需要權限節點 PlatCapCfg.Security.SmsManage）。無參數，單例設定，平台由連線本身判定，不需要、' +
                '也不接受 platformId。這組設定直接影響 OtpCode.OtpCodeSender.SendOtpCode 實際發送簡訊時的頻率' +
                '限制行為。要修改請改用 aladdin_platform_otp_code_setting_platform_update_sms_settings——那支' +
                '工具會先呼叫這支讀現值再合併覆蓋，呼叫端通常不需要自己先呼叫這支再手動拼參數，但仍可用這支' +
                '單獨查看目前設定。設定不存在時後端會自動建立一筆預設值（全部開關 disabled）回傳，不會是空值。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.otpCodeBackOffice.otpCodeSettingPlatform.GetSmsSettings());
            if (r.failed) return asErrorResult(r);

            const config = r.data?.config;
            if (!config) return asTextResult({ success: true, config: null });

            return asTextResult({ success: true, config: formatOtpSmsSettings(config as unknown as Record<string, unknown>) });
        },
    );
}
