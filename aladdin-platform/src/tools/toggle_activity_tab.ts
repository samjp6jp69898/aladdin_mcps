/**
 * tools/toggle_activity_tab.ts — aladdin_platform_activity_platform_toggle_activity_tab
 *
 * rajah: ActivityPlatform.ToggleActivityTab(id i32 1, status StatusEnum 2) ()
 * （activity_back_office.rajah:1774-1775，@Permission
 * "BonusCenter.Activity.Config.ActTab.Status.Toggle"，service 定義於同檔 1767 行，非
 * @NoPublic）。agrabah 對應實作
 * agrabah/src/servers/activity_back_office/services/activity_platform.ts:1646
 * methodToggleActivityTab，確認有真實實作：直接呼叫共用 helper
 * `updateStatus(relationalDatabase, id, platformId, status, DbActivityTab.tableName)`
 * （agrabah/src/common/database_helper.ts:25-50），非 base class 的 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 6 節「狀態轉換」——`Toggle*` 系列帶明確目標狀態參數
 * （非無參數 bit-flip），本工具不自作聰明「先查現況再反轉」，呼叫端必須明確帶目標 status。
 *
 * updateStatus helper 的真實行為（讀源碼查證，非推論）：
 * 1. `UPDATE ... WHERE id = ? AND platform_id = ?`（database_helper.ts:31-37，platformId 由
 *    context 帶入、非參數，天生限定在目前平台範圍內，無跨租戶風險）。
 * 2. status 值域檢查用 `StatusEnum.hasOwnProperty(status) && status !== StatusEnum.last`
 *    （database_helper.ts:27-29），合法值含 unknown(0)/enabled(1)/disabled(2)/frozen(3)/
 *    deleted(10)，非法值回 invalidData，不會寫入。
 * 3. **`UPDATE` 影響列數為 0 時回 objectNotFound（database_helper.ts:45-46），但這個「影響列數」
 *    在本專案的連線設定下等於「matched rows」，不是「changed rows」**：agrabah 用
 *    `mysql.createPool(connectionString)`（mysql_relational_database_engine.ts:402）沒有覆寫
 *    connection flags，而 mysql2 的預設 flags 就包含 `CLIENT_FOUND_ROWS`
 *    （node_modules/mysql2/lib/connection_config.js）。也就是說「新值與現值完全相同」的 UPDATE
 *    一樣算「有影響（matched=1）」，不會被誤判成 objectNotFound——2026-08-25 dev 實測對「已是
 *    deleted 的 id 再次設為 deleted」（現值與目標值完全相同）呼叫確實回成功而非 objectNotFound，
 *    印證這個結論。因此 objectNotFound 在這支 method 上可以放心解讀為「id 不存在，或不屬於
 *    目前這個平台」，不需要額外用「先讀現值再判斷」的方式規避歧義——本工具不做這一步，直接呼叫
 *    RPC，天生冪等，也不會有「讀現值到送出 RPC之間」的競態誤報窗口。
 * 4. **`GetActivityTabs` 排除 status=deleted 的列**（activity_platform.ts:1551），這代表
 *    ToggleActivityTab 是這組 method 唯一能把頁籤變成 deleted 的入口（沒有獨立 Delete
 *    method）——把 status 設為 deleted 等同軟刪除。已軟刪除的頁籤仍存在於 DB（只是查詢清單
 *    排除它），依上一點的結論，對它再次呼叫 ToggleActivityTab（包含改回 enabled/disabled，
 *    等同復原軟刪除）一樣會成功，不會被誤判成「id 不存在」。
 *
 * --- dev 驗證（2026-08-25，pk-platform.alddev.com，帳號 landon001；透過獨立 spike script，
 *     用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport 直接 spawn 本 worktree
 *     的 src/stdio.ts 呼叫真正的 tool，不經過 Claude Code session 的 MCP 連線設定）---
 * 用 create_or_update_activity_tab 建一筆專用測試頁籤，依序測試（初版短路邏輯與精簡後版本各
 * 重跑過一輪，測試用 id 分別為 1046~1049，行為一致）：
 * 1. 切成 enabled：成功，讀回驗證相符。
 * 2. 同值再呼叫一次 enabled：成功（非 objectNotFound），印證 CLIENT_FOUND_ROWS 結論，讀回
 *    驗證相符。
 * 3. 切成 disabled：成功，讀回驗證相符。
 * 4. 對不存在的 id（999999999）呼叫：後端回 errorCode=14（objectNotFound），工具正確回報
 *    「id 不存在或不屬於本平台」。
 * 5. 設成 deleted（軟刪除）：成功，訊息正確標示「無法讀回驗證」。
 * 6. 讀回 get_activity_tabs 清單確認：該 id 確實消失。
 * 7. 對已是 deleted 的 id 再次呼叫 deleted（現值與目標值相同）：後端回成功，非 objectNotFound。
 * 8. 對已是 deleted 的 id 呼叫 enabled（復原軟刪除）：成功，讀回驗證確認該 id 重新出現且
 *    status=enabled。
 * 每輪測試完成後都已用本工具把該輪測試資料（id=1046/1047/1048/1049）設回 deleted 清理，
 * 無殘留可見資料（deleted 是這組 method 語意上能做到的最大清理程度，無 Delete method 可真正
 * 刪除列）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ErrorCode } from '/Users/user/aladdin/genie/src/common/index.ts';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';

export function registerToggleActivityTabTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_activity_platform_toggle_activity_tab',
        {
            title: 'Set an activity tab to an explicit status',
            description:
                '把指定活動頁籤設為明確的目標狀態（rajah: ActivityPlatform.ToggleActivityTab，需要' +
                '權限節點 BonusCenter.Activity.Config.ActTab.Status.Toggle）。這不是無參數的' +
                '反轉開關，一定要帶明確的目標 status。' +
                'id 從 aladdin_platform_activity_platform_get_activity_tabs 取得。' +
                '本工具接受 enabled/disabled/deleted（後端 RPC 另接受 unknown/frozen，但本產品' +
                '從未對這個 method 使用過這兩個值，刻意不開放，見 status 欄位說明）；deleted' +
                '是這組 method 唯一能軟刪除頁籤的方式（沒有獨立的' +
                'Delete tool）——設成 deleted 後該頁籤會從 get_activity_tabs 的清單消失（該' +
                'query 排除 deleted）。對已經是目標狀態的頁籤重複呼叫（含對已軟刪除的頁籤再次' +
                '設為 deleted，或把它改回 enabled/disabled 等同復原軟刪除）本工具天生冪等，' +
                '2026-08-25 dev 實測確認皆會成功，不會誤判成「id 不存在」。id 不存在或不屬於' +
                '目前這個平台時，後端回明確錯誤，本工具會直接回報，不會靜默成功。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，' +
                '取得明確同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境' +
                '不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().positive().describe('頁籤 id，來自 aladdin_platform_activity_platform_get_activity_tabs'),
                status: z.enum([ 'enabled', 'disabled', 'deleted' ]).describe('目標狀態：enabled/disabled 一般啟停；deleted 為軟刪除。刻意不開放 unknown/frozen——ActivityTab.status 的 model 型別是 ActiveStatusEnum（僅 enabled/disabled，common.rajah 明文「僅包含使用者可見狀態」），前端也從未對這個 method 送過 frozen/unknown，屬本產品從未使用過的狀態，避免呼叫端誤用'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            const r = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.ToggleActivityTab(id, targetStatus));
            if (r.failed) {
                if (r.errorCode === ErrorCode.objectNotFound) {
                    return asTextResult({ success: false, message: `id=${ id } 不存在，或不屬於目前這個平台` });
                }
                return asErrorResult(r);
            }

            if (status === 'deleted') {
                return asTextResult({
                    success: true,
                    message: '已設為 deleted（軟刪除），該頁籤之後不會出現在 get_activity_tabs 的清單裡，無法用讀回驗證，請自行記住這個 id',
                    id,
                });
            }

            const listAfter = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.GetActivityTabs());
            if (listAfter.failed) {
                return asTextResult({
                    success: true,
                    message: 'RPC 回報成功，但寫入後讀回驗證失敗，無法確認實際結果',
                    verifyError: { errorCode: listAfter.errorCode, message: listAfter.message },
                });
            }
            const after = listAfter.data?.rows?.find((row) => row.id === id);

            return asTextResult({
                success: true,
                message: after?.status === targetStatus ? '更新成功，讀回驗證相符' : '寫入 RPC 已成功，但讀回結果與預期不符，請人工確認',
                tab: after ?? null,
            });
        },
    );
}
