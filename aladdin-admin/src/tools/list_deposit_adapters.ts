/**
 * tools/list_deposit_adapters.ts — aladdin_admin_deposit_admin_list_adapters
 *
 * rajah: DepositAdmin.ListAdapters(page i32 1, pageSize i32 2) (rows [DepositAdapter] 1, totalPage i32 2)
 * （payment_back_office.rajah:2910，@Permission "PaymentDepositAdmin.Adapter"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodListAdapters（真的有 override），底層是 `deposit_adapters` 這張 DB 表的無條件
 * 全表分頁（不帶任何 WHERE 篩選），依 method-category-checklist.md 第 2 節屬「範圍鍵/篩選
 * 條件都沒有，僅 page/pageSize」——沒有可鎖定單一目標的欄位；但這張表是超管手動新增/設定的
 * 充值 adapter 實例（一次新增一筆），語意上是小型、成長緩慢的營運設定表，不是使用者產生內容，
 * 不適用 B 級「禁止當成逐頁掃描找特定一筆」的強制要求——本工具僅作為單純的分頁列表使用，
 * 若要精確查單一 adapter，改用業務鍵（id）直接查詢——見 aladdin_admin_deposit_admin_get_adapter_for_edit。
 *
 * **已知資料陷阱（讀原始碼確認，非推測）**：後端 `loadObjects(DbDepositAdapter, '', [], '', ...)`
 * 的 sort 參數是空字串，即整段查詢沒有 ORDER BY——分頁之間的排序不保證穩定，理論上可能因
 * 併發寫入導致跨頁重複或漏掉列，這是後端既有實作的行為，tool description 需告知呼叫端。
 *
 * 回傳的 DepositAdapter model（payment_back_office.rajah:3-23）不含任何金鑰/密碼欄位，
 * `parameterList` 只是「這個 adapter 需要哪些憑證欄位」的 enum 清單（hashKey/publicKey/
 * privateKey 之類的欄位名），不是實際密鑰值，第 8 節敏感資料規則不適用。
 *
 * dev 驗證：呼叫 page=1 與刻意超出 totalPage 的頁碼，確認回傳結構與空頁行為。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListDepositAdaptersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_list_adapters',
        {
            title: 'List configured deposit adapters',
            description:
                '分頁列出超管已設定的充值（Deposit）adapter 實例（rajah: DepositAdmin.ListAdapters，' +
                'payment_back_office.rajah:2910）。無篩選條件，對整張 `deposit_adapters` 表做無條件分頁——' +
                '這張表是超管手動新增的 adapter 設定，數量通常不多（不是使用者產生內容，不會無限成長）。' +
                '**已知限制**：後端查詢沒有 ORDER BY，跨頁排序不保證穩定，若表中資料在查詢期間被併發修改，' +
                '理論上可能出現跨頁重複或漏掉列；一般唯讀瀏覽情境可忽略，但不要把本工具當成「逐頁掃描找特定一筆」' +
                '的精確定位手段。回傳的 `adapterKey` 欄位合法值來源見 ' +
                'aladdin_admin_deposit_admin_get_adapter_keys；回傳不含任何金鑰/密碼，`parameterList` 只是' +
                '該 adapter 需要哪些憑證欄位的名稱清單（非實際值）。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async ({ page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.ListAdapters(page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
