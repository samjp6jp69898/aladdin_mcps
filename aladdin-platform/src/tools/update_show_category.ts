/**
 * tools/update_show_category.ts — aladdin_platform_wallet_platform_update_show_category
 *
 * rajah: WalletPlatform.UpdateShowCategory(categories [TransactionCategoryEnum] 1)
 * （wallet_back_office.rajah:378，service 定義於 wallet_back_office.rajah:364，非 @NoPublic）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/wallet_back_office/services/
 * wallet_platform.ts:360-388，methodUpdateShowCategory）：在單一 transaction 內先
 * `DELETE FROM show_categories WHERE platform_id=?` 再依傳入陣列批量 insertObjects——
 * **這是整批覆蓋語意，不是 partial patch/diff**：傳入的陣列就是「更新後的完整顯示清單」，
 * 省略某個分類代表要把它從顯示清單移除，不是保留原樣；傳空陣列會清空全部顯示分類。
 * 這跟 method-category-checklist.md 第 4 節談的「先讀現值只覆蓋要改欄位」的 Upsert
 * 情境不同——這裡沒有欄位級合併問題（categories 是唯一欄位），但呼叫端必須自己組出
 * 完整目標清單（可先呼叫 aladdin_platform_wallet_platform_get_show_category 讀現值，
 * 在此基礎上增減後整包傳入），本工具不做「只增量」的語意。
 * 成功後寫 audit log（非同步，RPC 回應不等待）。
 *
 * method-category-checklist.md 分類：第 6 節「狀態轉換」不適用（沒有目標狀態列舉），視為
 * 單例設定的整批覆寫寫入，比照第 4 節「Upsert」的驗收要求（round-trip 讀回驗證）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { TRANSACTION_CATEGORY_KEYS, transactionCategoryKeyToNumber, transactionCategoryNumberToKey } from '../const.ts';

export function registerUpdateShowCategoryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wallet_platform_update_show_category',
        {
            title: 'Replace which transaction categories are shown in wallet transaction list',
            description:
                '設定本平台「錢包交易紀錄」列表要顯示哪些交易分類（rajah: WalletPlatform.UpdateShowCategory）。' +
                '**整批覆蓋語意**：傳入的 categories 陣列就是更新後的完整顯示清單（後端先刪除全部現有設定再批量寫入' +
                '傳入的陣列），不是增量 patch——省略某個分類代表要移除它，傳空陣列會清空全部顯示分類。' +
                '若只想增/減少數幾項，先呼叫 aladdin_platform_wallet_platform_get_show_category 讀現值，' +
                '在該清單基礎上增減後把完整結果傳進來，不要只傳打算新增的那幾項。' +
                'categories 是 TransactionCategoryEnum 的字串 key（如 "paymentDeposit"），不是數字碼。' +
                '完成後會自動讀回最新設定一併回傳，方便核對是否真的改成功。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                categories: z.array(z.enum(TRANSACTION_CATEGORY_KEYS)).describe(
                    '更新後的完整顯示分類清單（整批覆蓋，非增量）；傳空陣列會清空全部顯示分類',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ categories, confirm }) => {
            assertProdConfirmed(confirm);

            const numericCategories = categories.map(transactionCategoryKeyToNumber);
            const r = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.UpdateShowCategory(numericCategories));
            if (r.failed) return asErrorResult(r);

            const checkR = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.GetShowCategory());
            const readBack = checkR.failed ? undefined : (checkR.data?.categories ?? []).map(transactionCategoryNumberToKey);

            return asTextResult({ success: true, message: '顯示分類已更新', categories: readBack ?? null });
        },
    );
}
