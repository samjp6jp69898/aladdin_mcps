/**
 * tools/get_registration_ip_quota_config.ts — aladdin_platform_app_user_ip_quota_platform_get_registration_ip_quota_config
 *
 * rajah: AppUserIpQuotaPlatform.GetRegistrationIpQuotaConfig（user_back_office.rajah:557，
 * 需要 @Permission "Risk.IpRestriction.SameIp"）——無參數，單例設定，平台由連線本身判定。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（app_user_ip_quota_platform.ts:44-54 →
 * RegistrationIpQuotaManager.getConfigForBackOffice()，registration_ip_quota_manager.ts:330-349）：
 * - 查 `registration_ip_quota_configs` 表該平台一筆設定；**找不到 row 視為「尚未設定過」，
 *   回傳預設 disabled 設定，不會補寫入 DB**——不能把回傳的 config 當成「DB 裡一定存在這筆資料」的證據。
 * - limitPrompt 是多語提示文字陣列，額外查多語表組成，非直接欄位存值。
 * - id/updatedAtTimestamp/createdAtTimestamp 是後端內部欄位，本工具原樣透出僅供參考，
 *   呼叫端不需要、也不應該用來組裝 update 的 payload（update 工具會自己讀現值合併）。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, describeEnum, toPlainNumber } from '../const.ts';

/** 把後端回傳的 RegistrationIpQuotaConfig 轉成 agent 友善的形狀，get/update 兩支 tool 共用。 */
export function formatRegistrationIpQuotaConfig(c: Record<string, unknown>): Record<string, unknown> {
    return {
        ...c,
        status: describeEnum(ACTIVE_STATUS_MAP, c.status as number),
        updatedAtTimestamp: toPlainNumber(c.updatedAtTimestamp),
        createdAtTimestamp: toPlainNumber(c.createdAtTimestamp),
    };
}

export function registerGetRegistrationIpQuotaConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_user_ip_quota_platform_get_registration_ip_quota_config',
        {
            title: 'Get registration IP quota (same-IP restriction) config',
            description:
                '讀取本平台「註冊 IP 配額限制」總開關與相關設定（rajah: AppUserIpQuotaPlatform.GetRegistrationIpQuotaConfig，' +
                'user_back_office.rajah:557）。無參數，單例設定，平台由連線本身判定。' +
                '⚠️ 若這個平台從未設定過，後端回傳預設 disabled 設定但**不會補寫入 DB**——回傳有值不代表 DB 已存在這筆資料，' +
                '要修改請改用 aladdin_platform_app_user_ip_quota_platform_update_registration_ip_quota_config' +
                '（那支工具會先讀現值再合併覆蓋，呼叫端不需要自己先呼叫這支再手動拼參數）。' +
                'initialQuotaCount 是新 IP 初始可註冊數，releaseQuotaCount 是每次釋放（見 release_registration_ip_quota' +
                '工具）補回的配額數，limitPrompt 是達上限時前台顯示的多語提示文字，customerId 是客服連結 id（0＝關閉）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.GetRegistrationIpQuotaConfig());
            if (r.failed) return asErrorResult(r);

            const c = r.data?.config;
            if (!c) return asTextResult({ success: true, config: null });
            return asTextResult({ success: true, config: formatRegistrationIpQuotaConfig(c as unknown as Record<string, unknown>) });
        },
    );
}
