/**
 * tools/get_activity_configs.ts — aladdin_platform_activity_platform_get_activity_configs
 *
 * rajah: ActivityPlatform.GetActivityConfigs(search ActivityConfigSearch 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [ActivityConfig] 1, totalPage i32 2,
 * editReadOnlyStatus ActiveStatusEnum 3)
 * （activity_back_office.rajah:1779，@Permission "BonusCenter.Activity.Config"，service
 * 定義於同檔 1767 行，非 @NoPublic）——後台「優惠中心 > 活動管理 > 活動配置」的活動列表。
 * agrabah 對應實作 activity_platform.ts:76-118 methodGetActivityConfigs，確認有真實實作
 * （真的查 DB，非 notImplemented stub）。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」。search struct
 * （ActivityConfigSearch，rajah:1092-1100）有三個可用篩選欄位：status（單選 enabled/
 * disabled）、name（模糊，任一語系符合即顯示）、activityTabIds（多選）——雖然沒有 id/ids
 * 這種能精準鎖定單一目標的欄位（嚴格說不算第 2 節 A 級），但有 3 個可組合縮小範圍的真實篩選
 * 條件，不是只有「範圍鍵+分頁」的 B 級高風險情況（B 級指的是像 `ListGames(gameVendorId, page,
 * pageSize)` 那種完全沒有可篩選欄位、只能逐頁掃描比對）。本工具沒有實作「逐頁掃描到底」的
 * 內部查找邏輯，是因為沒有必要包成「用業務鍵查特定一筆」的工具——直接把這三個篩選欄位開放給
 * 呼叫端組合使用即可；description 已明確提醒「不帶任何篩選條件時，目標活動不一定在第一頁，
 * 大量活動時建議先用 name 或 activityTabIds 縮小範圍」。
 *
 * agrabah 實作細節（讀源碼查證）：
 * - 三個篩選條件可單獨或合併使用，合併時是 AND；基底一律排除 status=deleted（軟刪除）。
 * - status 篩選：ActiveStatusEnum（enabled/disabled）對應到 DB 的 StatusEnum.enabled/
 *   disabled，未帶則不篩選。
 * - name 篩選：`LIKE %value%`，對任一語系符合即顯示（EXISTS 子查詢，避免多語 JOIN 造成同一
 *   活動重複計數）。
 * - activityTabIds 篩選：`IN (...)`，符合所選欄目其中之一即可；欄目 id 來自
 *   aladdin_platform_activity_platform_get_activity_tabs 的回傳 id。
 * - pageSize 是 `PageSizeEnum`（離散值 10/20/30/50/100/200，非裸 i32）。這支 method 在 rajah
 *   沒有掛 `@Validate`（對照同檔 `GetActivityFlagUsages` 有掛），但伺服器端驗證另有機制、不
 *   靠 `@Validate`：jasmine 對所有 enum 型別參數會在生成的 handler wrapper 自動插入成員檢查
 *   （agrabah/src/generated/services.gen.ts:38517 `handleGetActivityConfigs`：
 *   `if (!(request.pageSize === 0 || PageSizeEnum.hasOwnProperty(request.pageSize)))
 *   { return GenieResult.error(ErrorCode.invalidData, 'pageSize'); }`），跟 `@Validate` 是
 *   兩套獨立機制。2026-08-25 dev 實測直接繞過 MCP 層 zod、用 pageSize=15 直打 RPC 驗證：後端
 *   回 errorCode=9（invalidData）、message="pageSize"，證實這層伺服器端保證真實存在，不是本
 *   工具 zod schema 單方面的假設。省略 pageSize 時後端會用 DefaultPageSize（活動基礎設定
 *   sort_order 常見大量相同值 0，agrabah 端已額外加 id 做第二排序鍵避免同分頁飄動）。
 * - `editReadOnlyStatus`：全平台層級的「編輯是否唯讀」開關（來自後台某個 job 開關快取），跟
 *   個別活動無關，是這支 method 附帶回傳的全域旗標，不是每筆活動各自的欄位。
 * - 回傳的 `ActivityConfig` 是很大的巢狀物件（`activityBaseConfig` 單一 model 就有 60+
 *   欄位：顯示期間、參與資格、多語圖片/文案等，另外還有 `questConfigs` 任務設定陣列），本工具
 *   不在 description 逐一列舉全部欄位，只標出常用的識別欄位（id/name/status/sortOrder/
 *   activityTabId/startTimestamp/endTimestamp），呼叫端需要其他欄位時直接讀回傳 JSON 即可。
 * - **`totalPage`/`totalRow` 只有 `page=1` 時才會真的計算，其他頁一律回 0**——讀共用 helper
 *   `getPageData`（database_helper.ts:204-230）：`if (page === 1) { 算 totalPage/totalRow }`，
 *   非第一頁完全跳過這段、直接沿用初始值 0。2026-08-25 dev 實測驗證：`page=1,pageSize=10` 回
 *   `totalPage=11`；同組篩選條件 `page=2,pageSize=10` 回 `totalPage=0`（但 `rows` 仍正確回傳
 *   10 筆，不是查詢失敗）。呼叫端**不能**把非第一頁的 `totalPage=0` 當成「沒有更多資料」，
 *   要嘛依第一次呼叫（page=1）拿到的 totalPage 記住頁數上限，要嘛用「回傳筆數 < pageSize」
 *   判斷是否為最後一頁（method-category-checklist.md 第 2 節建議的通用寫法）。description 已
 *   明確告知此陷阱。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-25，pk-platform.alddev.com，帳號 landon001；透過獨立 spike script，
 *     用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport 直接 spawn 本 worktree
 *     的 src/stdio.ts 呼叫真正的 tool）---
 * 1. 不帶任何篩選：success，100 筆（省略 pageSize 時後端 DefaultPageSize 實測為 100），
 *    totalPage=2。
 * 2. pageSize=10：success，10 筆，totalPage=11。
 * 3. pageSize=15（不合法離散值）：MCP 層直接被 zod 拒絕（`Invalid arguments...Invalid input
 *    at pageSize`），根本沒送到後端——證實 zod union-of-literal 寫法確實有效攔下非法值。
 * 4. status=enabled：success，10 筆，totalPage=8。
 * 5. status=disabled：success，10 筆，totalPage=4。
 * 6. name=測試：success，10 筆，totalPage=2（有實際符合資料，模糊搜尋機制可用）。
 * 7. name=不存在的亂數關鍵字：success，0 筆，totalPage=0（查無資料回空陣列，不報錯）。
 * 8. activityTabIds=[]（空陣列）：totalPage=11，與「完全不帶 activityTabIds」的結果一致
 *    （pageSize=10 時同為 11），證實空陣列在後端等同不篩選，不會產生 `IN ()` 語法錯誤。
 * 9. activityTabIds=[11]：success，10 筆，totalPage=2（篩選確實生效，範圍比全部小）。
 * 10. page=2, pageSize=10：success，10 筆，但 totalPage=0——如上方新增説明，這是後端
 *     `getPageData` 只在 page=1 計算 totalPage 的既有行為，不是本工具或後端的錯誤，已在
 *     description 中明確揭露。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ActivityConfigSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

const PAGE_SIZE_VALUES = [ 10, 20, 30, 50, 100, 200 ] as const;

export function registerGetActivityConfigsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_activity_platform_get_activity_configs',
        {
            title: 'Search this platform\'s activity configs (list)',
            description:
                '查詢本平台的活動配置清單（rajah: ActivityPlatform.GetActivityConfigs），對應後台' +
                '「優惠中心 > 活動管理 > 活動配置」列表。可用 status（單選 enabled/disabled）、' +
                'name（模糊搜尋，任一語系符合即顯示）、activityTabIds（多選，值來自 ' +
                'aladdin_platform_activity_platform_get_activity_tabs 的 id）三個篩選條件組合' +
                '使用（AND），一律排除已軟刪除的活動。⚠️ 沒有可精準鎖定單一活動的 id 篩選欄位，' +
                '活動數量較多時，目標活動不一定出現在第一頁（即使有帶 name/activityTabIds 篩選、' +
                '命中多筆時同樣可能發生）——建議用更精確的 name 關鍵字或 activityTabIds 進一步' +
                '縮小範圍，或翻頁到底確認。pageSize 只接受離散值 ' +
                '10/20/30/50/100/200（後端 PageSizeEnum 限制），省略時用後端預設值。' +
                '⚠️ totalPage 只有在 page=1 時後端才會真的計算，翻到第 2 頁以後 totalPage 一律' +
                '回 0（2026-08-25 dev 實測驗證，非本工具的 bug）——判斷是否翻到最後一頁，要嘛' +
                '記住第一次呼叫（page=1）拿到的 totalPage，要嘛用「這次回傳筆數 < pageSize」' +
                '判斷，不能看非第一頁的 totalPage。' +
                '回傳的每筆活動是巢狀大物件（activityBaseConfig 顯示/參與資格/多語圖文設定 + ' +
                'questConfigs 任務設定），本說明只標出常用識別欄位：id（@Hide，供後續編輯/切換' +
                '狀態用，本 MCP 目前未提供編輯/切換 tool）、status、sortOrder、name（多語系）、' +
                'activityTabId、startTimestamp/endTimestamp（活動期間，i64 timestamp）。另外' +
                '回傳的 editReadOnlyStatus 是全平台層級的編輯唯讀開關，跟個別活動無關。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('依活動開關篩選，省略則不篩選'),
                name: z.string().optional().describe('依活動名稱模糊搜尋，任一語系符合即顯示'),
                activityTabIds: z.array(z.number().int()).optional().describe('依活動欄目 id 篩選（多選，符合其一即可），id 來自 aladdin_platform_activity_platform_get_activity_tabs'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，省略預設第 1 頁'),
                pageSize: z.union(PAGE_SIZE_VALUES.map((v) => z.literal(v)) as [ z.ZodLiteral<number>, ...z.ZodLiteral<number>[] ]).optional().describe('每頁筆數，只接受 10/20/30/50/100/200（PageSizeEnum 離散值），省略用後端預設值'),
            },
        },
        async ({ status, name, activityTabIds, page, pageSize }) => {
            const search = ActivityConfigSearch.create({
                status: status ? ACTIVE_STATUS_MAP[ status ] : undefined,
                name: name ?? '',
                activityTabIds: activityTabIds ?? [],
            });

            const r = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.GetActivityConfigs(search, page ?? 1, pageSize ?? 0));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                rows: r.data?.rows ?? [],
                totalPage: r.data?.totalPage,
                editReadOnlyStatus: r.data?.editReadOnlyStatus,
            });
        },
    );
}
