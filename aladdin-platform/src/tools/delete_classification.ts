/**
 * tools/delete_classification.ts — aladdin_platform_wallet_platform_delete_classification
 *
 * rajah: WalletPlatform.DeleteClassification(id i32 1)
 * （wallet_back_office.rajah:387，service 定義於 wallet_back_office.rajah:364，非 @NoPublic）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/wallet_back_office/services/
 * wallet_platform.ts:542-573，methodDeleteClassification）：
 * - **硬刪除**：`loadObject` 確認 id 屬於本平台且存在（不存在回 ErrorCode.idNotExists）→
 *   刪除子分類（classification_categories）→ `DELETE FROM classifications WHERE
 *   platform_id=? AND id=?`，不是軟刪除（無 status/deleted_at 欄位可還原）。
 * - **不冪等**：對已刪除/不存在的 id 再刪一次，loadObject 找不到資料會回
 *   ErrorCode.idNotExists，不是靜默成功。
 * - 寫 audit log（非同步，RPC 回應不等待）。
 *
 * method-category-checklist.md 第 7 節「刪除」：硬刪除、不冪等，本工具刪除前先讀一次現值
 * 確認記錄存在並回報名稱，避免對「本來就不存在」的 id 誤報成功；刪除後不再額外查詢驗證
 * （後端已用同一個 transaction 的 loadObject 保證了「刪除的當下確實存在」，沒有必要再多打
 * 一次 RPC 才能確認「不存在」——那本身就是刪除操作預期的結果狀態）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerDeleteClassificationTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wallet_platform_delete_classification',
        {
            title: 'Delete a transaction classification on this platform',
            description:
                '刪除本平台的一個「運營歸類」（rajah: WalletPlatform.DeleteClassification）。' +
                '**硬刪除**，無法復原；同時會刪除該歸類底下的子分類關聯。' +
                '**不冪等**：對已刪除或不存在的 id 再呼叫一次會回錯誤（ErrorCode.idNotExists），不是靜默成功。' +
                'id 來自 aladdin_platform_wallet_platform_list_classification_categories。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('要刪除的歸類 id，來自 aladdin_platform_wallet_platform_list_classification_categories'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, confirm }) => {
            assertProdConfirmed(confirm);

            const listBefore = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.ListClassificationCategories());
            if (listBefore.failed) return asErrorResult(listBefore);
            const before = listBefore.data?.rows?.find((row) => row.id === id);
            if (!before) {
                return asTextResult({ success: false, message: `id=${ id } 不存在於本平台的歸類清單，未執行刪除` });
            }

            const r = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.DeleteClassification(id));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, message: `已刪除歸類 id=${ id }（name="${ before.name }"），此操作為硬刪除且不可復原` });
        },
    );
}
