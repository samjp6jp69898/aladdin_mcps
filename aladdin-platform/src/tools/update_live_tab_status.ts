/**
 * tools/update_live_tab_status.ts — aladdin_platform_live_platform_update_live_tab_status
 *
 * rajah: LivePlatform.UpdateLiveTabStatus(id i32 1, newStatus StatusEnum 2)（無回傳值）
 * （rajah/services/live_back_office.rajah:69；client 路徑 remote.liveBackOffice.livePlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、service 無 `@NoPublic`、
 * agrabah 對應實作是真實 override（agrabah/src/servers/live_back_office/services/
 * live_platform.ts:152-154，methodUpdateLiveTabStatus），非 base class 的 notImplemented。
 * 權限現況見 get_live_tabs.ts 檔頭（`Live*` 整族權限節點在 rajah 全被註解掉），不重複。
 *
 * 分類：method-category-checklist.md 第 6 節「狀態轉換」。逐條落實：
 * - **不做「先查現況再反轉」**：本 method 帶明確目標狀態參數，第 6 節明文禁止在包裝層自作聰明
 *   反轉，本工具照做——`status` 是必填、由呼叫端指定。
 * - **非法轉換的後端行為**：實作整個委派 `updateStatusWithAudit`
 *   （agrabah/src/common/database_helper.ts:52-60）→ `updateStatus`（同檔 :25-50），行為是
 *   （1）`!StatusEnum.hasOwnProperty(status) || status === StatusEnum.last` → `invalidData`；
 *   （2）`UPDATE live_tabs SET status = ? WHERE id = ? AND platform_id = ?`；
 *   （3）`affectedRows === 0` → `objectNotFound`。**沒有**任何「不允許 A→B」的狀態機檢查，
 *   也沒有 `*StatusInvalid`/`already*` 這類錯誤碼，所以任何合法列舉值之間都能互轉。
 * - **冪等性**：讀 source 時「affectedRows === 0 → objectNotFound」看起來會讓「設成與現值相同的
 *   狀態」被誤判成找不到資料。2026-08-28 dev 實測**推翻**這個推論：對 id=1020 連續兩次設成
 *   disabled，第二次仍回 errorCode=0，代表這條連線以 matched rows 計數。因此重複呼叫是安全的
 *   no-op，本工具不需要、也沒有做任何額外的冪等保護。
 * - 第 6 節的批量／部分失敗條款不適用（本 method 一次只動一筆、無 `failed [T]` 回傳）。
 *
 * ⚠️ **錯誤碼在回應裡看不到名字**（2026-08-28 dev 實測附帶發現，屬全 server 共通現象、非本工具問題）：
 * 這 method 的失敗碼是 genie 框架層的 `ErrorCode`（`genie/src/common/error_code.ts:16`
 * `objectNotFound: 14`），而 `mcp_result.ts` 的 `asErrorResult` 是用生成的
 * `AgrabahErrorCodeEnum` 做反查，那份 enum 從 101 起（gate/auth/業務碼，見
 * `abu/platform/src/generated/remote.gen.ts:19959-19963`），**不含任何 <100 的框架層碼**，
 * 所以呼叫端拿到的是 `errorCode: 14` + `errorName: "(未知錯誤碼)"`。這不是查錯欄位，
 * 是兩套錯誤碼命名空間本來就沒接起來；本檔在 description 直接把 14/9 的語意寫明，
 * 讓呼叫端不必靠 errorName 判讀。
 *
 * ⚠️ `StatusEnum` 的 `deleted`(10) 也是合法值，後端會接受並寫進 DB，但這只是「把 status 欄位設成
 * 10」——**`GetLiveTabs` 不會過濾任何狀態**（agrabah .../live_platform.ts:52 只用 `platform_id = ?`
 * 過濾），所以設成 deleted 的頁籤仍會出現在清單裡，而且**本 service 完全沒有 delete method**，
 * 這是唯一近似「刪除」的操作。本工具開放完整 StatusEnum（沿用同 repo 既有慣例，見
 * `change_activity_ranking_setting_status.ts`），但 description 會把上述語意講清楚，避免呼叫端
 * 把 deleted 當成真的刪掉。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateLiveTabStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_live_platform_update_live_tab_status',
        {
            title: 'Set a live-stream tab status',
            description:
                '把單一直播頁籤改成指定狀態（rajah: LivePlatform.UpdateLiveTabStatus）。' +
                'id 從 aladdin_platform_live_platform_get_live_tabs 取得。' +
                'status 是**明確的目標狀態**（不是切換／反轉），合法值為 rajah StatusEnum：' +
                'unknown(0)/enabled(1)/disabled(2)/frozen(3)/deleted(10)，一般啟用停用只會用到 ' +
                'enabled/disabled。' +
                '⚠️ deleted 只是把狀態欄位設成 10，**不是真的刪除**：GetLiveTabs 完全不過濾狀態，' +
                '設成 deleted 的頁籤仍會出現在清單裡；本 service 也沒有任何 delete method，' +
                '所以頁籤一旦建立就無法真正移除。' +
                '⚠️ 後端沒有任何狀態機限制（沒有「不允許 A→B」的檢查、也沒有 already* 類錯誤碼），' +
                '任何合法列舉值之間都能互轉；id 不存在或屬於別平台回 errorCode=14（objectNotFound）、' +
                '非法列舉值回 errorCode=9（invalidData）。⚠️ 這兩個都是 genie 框架層錯誤碼，' +
                '本 server 的錯誤名稱反查表（AgrabahErrorCodeEnum）只涵蓋 101 以上的業務碼，' +
                '所以回應裡的 errorName 會是「(未知錯誤碼)」，請直接看 errorCode 數字。' +
                '（本工具的 status 參數已用列舉限制在 5 個合法值，invalidData 這條路徑實際上打不到，' +
                '寫在這裡是為了說明後端語意，不是宣稱已實測。）' +
                '2026-08-28 dev 實測確認：把狀態設成與現值相同時仍回成功（冪等 no-op），' +
                '不會被誤判成 objectNotFound。' +
                '本工具在寫入後會自動讀回該筆頁籤供你核對實際結果。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）向使用者明確詢問是否要在正式環境執行，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會' +
                '忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(1).describe(
                    '直播頁籤 id，來自 aladdin_platform_live_platform_get_live_tabs',
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

            const r = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.UpdateLiveTabStatus(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            const afterR = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveTabs());
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    message: '狀態已更新，但寫入後讀回驗證失敗，無法確認實際結果，請自行用 '
                        + 'aladdin_platform_live_platform_get_live_tabs 確認',
                    verifyError: { errorCode: afterR.errorCode, message: afterR.message },
                });
            }

            const after = (afterR.data?.rows ?? []).find((row) => row.id === id);
            return asTextResult({
                success: true,
                message: after
                    ? '狀態已更新'
                    : '狀態已更新，但讀回時比對不到這個 id，請自行用 get_live_tabs 確認目前狀態',
                tab: after ?? null,
            });
        },
    );
}
