/**
 * tools/set_home_page_popup_status.ts — aladdin_platform_ad_home_page_pop_up_platform_set_status
 *
 * rajah: AdHomePagePopUpPlatform.SetStatus(id i32 1, status StatusEnum 2) ()
 * （advertisement_back_office.rajah:104，需要 @Permission "Advertisement.HomePagePopUp.Status.Edit"）
 *
 * 對應前端頁面：「廣告管理」→「首頁彈窗」列表頁的啟用/停用切換、以及刪除（rajah 沒有獨立
 * Delete method，前端刪除實際上是呼叫這支 SetStatus 帶 status=deleted，見下方軟刪除說明）。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（非空殼，真的寫 DB）：
 * `ad_home_page_pop_up.ts` methodSetStatus → `cache_manager.ts:367-413` setPlatformAdStatus：
 * - `NormalizeStatus`（cache_manager.ts:548-555）：**`status` 帶 `unknown(0)` 一定會被拒絕**
 *   （`errorCode=adInvalidConfig`），跟同 server 其他工具（如 `aladdin_platform_game_vendor_platform_update_game_vendor_status`
 *   底層呼叫的 `GameVendorPlatform.UpdateGameVendorStatus`）不完全一樣，不能假設「帶 StatusEnum 合法值即可」
 *   ——這裡 unknown 雖然是合法列舉值，仍被業務邏輯明確排除，同名/同分類 method 不能假設同構
 *   （method-category-checklist.md §11「同名 method 陷阱」的同一種提醒）。
 * - 用 `id + platform_id` 定位（cache_manager.ts:378-379），id 不存在**或存在但不屬於本平台**兩種情況
 *   統一回 `errorCode=adConfigNotFound`，本工具無法從錯誤碼分辨是哪一種。
 * - **不是冪等操作**：底層 `updateObject(existing, notModifiedIsError=true)`——第二參數為 true，
 *   當要寫入的物件跟 DB 現值逐欄比對後**完全沒有差異**（`affectedRows=0`）時會被當成錯誤，回
 *   `errorCode=10`（genie/common `ErrorCode.nothingChanged`，不在 `AgrabahErrorCodeEnum` 涵蓋範圍，
 *   `asErrorResult` 反查會顯示「未知錯誤碼」）。**精確觸發條件不只是「目標狀態＝現值」**：
 *   `setPlatformAdStatus`（cache_manager.ts:390-391）除了改 `status` 外，每次呼叫都會無條件覆寫
 *   `existing.operatorId = context.userId`（`operatorId` 是一般欄位，不在比對排除清單內），所以真正
 *   會觸發 `errorCode=10` 的條件是「目標狀態＝現值**且**呼叫者＝上一次寫入這筆資料的 operatorId」；
 *   換一個身分對同一筆呼叫相同 status，`operatorId` 這欄會不同，仍會真的執行一次 UPDATE 並回
 *   `errorCode=0` 成功（意外觸發一次 audit log，但不影響呼叫端看到的結果）。2026-08-25 dev 實測驗證的
 *   是「同帳號、disabled → disabled」這個情境（真的失敗回 `errorCode=10`），本工具在 handler 內攔下
 *   `errorCode=10` 改回成功回應（語意上「已是目標狀態」對呼叫端是良性結果，不該報錯），呼叫端因此
 *   不會看到這個錯誤碼，但底層精確觸發條件如實記錄於此供之後維護參考。
 * - **`status=deleted` 是軟刪除，不是硬刪除**（沒有對應 Delete method，這是本 service 唯一的「刪除」
 *   入口）：`cache_manager.ts:404-406` 對 `deleted` 走稽核 `AuditData.createDelete`，其餘狀態走
 *   `platformActionStatusChange`。刪除後的資料仍在 DB，只是 `GetConfigs` 預設查詢會排除（見
 *   `aladdin_platform_ad_home_page_pop_up_platform_get_configs` 的 status 預設排除 deleted 邏輯），
 *   帶 `status=deleted` 篩選仍查得到。
 * - 本 service **沒有帶 id 的單筆查詢 method**（`GetConfigs` 的 `AdSearch` 沒有 id 欄位），無法像
 *   其他 update 工具那樣先讀現值/寫入後精準讀回單筆。round-trip 改用「寫入後用目標 status 篩選
 *   `GetConfigs` 找這個 id」——非精準單筆查詢，是儘力而為的驗證，找不到不代表寫入失敗（見 handler）。
 *
 * 2026-08-25 dev（pk-platform.alddev.com）實測：用真正的 `@modelcontextprotocol/sdk`
 * `StdioClientTransport` + `tools/call`（非直打 remote.gen.ts）驗證，涵蓋 9 個情境：enabled/disabled
 * 正常切換各一次、同值重複呼叫（發現 errorCode=10 並修正攔截）、status=unknown 被拒、不存在的 id
 * 被拒、status=deleted 軟刪除（同時作為測試資料清理），全數 PASS，dev 無殘留可見資料。見 README。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AdSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

/** round-trip 掃描上限：目標狀態篩選下最多掃 3 頁 × 200 筆（見檔頭「沒有帶 id 的單筆查詢 method」說明）。 */
const ROUND_TRIP_MAX_PAGES = 3;
const ROUND_TRIP_PAGE_SIZE = 200;

export function registerSetHomePagePopupStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ad_home_page_pop_up_platform_set_status',
        {
            title: 'Set a home page popup ad status on this platform',
            description:
                '把本平台「廣告管理」→「首頁彈窗」某筆廣告的狀態改成指定值（rajah: AdHomePagePopUpPlatform.SetStatus，' +
                '需要權限節點 Advertisement.HomePagePopUp.Status.Edit）。' +
                '**`status=deleted` 是唯一的刪除入口**（本 service 沒有獨立 Delete method），屬軟刪除——' +
                'GetConfigs 預設查詢會排除，但資料仍在 DB，帶 status=deleted 篩選仍查得到。' +
                '**status=unknown 一定會被後端拒絕**（errorCode=adInvalidConfig），不是合法的目標狀態，' +
                '即使它是 StatusEnum 的合法列舉值——不要假設跟同 server 其他狀態切換 tool 行為一致。' +
                '目標狀態與現值相同（且呼叫者與上次寫入者相同，詳見檔頭）時後端底層會回 errorCode=10（nothingChanged），本工具已攔下並改回成功回應' +
                '（訊息會註明「未實際變更」），呼叫端不需要自己特判這個情況。' +
                'id 不存在、或存在但不屬於本平台，兩者統一回 errorCode=adConfigNotFound，無法分辨是哪一種。' +
                '本 service 沒有帶 id 的單筆查詢 method，round-trip 改用寫入後以目標 status 篩選' +
                'GetConfigs（最多掃 3 頁）尋找這個 id 做儘力而為的驗證，找不到不代表寫入失敗，只代表反查未命中' +
                '（詳見回傳的 readBack 註記）。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion 明確詢問' +
                '使用者是否要在正式環境執行，取得同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。' +
                '非 prod 環境會忽略 confirm。',
            inputSchema: {
                id: z.number().int().describe('廣告 id，來自 aladdin_platform_ad_home_page_pop_up_platform_get_configs 回傳的 rows[].id'),
                status: z.enum(STATUS_KEYS).describe(
                    '目標狀態。**unknown 一定會被後端拒絕**，實務上會用到的是 enabled（啟用）/disabled（停用）/' +
                    'deleted（軟刪除，本 service 唯一的刪除方式）；frozen 語意未在此工具範圍內描述。',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            const r = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.SetStatus(id, targetStatus));
            if (r.failed) {
                // errorCode=10（genie/common ErrorCode.nothingChanged，非 AgrabahErrorCodeEnum 涵蓋範圍，
                // asErrorResult 的 errorName 反查會顯示「未知錯誤碼」）：2026-08-25 dev 實測發現目標狀態與
                // 現值相同時，底層 updateObject(existing, notModifiedIsError=true) 會把 affectedRows=0
                // 當錯誤處理（agrabah/src/engines/relational_database/mysql/mysql_relational_database_engine.ts:236），
                // 不是「找不到」也不是「非法值」，語意上是良性的「已是目標狀態」——這裡攔下來改回成功回應，
                // 讓呼叫端不必自己特判這個錯誤碼。
                if (r.errorCode === 10) {
                    return asTextResult({
                        success: true,
                        message: `目標狀態與現值相同（errorCode=10 nothingChanged），未實際變更，視為成功`,
                        readBack: { id, status: targetStatus, note: '未實際變更，非讀回的真實列' },
                    });
                }
                return asErrorResult(r, {
                    hint: 'errorCode=adConfigNotFound 代表 id 不存在或不屬於本平台；errorCode=adInvalidConfig 常見原因是 status=unknown。',
                });
            }

            // round-trip：本 service 沒有帶 id 的單筆查詢，改用目標 status 篩選 GetConfigs 掃前幾頁找這個 id。
            let matched;
            let scannedPages = 0;
            for (let page = 1; page <= ROUND_TRIP_MAX_PAGES; page++) {
                const checkR = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetConfigs(
                    AdSearch.create({ status: targetStatus }), page, ROUND_TRIP_PAGE_SIZE,
                ));
                if (checkR.failed) break;
                scannedPages = page;
                const rows = checkR.data?.rows ?? [];
                matched = rows.find((row) => row.id === id);
                if (matched || rows.length < ROUND_TRIP_PAGE_SIZE) break;
            }

            return asTextResult({
                success: true,
                message: `已呼叫 SetStatus 成功（errorCode=0），目標狀態=${ status }`,
                readBack: matched ?? {
                    id, status: targetStatus,
                    note: `反查未命中（已掃描 ${ scannedPages } 頁、每頁 ${ ROUND_TRIP_PAGE_SIZE } 筆，非精準單筆查詢），不代表寫入失敗，請自行到後台確認`,
                },
            });
        },
    );
}
