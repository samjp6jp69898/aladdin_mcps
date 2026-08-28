/**
 * tools/update_live_category_status.ts — aladdin_platform_live_platform_update_live_category_status
 *
 * rajah: LivePlatform.UpdateLiveCategoryStatus(id i32 1, newStatus StatusEnum 2)（無回傳值）
 * （rajah/services/live_back_office.rajah:76；client 路徑 remote.liveBackOffice.livePlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、service 無 `@NoPublic`、
 * agrabah 對應實作是真實 override（agrabah/src/servers/live_back_office/services/
 * live_platform.ts:288-290，methodUpdateLiveCategoryStatus），非 base class 的 notImplemented。
 * 權限現況見 get_live_tabs.ts 檔頭（`Live*` 整族權限節點在 rajah 全被註解掉），不重複。
 *
 * 分類：method-category-checklist.md 第 6 節「狀態轉換」。與
 * `update_live_tab_status.ts` 結構完全同構——同樣整支委派 `updateStatusWithAudit`
 * （agrabah/src/common/database_helper.ts:52-60）→ `updateStatus`（同檔 :25-50），差別只有
 * 目標表是 `live_categories`、audit action 是 `liveCategoryStatusChange`。因此第 6 節的判定
 * 也完全相同，不在這裡逐條重抄，需要細節看那支的檔頭：
 * - 明確目標狀態、不做「先查現況再反轉」。
 * - 後端沒有任何狀態機檢查，也沒有 `*StatusInvalid`/`already*` 錯誤碼，合法列舉值可任意互轉。
 * - 非法列舉值 → `invalidData`(9)；id 不存在或屬於別平台 → `objectNotFound`(14)。兩者都是
 *   genie 框架層 `ErrorCode`（genie/src/common/error_code.ts），而 `asErrorResult` 反查用的
 *   `AgrabahErrorCodeEnum` 從 101 起，所以 `errorName` 會顯示「(未知錯誤碼)」，要看 errorCode 數字。
 * - 重複設定同一個狀態是安全的 no-op（2026-08-28 dev 在 tab 版實測確認此連線以 matched rows
 *   計數；本支共用同一段 `updateStatus` 程式碼，另於同日對 id=1007 實測復驗）。
 *   **適用範圍限定**：matched vs changed rows 取決於各環境連線是否帶 `CLIENT_FOUND_ROWS`，
 *   連線字串是加密設定、無法從原始碼靜態判定，所以這是 dev 環境的實測事實而非全環境保證；
 *   萬一其他環境不同，後果是「重複設定同值被誤判成 objectNotFound」，會如實回報失敗，
 *   不會造成資料錯誤。
 *
 * ⚠️ 與 tab 版相同：`deleted`(10) 只是把 status 欄位設成 10，**不是真的刪除**——
 * `GetLiveCategories`（live_platform.ts:210）的查詢條件只有 `platform_id = ?`、完全不過濾狀態，
 * 而且本 service 沒有任何 delete method。
 *
 * ⚠️ 這支是**改直播分類狀態的唯一正確途徑**。不要改用
 * `aladdin_platform_live_platform_create_or_update_live_category` 去帶 status——那支的
 * `status` 在 rajah 上標 `@Readonly`，而且後端有「沒帶 status 就把它寫成 0」的地雷
 * （詳見該檔檔頭的實測記錄）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateLiveCategoryStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_live_platform_update_live_category_status',
        {
            title: 'Set a live-stream category status',
            description:
                '把單一直播分類改成指定狀態（rajah: LivePlatform.UpdateLiveCategoryStatus）。' +
                'id 從 aladdin_platform_live_platform_get_live_categories 取得。' +
                'status 是**明確的目標狀態**（不是切換／反轉），合法值為 rajah StatusEnum：' +
                'unknown(0)/enabled(1)/disabled(2)/frozen(3)/deleted(10)，一般啟用停用只會用到 ' +
                'enabled/disabled。' +
                '⚠️ 這是**改直播分類狀態的唯一正確途徑**；不要改用 ' +
                'aladdin_platform_live_platform_create_or_update_live_category 去帶狀態（那支的 status ' +
                '在 rajah 上是 @Readonly，且後端有「沒帶 status 就寫成 0」的地雷）。' +
                '⚠️ deleted 只是把狀態欄位設成 10，**不是真的刪除**：GetLiveCategories 完全不過濾狀態，' +
                '設成 deleted 的分類仍會出現在清單裡；本 service 也沒有任何 delete method。' +
                '⚠️ 後端沒有任何狀態機限制，任何合法列舉值之間都能互轉；id 不存在或屬於別平台回 ' +
                'errorCode=14（objectNotFound）、非法列舉值回 errorCode=9（invalidData）——這兩個都是 ' +
                'genie 框架層錯誤碼，本 server 的錯誤名稱反查表只涵蓋 101 以上的業務碼，' +
                '所以回應裡的 errorName 會是「(未知錯誤碼)」，請直接看 errorCode 數字。' +
                '2026-08-28 dev 實測確認：把狀態設成與現值相同時仍回成功（冪等 no-op）。' +
                '本工具在寫入後會自動讀回該筆分類供你核對實際結果。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）向使用者明確詢問是否要在正式環境執行，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會' +
                '忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(1).describe(
                    '直播分類 id，來自 aladdin_platform_live_platform_get_live_categories',
                ),
                status: z.enum(STATUS_KEYS).describe(
                    '目標狀態（明確指定，非切換）：unknown/enabled/disabled/frozen/deleted，一般啟用停用用 enabled/disabled',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);

            const r = await withAutoRelogin(
                () => remote.liveBackOffice.livePlatform.UpdateLiveCategoryStatus(id, STATUS_MAP[ status ]),
            );
            if (r.failed) return asErrorResult(r);

            const afterR = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveCategories());
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    message: '狀態已更新，但寫入後讀回驗證失敗，無法確認實際結果，請自行用 '
                        + 'aladdin_platform_live_platform_get_live_categories 確認',
                    verifyError: { errorCode: afterR.errorCode, message: afterR.message },
                });
            }

            const after = (afterR.data?.rows ?? []).find((row) => row.id === id);
            return asTextResult({
                success: true,
                message: after
                    ? '狀態已更新'
                    : '狀態已更新，但讀回時比對不到這個 id，請自行用 get_live_categories 確認目前狀態',
                category: after ?? null,
            });
        },
    );
}
