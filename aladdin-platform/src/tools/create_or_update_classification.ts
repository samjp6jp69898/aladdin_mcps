/**
 * tools/create_or_update_classification.ts — aladdin_platform_wallet_platform_create_or_update_classification
 *
 * rajah: WalletPlatform.CreateOrUpdateClassification(parameter ClassificationCategories 1)
 * （wallet_back_office.rajah:385，service 定義於 wallet_back_office.rajah:364，非 @NoPublic）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/wallet_back_office/services/
 * wallet_platform.ts:459-521，methodCreateOrUpdateClassification）：
 * - `id>0` 走更新分支：先 `loadObject` 確認該 id 屬於本平台且存在（不存在回
 *   ErrorCode.idNotExists），name/remark **無條件覆蓋**（非部分合併——沒有「不帶就保留原值」
 *   的語意，呼叫端必須明確傳完整值，本工具在更新前自動讀現值補齊呼叫端沒帶的欄位，行為
 *   等同於「先讀現值只覆蓋要改欄位」）；categories 用「刪除子分類再依傳入陣列重新寫入」
 *   （同 update_show_category.ts 的整批覆蓋語意，非 diff）。
 * - `id` 缺省或 0 走新增分支：直接 insertObject 建立新列。
 * - 回傳型別是 Empty，**新增時後端不回傳新 id**，本工具在建立後改用
 *   ListClassificationCategories 讀回、以 name 精確比對找出新建的那筆——若已有同名歸類
 *   存在（業務上未強制唯一），比對會找到多筆，本工具會如實回報全部候選、不擅自猜測是哪一筆。
 * - 寫 audit log（非同步，RPC 回應不等待）。
 *
 * method-category-checklist.md 分類：第 4 節「Upsert / CreateOrUpdate」。已依規則要求
 * 先讀現值（更新分支）+ 完成後 round-trip 讀回驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ClassificationCategories } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { TRANSACTION_CATEGORY_KEYS, transactionCategoryKeyToNumber, transactionCategoryNumberToKey } from '../const.ts';

export function registerCreateOrUpdateClassificationTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wallet_platform_create_or_update_classification',
        {
            title: 'Create or update a transaction classification on this platform',
            description:
                '新增或更新本平台的「運營歸類」（rajah: WalletPlatform.CreateOrUpdateClassification）。' +
                'id 帶既有值（來自 aladdin_platform_wallet_platform_list_classification_categories）走更新，' +
                'id 省略或帶 0 走新增。' +
                '更新時 name/remark/categories 皆為整包覆蓋（非部分合併），但本工具會先讀現值，呼叫端沒帶的欄位' +
                '（含 categories）自動沿用現值，不會被清空——若要清空 categories，需明確傳空陣列 `[]`，' +
                '不能靠「省略」達成。categories 底層機制是後端刪除子分類再依傳入陣列重新寫入（非增量 diff），' +
                '若只想增減，先讀現值（aladdin_platform_wallet_platform_list_classification_categories）再組完整清單傳入。' +
                '新增時省略 categories 等同傳空陣列。categories 是 TransactionCategoryEnum 字串 key（如 "paymentDeposit"）。' +
                '新增時後端不會回傳新 id（RPC 回傳空結果），本工具會在建立後改用清單查詢以 name 精確比對找出新建的那筆；' +
                '若已有同名歸類（業務上未強制唯一），可能比對到多筆，本工具會如實列出全部候選，呼叫端需自行用其他欄位' +
                '（remark/categories/建立時間相近）人工判斷是哪一筆，不會自動猜測。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().optional().describe('既有歸類 id（來自 list_classification_categories）；省略或 0 代表新增'),
                name: z.string().optional().describe('歸類名稱；更新時省略會沿用現值，新增時必填'),
                remark: z.string().optional().describe('備註；更新時省略會沿用現值，新增時預設空字串'),
                categories: z.array(z.enum(TRANSACTION_CATEGORY_KEYS)).optional().describe(
                    '這個歸類底下涵蓋哪些交易類型（整批覆蓋，非增量）；更新時省略會沿用現值，新增時省略等同傳空陣列。' +
                    '要清空既有 categories 需明確傳 []，不能靠省略達成',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, name, remark, categories, confirm }) => {
            assertProdConfirmed(confirm);
            const targetId = id ?? 0;
            const isUpdate = targetId > 0;

            let finalName = name;
            let finalRemark = remark;
            let finalCategories: number[] | undefined = categories?.map(transactionCategoryKeyToNumber);
            if (isUpdate) {
                const listBefore = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.ListClassificationCategories());
                if (listBefore.failed) return asErrorResult(listBefore);
                const before = listBefore.data?.rows?.find((row) => row.id === targetId);
                if (!before) {
                    return asTextResult({
                        success: false,
                        message: `id=${ targetId } 不存在於本平台的歸類清單，無法更新`,
                    });
                }
                finalName = name ?? before.name ?? undefined;
                finalRemark = remark ?? before.remark ?? undefined;
                // categories 比照 name/remark 的「省略沿用現值」語意，不能用「省略」意外清空既有分類。
                finalCategories = finalCategories ?? before.categories ?? [];
            } else if (name === undefined) {
                return asTextResult({ success: false, message: '新增歸類時 name 為必填' });
            }

            const parameter = ClassificationCategories.create({
                id: targetId,
                name: finalName,
                remark: finalRemark ?? '',
                categories: finalCategories ?? [],
            });

            const r = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.CreateOrUpdateClassification(parameter));
            if (r.failed) return asErrorResult(r);

            const listAfter = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.ListClassificationCategories());
            if (listAfter.failed) {
                return asTextResult({ success: true, message: isUpdate ? '更新成功' : '建立成功', warning: '讀回清單失敗，無法附上 readBack' });
            }
            const rows = listAfter.data?.rows ?? [];

            const formatRow = (row: { id?: number | null; name?: string | null; remark?: string | null; categories?: number[] | null }) => ({
                ...row,
                categories: (row.categories ?? []).map(transactionCategoryNumberToKey),
            });

            if (isUpdate) {
                const readBack = rows.find((row) => row.id === targetId);
                return asTextResult({
                    success: true,
                    message: '更新成功',
                    readBack: readBack ? formatRow(readBack) : { note: '讀回清單中沒找到這個 id，非預期，請人工確認', rows: rows.map(formatRow) },
                });
            }

            const candidates = rows.filter((row) => row.name === finalName).map(formatRow);
            return asTextResult({
                success: true,
                message: '建立成功',
                note: candidates.length > 1
                    ? '後端未回傳新 id，且清單中有多筆同名歸類，以下列出全部同名候選，請人工判斷哪一筆是剛建立的'
                    : '後端未回傳新 id，以下是依 name 比對到的候選（唯一命中）',
                candidates,
            });
        },
    );
}
