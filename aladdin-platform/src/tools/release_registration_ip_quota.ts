/**
 * tools/release_registration_ip_quota.ts — aladdin_platform_app_user_ip_quota_platform_release_registration_ip_quota
 *
 * rajah: AppUserIpQuotaPlatform.ReleaseRegistrationIpQuota（user_back_office.rajah:578，
 * 需要 @Permission "Risk.IpRestriction.SameIp.Ops.Release"）
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（app_user_ip_quota_platform.ts:145-159 →
 * RegistrationIpQuotaManager.releaseRecord()，registration_ip_quota_manager.ts:795-870）：
 * - 先讀本平台的 release_quota_count 設定（無設定則用預設值，且驗證必須為正整數）；
 *   transaction 內 FOR UPDATE 鎖該筆紀錄，**直接覆寫（非增量累加）**：
 *   `usedCount=0`、`remainingCount=releaseQuotaCount`、`lastReleasedCount=releaseQuotaCount`、
 *   `releasedAtTimestamp=now()`，不改 status。
 * - **disabled 的紀錄也允許釋放**（後端不因 status=disabled 拒絕），釋放不會連帶改動 status。
 * - 屬於 method-category-checklist.md 第 6 節「Reset」類狀態轉換：重複呼叫會持續把 usedCount 重置為 0、
 *   releasedAtTimestamp 更新為當下時間，每次呼叫都會真的寫入（非嚴格意義的 no-op），但收斂到同一個結果，
 *   不會累積或疊加副作用，可安全重試。
 * - 這支 service 沒有「依 id 查單筆」的 Get 方法（ListRegistrationIpQuotas 的 search 條件裡也沒有 id 欄位，
 *   只有 ip 精準比對），因此本工具無法做嚴格意義的「呼叫前後同一筆」round-trip 驗證，只能依賴 RPC
 *   本身不報錯視為業務成功；若要核對釋放後的實際數值，呼叫端可另外用 ip 呼叫 list 工具查詢。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerReleaseRegistrationIpQuotaTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_user_ip_quota_platform_release_registration_ip_quota',
        {
            title: 'Release (reset) a registration IP quota record\'s used count',
            description:
                '釋放單筆「註冊 IP 配額」紀錄已使用的註冊數（rajah: AppUserIpQuotaPlatform.ReleaseRegistrationIpQuota，' +
                'user_back_office.rajah:578）。id 從 aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas 取得，' +
                '只能操作當前登入平台自己的紀錄（後端強制 platform_id 過濾）。' +
                '⚠️ 實際效果是把 usedCount 直接覆寫為 0、remainingCount 覆寫為目前平台設定的 releaseQuotaCount' +
                '（見 get_registration_ip_quota_config），不是累加，也不會改動這筆紀錄的啟用/停用狀態' +
                '（disabled 的紀錄也可以釋放）。每次呼叫都是真實寫入（非嚴格 no-op），但重複呼叫只會收斂到同一個結果，' +
                '不會疊加副作用，可安全重試。這個 service 沒有依 id 查單筆的方法，本工具無法做嚴格的呼叫前後 round-trip，' +
                '要核對釋放後數值請另外用 ip 呼叫 list_registration_ip_quotas。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('紀錄 id，從 list_registration_ip_quotas 取得'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.ReleaseRegistrationIpQuota(id));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, message: '已釋放，usedCount 重置為 0、remainingCount 已依平台設定重新計算' });
        },
    );
}
