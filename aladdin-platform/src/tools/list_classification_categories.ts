/**
 * tools/list_classification_categories.ts — aladdin_platform_wallet_platform_list_classification_categories
 *
 * rajah: WalletPlatform.ListClassificationCategories() (rows [ClassificationCategories] 1)
 * （wallet_back_office.rajah:383，service 定義於 wallet_back_office.rajah:364，非 @NoPublic）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/wallet_back_office/services/
 * wallet_platform.ts:423-446，methodListClassificationCategories）：SQL 直接
 * `SELECT ... FROM classifications WHERE platform_id=? GROUP BY c.id`，**不分頁、無
 * page/pageSize 參數，一次回傳當前平台全部歸類**。這是「運營歸類」（把多個交易類型分組
 * 成一個歸類，供帳變查詢/報表篩選用），業務上屬於小型設定型清單（人工建立、非自動累積的
 * 交易流水），不套用 method-category-checklist.md 第 2 節 B 級「分頁掃描到底」規則。
 *
 * 純讀取，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。id 用於
 * aladdin_platform_wallet_platform_create_or_update_classification（更新/以此定位）與
 * aladdin_platform_wallet_platform_delete_classification。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { transactionCategoryNumberToKey } from '../const.ts';

export function registerListClassificationCategoriesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wallet_platform_list_classification_categories',
        {
            title: 'List transaction classifications defined on this platform',
            description:
                '列出本平台已建立的「運營歸類」（把多個 TransactionCategoryEnum 交易類型分組成一個歸類，' +
                '供帳變查詢/報表篩選用）（rajah: WalletPlatform.ListClassificationCategories，無參數、' +
                '不分頁，一次回傳全部）。回傳每筆的 categories 是 TransactionCategoryEnum 字串 key 陣列。' +
                'id 可用於 aladdin_platform_wallet_platform_create_or_update_classification（更新既有歸類）與 ' +
                'aladdin_platform_wallet_platform_delete_classification。這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.ListClassificationCategories());
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                categories: (row.categories ?? []).map(transactionCategoryNumberToKey),
            }));
            return asTextResult({ success: true, rows });
        },
    );
}
