/**
 * tools/get_activity_tabs.ts — aladdin_platform_activity_platform_get_activity_tabs
 *
 * rajah: ActivityPlatform.GetActivityTabs() (rows [ActivityTab] 1)
 * （activity_back_office.rajah:1769，service 定義於同檔 1767 行，@Module "Activity"）——
 * 查詢當前平台的活動頁籤清單（後台「優惠中心 > 活動管理」的活動欄目管理彈窗）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（大小寫正確，非
 * `Placeholder` 開頭）、非 @NoPublic（ActivityPlatform service 本身沒有掛
 * @NoPublic，掛 @NoPublic 的是同檔案後段完全不同的另一個 service）。agrabah 對應
 * Service（agrabah/src/servers/activity_back_office/services/activity_platform.ts:1550
 * methodGetActivityTabs）確認真的有 override，直接查 DbActivityTab（排除已刪除，
 * status != deleted），不是落回 base class 的 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——但屬於「完全不分頁的全撈」
 * 情況（GetActivityTabs 本身無 page/pageSize 參數，一次回傳全部）。這是小型設定表
 * （後台活動頁籤管理用的分類清單，非會持續成長的歷史/log 類資料），可放心全撈，不適用
 * 第 2 節 B 級「範圍鍵+分頁無法鎖定目標」的強制檢查。
 *
 * 本方法（GetActivityTabs）在 rajah 沒有掛 @Permission（同檔案內
 * CreateOrUpdateActivityTabs/ToggleActivityTab 這兩支寫入方法才有）；純讀取查詢，
 * 不修改任何資料，可安全重複呼叫；ActivityTab model 只有
 * id/platformId（皆 @Hide，內部用）/status/sortOrder/name（多語系名稱），無密鑰/PII，
 * 不需遮罩。
 *
 * --- dev 驗證（2026-08-25，pk-platform.alddev.com，帳號 landon001；透過 claude mcp add
 *     -s local 把本 worktree 的 src/stdio.ts 暫時註冊成獨立 stdio MCP server 直接呼叫
 *     真正的 tool，測完已移除該暫時註冊，未變更任何共用設定檔）---
 * 登入成功，呼叫 aladdin_platform_activity_platform_get_activity_tabs（無參數）：
 * success true，rows 16 筆真實資料，status 值為 1（enabled）與 2（disabled）皆有出現、
 * 沒有出現 deleted（StatusEnum.deleted=10，common.rajah:1075；ActivityTab.status 的
 * model 端型別是 ActiveStatusEnum，本身就只有 enabled=1/disabled=2 兩個合法值，
 * common.rajah:1083-1086），與檔頭排除已刪除項目的敘述一致；sortOrder 1~16 連續
 * 遞增，符合排序敘述。platformId 欄位**有**出現在回傳（值為 4，本測試平台 id），
 * protobufjs 對 @Hide 欄位並不會在序列化時省略（先前預期它會像 squareImageWeb
 * 空陣列那樣被省略，實測發現不成立——@Hide 只影響後台表單顯示，不影響 API 序列化，
 * 這裡如實記錄避免誤導）。name 陣列不保證涵蓋三語系全部（觀察到部分筆只有
 * zh-CN/zh-TW 兩語系），呼叫端不應假設固定語系數量。純讀取查詢，測試過程未寫入/
 * 修改任何 dev 資料，無需清理。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetActivityTabsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_activity_platform_get_activity_tabs',
        {
            title: 'Get this platform\'s activity tabs',
            description:
                '查詢當前平台的活動頁籤清單（rajah: ActivityPlatform.GetActivityTabs），對應後台' +
                '「優惠中心 > 活動管理」的活動欄目管理彈窗——頁籤用於前台活動列表的分類展示' +
                '（如「熱門活動」「每日任務」），已排除軟刪除項目（status=deleted），依' +
                'sortOrder 由小到大排序。不帶任何參數，一次回傳全部（此為小型設定表，非會持續' +
                '成長的歷史類資料，全撈是安全的）。回傳每筆含 id（供新增/修改用的 ' +
                'aladdin_platform_activity_platform_create_or_update_activity_tabs 定位用；' +
                'ToggleActivityTab 本 MCP 未提供對應 tool）、' +
                'status（數值 1=enabled/2=disabled，不會出現 deleted）、sortOrder、name' +
                '（多語系陣列，不保證涵蓋全部語系）；另外會附帶 platformId（本平台內部 id，' +
                '僅供參考，呼叫端通常不需要用到）。純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.GetActivityTabs());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
