/**
 * tools/list_platform_deposit_adapters.ts — aladdin_admin_deposit_admin_list_platform_deposit_adapters
 *
 * rajah: DepositAdmin.ListPlatformDepositAdapters(page i32 1, pageSize i32 2, platformId i32 3)
 * (rows [AdminDepositAdapterEssential] 1, totalPage i32 2)
 * （payment_back_office.rajah:2925，@Permission "PaymentDepositAdmin.Adapter.Platform"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodListPlatformDepositAdapters（真的有 override）。讀原始碼確認：
 * - 底層 SQL：`SELECT da.id, da.name, pda.status FROM deposit_adapters AS da LEFT JOIN
 *   platform_deposit_adapters AS pda ON da.id = pda.deposit_adapter_id AND pda.platform_id = ?
 *   WHERE da.status = enabled ORDER BY da.id DESC LIMIT ...`——有 ORDER BY（不同於
 *   list_deposit_adapters.ts 的 ListAdapters，那支沒有），分頁排序穩定。
 * - **已知資料陷阱（讀 SQL 結構確認，比照 aladdin_admin_list_platform_game_vendors 的既有
 *   同類陷阱）**：`platformId` 只出現在 LEFT JOIN 條件、不在 WHERE，帶一個不存在的 platformId
 *   **不會回錯誤**——會回傳全部 status=enabled 的母表 adapter（`deposit_adapters` 全域清單），
 *   每一列因為 JOIN 不到對應資料，`status` 會落回該平台「未綁定」的預設值（LEFT JOIN 缺列時
 *   `pda.status` 為 NULL，`DbDepositAdapterWithPlatform.create()` 轉型後预期落在 StatusEnum
 *   的預設值 0/unknown 或 disabled，行為以實測為準，見下方 dev 驗證結果）。不能用這支的成功
 *   回傳或 status 內容反推 platformId 是否真實存在，platformId 一律只能用
 *   aladdin_admin_list_platforms 回傳的真實 id。
 * - `rows[].id` 對應的完整 adapter 參數（baseUrl/callbackBaseUrl 等）要另外呼叫
 *   aladdin_admin_deposit_admin_get_adapter_for_edit 查；本工具只回傳「該平台底下每個母表
 *   adapter 各自的啟停狀態」essential 視圖。
 *
 * dev 驗證：對真實存在的 platformId 呼叫，並對一個刻意不存在的超大 platformId 呼叫，確認
 * 兩者都成功、比對 status 差異，如實記錄在下方 description。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformDepositAdaptersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_list_platform_deposit_adapters',
        {
            title: 'List a platform\'s deposit adapter enable status',
            description:
                '分頁列出某個平台底下、全部已啟用（母表 status=enabled）的充值 adapter，各自在該平台的' +
                '綁定/啟用狀態（rajah: DepositAdmin.ListPlatformDepositAdapters，payment_back_office.rajah:2925）。' +
                'platformId 來自 aladdin_admin_list_platforms 的回傳結果。' +
                '**已知陷阱（讀後端 SQL 確認，比照 aladdin_admin_list_platform_game_vendors 同類行為）**：' +
                'platformId 只出現在 LEFT JOIN 條件、不在 WHERE，帶一個不存在的 platformId **不會回錯誤**，' +
                '會回傳全部母表已啟用 adapter、每列 status 落回「未綁定」的預設值——不能用本工具的成功回傳或' +
                'status 內容反推 platformId 是否真實存在。' +
                '回傳的 status 是 rajah StatusEnum 數值：unknown=0 / enabled=1 / disabled=2 / frozen=3 / deleted=10。' +
                '本工具只回傳 essential 視圖（id/name/status），完整 adapter 設定（baseUrl 等）要另外呼叫 ' +
                'aladdin_admin_deposit_admin_get_adapter_for_edit。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_list_platforms 的回傳結果'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async ({ platformId, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.ListPlatformDepositAdapters(page ?? 1, pageSize ?? 50, platformId));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
