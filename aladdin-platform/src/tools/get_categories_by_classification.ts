/**
 * tools/get_categories_by_classification.ts — aladdin_platform_wallet_platform_get_categories_by_classification
 *
 * rajah: WalletPlatform.GetCategoriesByClassification(classificationIds [i32] 1)
 * (categories [TransactionCategoryEnum] 1)
 * （wallet_back_office.rajah:391，service 定義於 wallet_back_office.rajah:364，非 @NoPublic）
 *
 * 檔頭 rajah 註解：「依運營歸類 ID 清單，解析為交易分類（去重聯集）；供其他 server 在自己的
 * 資料庫查詢統計表時使用，避免跨資料庫查詢」——是把「歸類 id 清單」展開回「交易分類清單」的
 * 純查詢輔助工具（去重聯集，不保序、不保留哪個 id 對應哪些 category 的分組資訊）。
 *
 * 純讀取，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { transactionCategoryNumberToKey } from '../const.ts';

export function registerGetCategoriesByClassificationTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wallet_platform_get_categories_by_classification',
        {
            title: 'Resolve classification ids into their union of transaction categories',
            description:
                '把一批「運營歸類」id 解析成它們涵蓋的交易類型聯集（去重，rajah: ' +
                'WalletPlatform.GetCategoriesByClassification）。回傳是所有輸入歸類底下 categories 的' +
                '去重聯集，**不保留每個 id 個別對應哪些分類的分組資訊**——若需要單一歸類的明細，改用 ' +
                'aladdin_platform_wallet_platform_list_classification_categories 逐筆查看。' +
                'classificationIds 來自 aladdin_platform_wallet_platform_list_classification_categories 的 id 欄位。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                classificationIds: z.array(z.number().int()).describe('歸類 id 清單，來自 list_classification_categories 的 id 欄位'),
            },
        },
        async ({ classificationIds }) => {
            const r = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.GetCategoriesByClassification(classificationIds));
            if (r.failed) return asErrorResult(r);

            const categories = (r.data?.categories ?? []).map(transactionCategoryNumberToKey);
            return asTextResult({ success: true, categories });
        },
    );
}
