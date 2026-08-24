/**
 * tools/list_two_eight_games.ts — aladdin_platform_game_vendor_platform_list_all_two_eight_games
 *
 * rajah: GameVendorPlatform.ListAllTwoEightGames（game_back_office.rajah:1062，無參數、無 @Permission、
 * 無 page/pageSize——一次撈全部符合條件的列）。
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單/集合查詢」——回傳型別是
 * `games [TwoEightGameItem]`（陣列），但方法本身完全不分頁、無任何篩選參數，屬該節「完全不分頁的全撈」
 * 子類，不是需要強制逐頁掃描的 B 級。
 *
 * agrabah 後端實作（game_vendor_platform.ts methodListAllTwoEightGames）用純 SQL 查
 * game_vendor_games JOIN game_vendors，條件固定為 status=enabled AND vendor_category=TwoEight
 * AND adapter=InHouse，SQL 沒有 LIMIT——這是「二八遊戲」這個特定 in-house 遊戲分類的全集，
 * 不是會員/帳變等會持續成長的 log 類表，語意上屬於策劃維護的小型分類清單。
 * 2026-08-24 dev 實測（pk-platform.alddev.com，帳號 landon001）：回傳 20 筆，欄位型別正確、
 * id 不重複、gameVendorId 全部落在 ListAllInHouseVendors 回傳的 in-house 廠商集合內、
 * 連續呼叫兩次回傳同一批 id（非隨機截斷）。20 筆的規模驗證了「小型分類清單」的假設，
 * 但後端 SQL 沒有 LIMIT 是事實，若未來這個分類的遊戲數大幅成長，這支 tool 會把全部結果
 * 一次性塞進單次回應，沒有分頁保護。
 *
 * 另外，後端依 context.platformId 是否 > 0 有兩種查詢分支：> 0 時會多 JOIN
 * platform_game_vendors 限定「已啟用給本平台」的廠商；= 0 時不限定平台、回全域 enabled 的
 * 二八遊戲。本 server 是 platform 後台登入態，platformId 恆由登入時的 Host 決定（見
 * session.ts 註解），因此實務上一定會走「限定本平台」分支，但這點是讀 agrabah 原始碼推論、
 * dev 測試沒有另外切換平台驗證兩種分支的差異，如遇 platformId=0 情境的行為以後端原始碼為準。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListTwoEightGamesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_list_all_two_eight_games',
        {
            title: 'List all Two-Eight (二八) games on this platform',
            description:
                '列出本平台可用的「二八遊戲」全部清單（rajah: GameVendorPlatform.ListAllTwoEightGames）。' +
                '二八遊戲是 in_house adapter 廠商底下、vendor_category=TwoEight 的特定遊戲分類（如「加拿大28」' +
                '這類 in-house 開發的快開型遊戲），常用於報表/統計場景（後端多支 statistic report 內部也呼叫同一支）。' +
                '此方法無任何篩選參數、也不分頁，一次回傳全部符合條件的列；2026-08-24 dev 實測回傳 20 筆，' +
                '證實目前規模是小型分類清單，但後端 SQL 沒有 LIMIT，理論上若這個分類的遊戲數大幅成長，' +
                '單次回應會不設上限地變大，呼叫端需留意。' +
                '回傳每筆包含 id（game_vendor_games.id，可作為其他 tool 的 gameId 參照）、name（遊戲名稱，' +
                '2026-08-24 實測發現不少列的 name 是「未調整」這類佔位字串，不代表遊戲真的叫這個名字，' +
                '是資料本身如此，並非本 tool 或後端的錯誤）、gameVendorId（所屬廠商 id）。' +
                '無 id/name 類篩選欄位可用來精確查單一筆——若只想找特定一款遊戲，需自行在回傳結果中過濾。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllTwoEightGames());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, games: r.data?.games ?? [] });
        },
    );
}
