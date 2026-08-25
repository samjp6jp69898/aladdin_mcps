/**
 * tools/list_available_game_codes.ts — aladdin_admin_in_house_game_back_office_list_available_game_codes
 *
 * rajah: InHouseGameBackOffice.ListAvailableGameCodes（in_house_game_back_office.rajah:271，無參數、
 * service 標頭只有 `@LoginRequired`，無 `@Permission`——此 service 是 Admin/Platform 雙模組共用，
 * 依 in_house_game_back_office.rajah:266-268 註解，權限節點已移至 AbuPermissionAdmin/
 * AbuPermissionPlatform，這支方法本身沒有綁任何權限節點，任何已登入本後台的使用者皆可呼叫）。
 *
 * **server 歸屬修正記錄（2026-08-25）**：本 tool 最初誤放在 aladdin-platform（依據是「service 本身
 * Admin/Platform 都能呼叫」的一般結論，套用到這支具體 method 上）。全庫 grep 驗證後發現
 * `ListAvailableGameCodes` 實際上**只有** `abu/admin/src/pages/game/two_eight/GameCodeSelect.vue:14`
 * 這一個真實呼叫點，`abu/platform/src/pages` 底下完全沒有任何呼叫（platform 頁面用到的是同 group
 * 下的 `GetVendorList`/`GetPlayGroupList` 等其他 method，不代表這支也被用到）。已改放 aladdin-admin，
 * 與 sibling tool `aladdin_admin_in_house_game_back_office_get_game_list`（同樣是 admin two_eight
 * 頁面家族在用）放在同一個 server。若未來 platform 端真的新增呼叫點，屆時再比照本檔案新增一份即可。
 *
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:185-188
 * methodListAvailableGameCodes）：`response.gameCodes = Object.values(GameCodeEnum)`，直接轉傳
 * `agrabah/src/servers/in_house_game_master/logics/common/game_logic_factory.ts:8-13` 定義的
 * `GameCodeEnum`（固定 4 個值：CND28/ORG28/BIT28/MIN28，全部是「二八槓」玩法的遊戲代碼），
 * 純靜態列舉、不查任何 DB table，不是 notImplemented 佔位。**注意**：這 4 個值是「合法遊戲代碼全集」，
 * 不等於 `aladdin_admin_in_house_game_back_office_get_game_list` 實際查到的列數（該 tool 2026-08-25
 * dev 實測是 5 筆，多一筆 `gameCode=""` 的「關閉」停用佔位資料，不在這個 enum 裡）。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 2 節「讀取清單/集合查詢」——回傳型別是 `gameCodes [string]`（陣列），完全不分頁、無任何
 * 篩選參數，屬該節「完全不分頁的全撈」子類：語意上是固定的小型列舉表（後端程式碼裡的 enum，
 * 不是會持續成長的 DB 表），沒有第 2 節「B 級高風險」規則要處理的 LIMIT/翻頁疑慮。
 *
 * 用途（agrabah 原始碼註解 in_house_game_back_office.ts:174-180）：後台「新增二八槓遊戲」表單的
 * 「遊戲代碼」下拉選單資料源，避免前端硬編碼 gameCode。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_list_available_game_codes` tool 兩次：
 * 兩次皆回傳 `{ success: true, gameCodes: ["CND28","ORG28","BIT28","MIN28"] }`，與
 * GameCodeEnum 定義的 4 個值完全一致、順序穩定。純讀取、無副作用，符合分類判定。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListAvailableGameCodesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_list_available_game_codes',
        {
            title: 'List available in-house (二八槓) game codes',
            description:
                '列出自研（in-house）二八槓遊戲可用的 gameCode 全集（rajah: ' +
                'InHouseGameBackOffice.ListAvailableGameCodes）。無任何篩選參數，直接回傳後端固定的 ' +
                'GameCodeEnum 靜態列舉（2026-08-25 dev 實測為 CND28/ORG28/BIT28/MIN28 共 4 筆），' +
                '不查詢任何資料庫表，純讀取、無副作用，可安全重複呼叫。' +
                '用途：新增/編輯二八槓遊戲時，取得「遊戲代碼」下拉選單的合法值，避免呼叫端自行' +
                '硬編碼 gameCode 字串（可搭配 aladdin_admin_in_house_game_back_office_get_game_list ' +
                '查詢目前已建立的遊戲清單）。無需任何權限節點，任何已登入本後台的使用者皆可呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.ListAvailableGameCodes());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, gameCodes: r.data?.gameCodes ?? [] });
        },
    );
}
