/**
 * tools/list_available_game_codes.ts — aladdin_platform_in_house_game_back_office_list_available_game_codes
 *
 * rajah: InHouseGameBackOffice.ListAvailableGameCodes（in_house_game_back_office.rajah:271，無參數、
 * service 標頭只有 `@LoginRequired`，無 `@Permission`——此 service 是 Admin/Platform 雙模組共用，
 * 依 in_house_game_back_office.rajah:266-268 註解，權限節點已移至 AbuPermissionAdmin/
 * AbuPermissionPlatform，這支方法本身沒有綁任何權限節點，任何已登入本平台後台的使用者皆可呼叫）。
 *
 * host server：`in_house_game_back_office`（agrabah/rajah/server_in_house_game_back_office.json），
 * 非本 MCP server 直接連線的 `platform` server；呼叫走 abu/platform 既有的 gRPC client 通道
 * （project.json `InHouseGameBackOffice` group，service 別名 `main`，見 abu/platform/src/pages/game/
 * GameRealtimeBetRecord.vue:51 `api.remote.inHouseGameBackOffice.main.GetVendorList`同一 group 用法；
 * Admin 端對應用法見 abu/admin/src/pages/game/two_eight/GameCodeSelect.vue:14
 * `api.remote.inHouseGameBackOffice.main.ListAvailableGameCodes()`，兩子系統呼叫的是同一支後端方法）。
 *
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:185-188
 * methodListAvailableGameCodes）：`response.gameCodes = Object.values(GameCodeEnum)`，直接轉傳
 * `agrabah/src/servers/in_house_game_master/logics/common/game_logic_factory.ts:8-13` 定義的
 * `GameCodeEnum`（固定 4 個值：CND28/ORG28/BIT28/MIN28，全部是「二八槓」玩法的遊戲代碼），
 * 純靜態列舉、不查任何 DB table，不是 notImplemented 佔位。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 2 節「讀取清單/集合查詢」——回傳型別是 `gameCodes [string]`（陣列），完全不分頁、無任何
 * 篩選參數，屬該節「完全不分頁的全撈」子類：語意上是固定的小型列舉表（後端程式碼裡的 enum，
 * 不是會持續成長的 DB 表），沒有第 2 節「B 級高風險」規則要處理的 LIMIT/翻頁疑慮。
 *
 * 用途（agrabah 原始碼註解 in_house_game_back_office.ts:174-180）：後台「新增二八槓遊戲」表單的
 * 「遊戲代碼」下拉選單資料源，避免前端硬編碼 gameCode。
 *
 * === 2026-08-25 dev 實測（pk-platform.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 `@modelcontextprotocol/sdk` 的 Client + StdioClientTransport 透過 stdio
 * spawn 本 MCP server（比照 README.md 第 5 步 SDK inspector 建議），實際呼叫已註冊的
 * `aladdin_platform_in_house_game_back_office_list_available_game_codes` tool 兩次：
 * 兩次皆回傳 `{ success: true, gameCodes: ["CND28","ORG28","BIT28","MIN28"] }`，與
 * GameCodeEnum 定義的 4 個值完全一致、順序穩定。純讀取、無副作用，符合分類判定。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListAvailableGameCodesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_in_house_game_back_office_list_available_game_codes',
        {
            title: 'List available in-house (二八槓) game codes',
            description:
                '列出自研（in-house）二八槓遊戲可用的 gameCode 全集（rajah: ' +
                'InHouseGameBackOffice.ListAvailableGameCodes）。無任何篩選參數，直接回傳後端固定的 ' +
                'GameCodeEnum 靜態列舉（2026-08-25 dev 實測為 CND28/ORG28/BIT28/MIN28 共 4 筆），' +
                '不查詢任何資料庫表，純讀取、無副作用，可安全重複呼叫。' +
                '用途：新增/編輯二八槓遊戲時，取得「遊戲代碼」下拉選單的合法值，避免呼叫端自行' +
                '硬編碼 gameCode 字串。無需任何權限節點，任何已登入本平台後台的使用者皆可呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.ListAvailableGameCodes());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, gameCodes: r.data?.gameCodes ?? [] });
        },
    );
}
