/**
 * tools/list_in_house_vendors.ts — aladdin_platform_game_vendor_platform_list_all_in_house_vendors
 *
 * rajah: GameVendorPlatform.ListAllInHouseVendors（game_back_office.rajah:1065，無參數、無 @Permission
 * ——service 頂端的 `# @Permission "GameVendor"` 是註解掉的舊寫法，不是生效中的 attribute，這支 method
 * 實際只受該 service/gate 的基本登入態限制）。
 *
 * 分類依據 method-category-checklist.md 第 2 節「讀取清單/集合查詢」——回傳型別是
 * `vendorIds [i32]`（陣列），方法完全不分頁、無任何篩選參數，屬該節「完全不分頁的全撈」子類，
 * 不是需要強制逐頁掃描的 B 級。
 *
 * agrabah 後端實作（game_vendor_platform.ts methodListAllInHouseVendors）：
 *   SELECT gv.id FROM game_vendor gv WHERE gv.status = enabled AND gv.adapter = InHouse
 * 純查 `game_vendor`（廠商母表，不是遊戲表），條件固定為 status=enabled AND adapter=InHouse，SQL 沒有
 * LIMIT，也**沒有任何 platformId / platform_game_vendor 過濾**——這點與同一 service 底下大多數方法
 * （如 ListGameVendors/ListAllGameVendors 只回本平台已上架的廠商）不同，是本 tool 最重要的資料陷阱：
 * 回傳的是**全平台共用、adapter=InHouse 的廠商全集**，不代表這些廠商都已上架給目前登入的平台。
 * 2026-08-24 dev 實測（pk-platform.alddev.com，帳號 landon001）已直接驗證此落差：
 * ListAllInHouseVendors 回傳 vendorIds=[5,8,9,10]（4 筆），但同一平台的 ListAllGameVendors
 * （本平台已上架廠商全集，22 筆）裡找不到 id=10——代表 id=10 是一個全域存在的 in-house 廠商，
 * 但尚未（或不會）上架給 pk-platform 這個平台。呼叫端若把這個結果誤當「本平台可用的 in-house 廠商」
 * 直接使用，可能會拿到平台實際查無資料的 id。
 * 連續呼叫兩次回傳同一批 id、順序一致（非隨機截斷），4 筆的規模也證實「小型分類清單」的假設；
 * 但後端 SQL 沒有 LIMIT 是事實，若未來 in-house adapter 廠商數量大幅成長，這支 tool 會把全部結果
 * 一次性塞進單次回應，沒有分頁保護。
 *
 * 用途：這支 method 也被 agrabah 內部多個 report/job 用來判斷「哪些廠商 id 屬於 in_house adapter」
 * （agrabah/src/servers/statistic/jobs/game_bet_job_handlers/in_house_game_round_handler.ts、
 * game_daily_report.ts、game_summary_report.ts），MCP 包裝的用途主要是給呼叫端快速取得
 * in-house 廠商 id 集合，用來交叉篩選 aladdin_platform_game_vendor_platform_list_games 等其他
 * tool 的回傳結果（例如篩出哪些遊戲屬於 in-house 廠商）。回傳的 id 只是純數字，沒有廠商名稱等
 * 顯示欄位；若需要名稱，另外用 aladdin_platform_game_vendor_platform_list_game_vendors 查（但如上述，
 * 該 tool 只回本平台已上架的子集，id=10 這類全域存在但未上架本平台的廠商查不到名稱）。
 * 無 id 類篩選欄位可用來精確查單一筆——若只想確認某一個 id 是否為 in-house 廠商，需自行在回傳結果中比對。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListInHouseVendorsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_list_all_in_house_vendors',
        {
            title: 'List in-house adapter game vendor ids (全平台共用，非本平台專屬)',
            description:
                '列出 adapter=InHouse（自研遊戲）的三方廠商 id 全集（rajah: GameVendorPlatform.ListAllInHouseVendors）。' +
                '此方法無任何篩選參數、也不分頁，一次回傳全部符合條件的 id；2026-08-24 dev 實測回傳 4 筆' +
                '（vendorIds=[5,8,9,10]），規模是小型分類清單，但後端 SQL 沒有 LIMIT，理論上若 in-house 廠商數量' +
                '大幅成長，單次回應會不設上限地變大。' +
                '【重要資料陷阱，已 dev 實測驗證】回傳的廠商 id 是**全平台共用的母表全集，不代表已上架給目前' +
                '登入的平台**——2026-08-24 實測發現回傳的 4 筆 id 裡，id=10 並不在同一平台 ' +
                'aladdin_platform_game_vendor_platform_list_game_vendors（本平台已上架廠商）的 22 筆結果內。' +
                '呼叫端不能假設這裡回傳的每個 id 在本平台的其他查詢 tool（如 ' +
                'aladdin_platform_game_vendor_platform_list_games）一定查得到對應資料。' +
                '回傳只有裸 id 陣列，沒有廠商名稱等顯示欄位，用途是拿來跟其他清單 tool 的結果做交叉篩選' +
                '（例如判斷某個 gameVendorId 是否屬於 in-house 廠商），不是拿來單獨展示給使用者看的清單。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllInHouseVendors());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, vendorIds: r.data?.vendorIds ?? [] });
        },
    );
}
