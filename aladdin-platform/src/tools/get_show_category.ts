/**
 * tools/get_show_category.ts — aladdin_platform_wallet_platform_get_show_category
 *
 * rajah: WalletPlatform.GetShowCategory() (categories [TransactionCategoryEnum] 1)
 * （wallet_back_office.rajah:380，service 定義於 wallet_back_office.rajah:364，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah
 * 對應 Service（agrabah/src/servers/wallet_back_office/services/wallet_platform.ts，
 * methodGetShowCategory:404）確認有真實實作（呼叫 walletManager.getShowCategory），非
 * base class 的 notImplemented。分類：第 1 節「讀取單筆」的簡化版（無 id、單例設定）。
 *
 * 業務語意：讀取本平台「錢包交易紀錄」列表要顯示哪些交易分類（TransactionCategoryEnum
 * 的子集）。要修改請改用 aladdin_platform_wallet_platform_update_show_category——那支是
 * 整批覆蓋（DELETE+INSERT），不是 partial patch；它本身不會事先呼叫這支讀現值，若呼叫端要
 * 「在現有清單基礎上增減」，需先手動呼叫這支拿到現值再組完整清單傳入 update 工具。
 *
 * 純讀取，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { transactionCategoryNumberToKey } from '../const.ts';

export function registerGetShowCategoryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wallet_platform_get_show_category',
        {
            title: 'Get which transaction categories are shown in wallet transaction list',
            description:
                '讀取本平台「錢包交易紀錄」列表目前設定要顯示哪些交易分類（rajah: ' +
                'WalletPlatform.GetShowCategory，無參數，單例設定，平台由連線本身判定）。' +
                '回傳的 categories 是 TransactionCategoryEnum 的字串 key 陣列（如 ' +
                '"paymentDeposit"、"paymentWithdraw"），不是數字碼。要修改請改用 ' +
                'aladdin_platform_wallet_platform_update_show_category（整批覆蓋，非 partial patch）。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.GetShowCategory());
            if (r.failed) return asErrorResult(r);

            const categories = (r.data?.categories ?? []).map(transactionCategoryNumberToKey);
            return asTextResult({ success: true, categories });
        },
    );
}
