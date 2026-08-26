/**
 * tools/toggle_registration_ip_quota_status.ts — aladdin_platform_app_user_ip_quota_platform_toggle_registration_ip_quota_status
 *
 * rajah: AppUserIpQuotaPlatform.ToggleRegistrationIpQuotaStatus（user_back_office.rajah:574，
 * 需要 @Permission "Risk.IpRestriction.SameIp.Status.ToggleStatus"）——名字叫 Toggle，
 * 但實際是「設定為指定狀態」，不是無參數 bit-flip（method-category-checklist.md 第 6 節）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（app_user_ip_quota_platform.ts:125-143 →
 * RegistrationIpQuotaManager.toggleRecordStatus()，registration_ip_quota_manager.ts:732-787）：
 * - 雖然 rajah 簽名的 status 型別是 StatusEnum，但 service 層 `isEnabledOrDisabledStatus()` 只接受
 *   enabled/disabled，其餘值一律回 errorCode=invalidData——本工具的 zod schema 直接只開放這兩個值，
 *   不照 StatusEnum 全集開放 frozen/deleted 等 record 本身可能出現、但這支 method 不接受的狀態。
 * - transaction 內 FOR UPDATE 鎖該筆紀錄，**狀態相同直接 no-op（成功、不寫 audit）**，可放心重複呼叫
 *   同一個目標狀態；狀態不同才真的 UPDATE 並背景寫 audit。
 * - id 不存在回 errorCode=idNotExists（非拋例外），不會誤改到別的紀錄。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';

export function registerToggleRegistrationIpQuotaStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_user_ip_quota_platform_toggle_registration_ip_quota_status',
        {
            title: 'Set a registration IP quota record\'s enabled/disabled status',
            description:
                '設定單筆「註冊 IP 配額」紀錄的啟用/停用狀態（rajah: AppUserIpQuotaPlatform.ToggleRegistrationIpQuotaStatus，' +
                'user_back_office.rajah:574）。名字叫 Toggle，但實際要帶明確的目標狀態，不是無參數反轉現況。' +
                'id 從 aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas 取得，只能操作' +
                '當前登入平台自己的紀錄（後端強制 platform_id 過濾）。' +
                '狀態相同時是明確的 no-op（後端先查現況，相同則直接回成功、不執行實際 UPDATE），可放心重複呼叫。' +
                'id 不存在時回業務錯誤（idNotExists），非例外。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('紀錄 id，從 list_registration_ip_quotas 取得'),
                status: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態；這支 method 只接受這兩個值，其餘一律回錯'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.ToggleRegistrationIpQuotaStatus(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, message: '更新成功' });
        },
    );
}
