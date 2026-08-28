/**
 * tools/get_rebate_config_name_list.ts — aladdin_platform_rebate_platform_get_rebate_config_name_list
 *
 * rajah: RebatePlatform.GetRebateConfigNameList() (rows [RebateConfigNameList] 1)
 * （rebate_back_office.rajah:288，method 級 @Permission "BonusCenter.Rebate"（同檔 287）；
 * service RebatePlatform 定義於同檔 268 行、@Module "Rebate"（267），service 級的
 * `# @Permission "BonusCenter.Rebate"`（266）是**被註解掉的**，所以有效權限節點就是 method
 * 級那個；非 @NoPublic、非 Placeholder）。model RebateConfigNameList 見同檔 261-264，
 * 只有 id + rebateName 兩個欄位。
 *
 * 這支的實際使用場景**未經前端證實**：agrabah docblock（rebate_platform.ts:872-883）寫的是
 * 「後台返水紀錄查詢頁面的『返水層級名稱』下拉選單」，但 `grep -rn GetRebateConfigNameList
 * abu`（排除 generated）在 admin/common/platform 三個前端專案都是 0 命中，目前沒有任何前端
 * 呼叫端。本檔因此不宣稱它對應到哪一頁。
 *
 * agrabah 對應實作：rebate_platform.ts:884-893 methodGetRebateConfigNameList，確認有真實
 * override（真的查 DB `rebate_configs`），不是 base class 的 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——**完全不分頁的全撈**
 * （`loadObjects(DbRebateConfig, 'platform_id = ?', [platformId], 'id asc', '')`，第 5 個參數是
 * limit 字串、傳空字串代表沒有 LIMIT）。依第 2 節「完全不分頁的全撈」條款做的判定：返水配置是
 * 後台人工建立的設定表，不是投注/log 這種高頻成長的表，2026-08-28 dev 上是 25 筆，量級目前安全。
 * ⚠️ 但這**不是結構性保證**：DeleteRebateConfig 是軟刪除（rebate_platform.ts 把 deleted 設為 1、
 * 不刪 row），而本 method 又不濾 deleted，所以對本 tool 而言這張表**只增不減、單調成長**
 * （dev 上 25 筆裡已有 12 筆是已刪除的，佔 48%）。目前後端沒有分頁參數可用，若日後筆數成長到
 * 不可接受，正確的解法是請後端補分頁或補 deleted 篩選，而不是在 tool 層想辦法。
 * 回傳只有 id/rebateName 兩欄，沒有金額、沒有 PII，不涉第 8 節敏感資料。
 *
 * ⚠️ **與 GetRebateConfigs 的關鍵行為差異（讀源碼查證，已 dev 實測驗證）**：
 * - `GetRebateConfigs`（列表頁）條件是 `platform_id = ? AND deleted = 0`（rebate_platform.ts:43），
 *   **排除軟刪除**。
 * - 本 method 條件只有 `platform_id = ?`（rebate_platform.ts:886），**沒有 deleted 篩選**，
 *   所以已被 DeleteRebateConfig 軟刪除的配置仍會出現在這份名稱清單裡。
 * 呼叫端要「目前有效的返水配置」時不能只用本 tool 的結果，必須另外用
 * aladdin_platform_rebate_platform_get_rebate_configs 對照；本 tool 的定位是「id ↔ 名稱對照表」
 * （例如拿到某筆返水紀錄的 configId 要反查名稱時，含已刪除的反而是需要的）。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是直接呼叫 remote）---
 * 1. 呼叫本 tool（無參數）：success，rowCount=25，回傳 25 筆 {id, rebateName}，id 由小到大
 *    （24…1062），名稱含中文/英文/長度測試資料，無 null/空欄位。
 * 2. 「不排除軟刪除」的宣稱實測驗證：同一 session 另外逐頁呼叫 GetRebateConfigs
 *    （page=1,pageSize=200，totalPage=1）拿到 13 筆。兩者 id 取差集：
 *    只出現在本 tool 而不在 GetRebateConfigs 的 id 有 12 筆
 *    （24, 26, 43, 44, 1052, 1055, 1056, 1057, 1058, 1059, 1060, 1062）；
 *    反方向差集為空（GetRebateConfigs 沒有任何一筆不在本清單裡）。
 *    25 = 13 + 12，與「本 method 沒有 deleted 篩選、GetRebateConfigs 有」的源碼判讀完全吻合，
 *    證實 description 的警告是真實行為而非推論。
 * 3. 回傳型別確認：rows 只有 id、rebateName 兩個欄位，沒有金額/PII 欄位。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetRebateConfigNameListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_get_rebate_config_name_list',
        {
            title: 'List this platform\'s rebate config id/name pairs',
            description:
                '取得本平台**全部**返水配置的 id 與名稱對照清單（rajah: ' +
                'RebatePlatform.GetRebateConfigNameList），對應後台「優惠中心 > 返水管理」各頁的' +
                '返水配置下拉選單。無任何參數、不分頁、一次回傳全部（後端 SQL 沒有 LIMIT，' +
                '依 id 由小到大排序）。每筆只有兩個欄位：id、rebateName。' +
                '⚠️ 本 method 後端查詢條件只有 platform_id，**不排除已軟刪除的配置**，' +
                '所以回傳會包含後台已刪除的返水配置；而 ' +
                'aladdin_platform_rebate_platform_get_rebate_configs（列表）的條件是 ' +
                '`deleted = 0`，會排除它們。要「目前生效中的返水配置」請用後者，' +
                '本 tool 適合用在「拿到 configId 要反查名稱」（含已刪除的才查得到）的場景。' +
                '⚠️ 也因為如此，這裡拿到的 id 不保證能用 ' +
                'aladdin_platform_rebate_platform_get_rebate_config_by_id 查到內容——' +
                '該 method 的條件含 deleted = 0，已刪除的會回錯誤。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigNameList());
            if (r.failed) return asErrorResult(r);

            const rows = r.data?.rows ?? [];
            return asTextResult({
                success: true,
                rowCount: rows.length,
                rows,
            });
        },
    );
}
