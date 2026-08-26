/**
 * tools/list_registration_ip_users.ts — aladdin_platform_app_user_ip_quota_platform_list_registration_ip_users
 *
 * rajah: AppUserIpQuotaPlatform.ListRegistrationIpUsers（user_back_office.rajah:585，
 * 需要 @Permission "Risk.IpRestriction.SameIp"）
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（app_user_ip_quota_platform.ts 內對應 handler →
 * registration_ip_quota_manager.ts:644-680）：
 * - 真實 override，查 `user_login_details` JOIN `users`（以指定 ip 精準比對用此 IP 註冊的會員），
 *   並另外 RPC 補 VIP 等級與錢包餘額，非 N+1（批次補齊）。
 * - ip 為必填精準查詢欄位，屬於 method-category-checklist.md 第 2 節 A 級（有可鎖定單一目標的欄位）。
 * - ⚠️ rajah 簽名（user_back_office.rajah:585）其實有 `totalPage`/`totalRow` 回傳欄位，後端用
 *   `getPageData()`（database_helper.ts）包裝——**但這支 helper 只在 page===1 時才真的跑 count
 *   query 填值，page>1 時兩者恆為 0**，不是「完全沒有」，只是不能無條件依賴。本工具因此在 page===1
 *   時優先用 totalPage 判斷是否還有下一頁，page>1 才 fallback 用 rows.length>=pageSize 的長度啟發式
 *   （避免總筆數恰為 pageSize 整數倍時的假 hasMore）。
 * - 用途是 aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas 清單裡
 *   「該 IP 註冊用戶」詳情頁的資料來源，兩者搭配使用：先用 list_registration_ip_quotas 找出目標 IP，
 *   再用這支查該 IP 底下實際註冊了哪些會員。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, describeEnum, toPlainNumber } from '../const.ts';

export function registerListRegistrationIpUsersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_user_ip_quota_platform_list_registration_ip_users',
        {
            title: 'List members registered from a specific IP',
            description:
                '分頁查詢使用指定 IP 註冊的會員清單（rajah: AppUserIpQuotaPlatform.ListRegistrationIpUsers，' +
                'user_back_office.rajah:585），是「註冊 IP 配額」紀錄列表點進單筆的詳情資料。' +
                'ip 為必填、精準比對，通常先用 aladdin_platform_app_user_ip_quota_platform_list_registration_ip_quotas' +
                '找出目標 IP 再呼叫這支。' +
                '回傳每列含 identifier（帳號）、userId、vipLevel、walletBalance（錢包餘額）、currencyCode' +
                '（幣別）、status（帳號狀態，StatusEnum）、registerAt（註冊時間）、lastLoginAt（最後登入時間）。' +
                '⚠️ rajah 簽名有 totalPage/totalRow，但後端 getPageData 只在 page=1 時才真的計算，page>1 恆為 0：' +
                'page=1 時本工具回傳的 hasMore 依 totalPage 判斷（可靠），page>1 時 fallback 用 rows.length>=pageSize 的' +
                '長度啟發式判斷（在總筆數恰為 pageSize 整數倍時可能誤報還有下一頁）。',
            inputSchema: {
                ip: z.string().min(1).describe('精準比對的註冊 IP，必填'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).max(200).default(50).describe('每頁筆數'),
            },
        },
        async ({ ip, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.appUserBackOffice.appUserIpQuotaPlatform.ListRegistrationIpUsers(ip, page, pageSize));
            if (r.failed) return asErrorResult(r);
            const rows = r.data?.rows ?? [];
            // page===1 時 totalPage 可靠，直接用它判斷是否還有下一頁；page>1 時後端固定回 0，
            // fallback 用長度啟發式（見檔頭註解）。
            const totalPage = r.data?.totalPage;
            const hasMore = page === 1 && totalPage !== undefined && totalPage > 0
                ? page < totalPage
                : rows.length >= pageSize;
            return asTextResult({
                success: true,
                rows: rows.map((row) => {
                    const rr = row as unknown as Record<string, unknown>;
                    return {
                        ...rr,
                        status: describeEnum(STATUS_MAP, rr.status as number),
                        walletBalance: toPlainNumber(rr.walletBalance),
                        registerAt: toPlainNumber(rr.registerAt),
                        lastLoginAt: toPlainNumber(rr.lastLoginAt),
                    };
                }),
                totalPage: page === 1 ? totalPage : undefined,
                totalRow: page === 1 ? r.data?.totalRow : undefined,
                hasMore,
            });
        },
    );
}
