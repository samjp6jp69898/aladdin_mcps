/**
 * tools/get_game_list.ts — aladdin_admin_in_house_game_back_office_get_game_list
 *
 * rajah: InHouseGameBackOffice.GetGameList（in_house_game_back_office.rajah:272）：
 * `method GetGameList(search InHouseGameListSearch 1, page i32 2, pageSize i32 3) (rows [InHouseGameList] 1, totalPage i32 2)`。
 * service 標頭只有 `@LoginRequired`、method 本身無 `@Permission`——同 in_house_game_back_office.rajah:266-268
 * 註解，權限節點已移至 AbuPermissionAdmin/AbuPermissionPlatform，這支方法本身沒有綁任何權限節點。
 * `InHouseGameListSearch`（in_house_game_back_office.rajah:16-21）只有 `gameName`/`gameCode` 兩個欄位，無 `@Hide`。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/GameList.vue:33`
 * `api.remote.inHouseGameBackOffice.main.GetGameList(InHouseGameListSearch.fromObject(searchParams.value), page, pageSize)`，
 * 另 `GameSelect.vue:17` 也呼叫同一支 method 做下拉選單資料源；全庫搜尋 `abu/platform/src/pages`
 * 找不到任何呼叫點，因此本 tool 放在 aladdin-admin（不是 aladdin-platform——上一支
 * ListAvailableGameCodes 因為 Admin/Platform 都真的有呼叫點才放 aladdin-platform，這支不能照搬
 * 同一個判斷，需逐 method 核對呼叫點）。
 *
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:203-245
 * methodGetGameList）：`gameName` 用 `LIKE %...%` 模糊比對，`gameCode` 用 `g.game_code = ?` **精確比對**——
 * 依 method-category-checklist.md 第 2 節，`gameCode` 是可鎖定單一目標的欄位，屬 A 級（相對安全），
 * 不需要套用 B 級「強制逐頁掃描到底」的規則。`pageSize` 是裸 `i32`（非 `PageSizeEnum`），後端只有
 * `pageSize = pageSize || DefaultPageSize`（DefaultPageSize=100，agrabah/src/common/database_helper.ts:11），
 * 沒有 clamp 上界，但因為有 gameCode 精確查找可用，不依賴逐頁掃描定位單筆，此風險不影響本 tool 的設計。
 * 底層表是 `in_house_game_frameworks`（`DbInHouseGame.tableName`，`agrabah/src/database_types/in_house_game.ts:12`；
 * 舊表 `in_house_games` 已於 migration `202512091505_add_vendor_layer.sql` 改名為 `in_house_games_old`
 * 並由 `in_house_game_frameworks` 取代），`game_code` 欄位有 UNIQUE INDEX
 * （同 migration :24 `in_house_game_frameworks_game_code_index`）——`gameCode` 精確比對最多命中 1 筆，
 * A 級判定前提有 schema 層級保證，不只是業務語意推論。是企劃維護的自研遊戲設定表，語意上是小型清單，
 * 不是會持續成長的 log 類表（實際規模見下方 dev 實測，**不等於** `GameCodeEnum`/`ListAvailableGameCodes`
 * 的 4 個值——這點是 dev 實測才發現的落差，見下方說明，不能只憑 enum 數量推論表列數）。
 *
 * 回傳欄位對應（in_house_game_back_office.ts:234-240）：`id`/`gameName`(←`name`)/`gameCode`(←`game_code`)/
 * `vendorNames`(←`vendor_names` 逗號字串 split，無廠商時為空陣列)/`remark`。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_game_list` tool：
 *   - 無篩選條件：回傳 **5 筆**（id 1/2/3/6/8），不是原先依 `GameCodeEnum` 推論的 4 筆——多出的
 *     id=8「關閉」是 `gameCode=""`（空字串）的停用佔位資料列，`remark="關閉"`，且回傳 JSON 沒有
 *     `vendorNames` 鍵（該列沒有對應廠商、`vendor_names` 為 NULL，`GROUP_CONCAT` 空結果，protobuf
 *     JSON 序列化省略空陣列欄位——這是序列化行為，不代表後端漏欄位，呼叫端讀取時對 `vendorNames`
 *     缺席要視同空陣列處理），totalPage=1（DefaultPageSize=100 下 5 筆仍是 1 頁）。
 *   - `gameCode="CND28"`：精確命中 1 筆（id=1「加拿大 28」），欄位齊全。
 *   - `gameCode="NOT_EXIST_CODE_XXXX"`：回傳 `rows=[]`、totalPage=0（後端 count=0 時 getPageData 回空頁，非錯誤）。
 *   - `gameCode=""`（空字串）：後端 `if (search.gameCode)` 對空字串是 falsy，等同不篩選，回傳跟無篩選
 *     一樣的 5 筆——**這支 tool 無法單獨查出 id=8 那筆「關閉」資料**（傳空字串會被當成不篩選，
 *     不會真的比對 `game_code = ''`），這是後端此方法的既有限制，不是本 tool 的實作缺陷。
 *   - `gameName="28"`（模糊比對，真的存在於 4 筆遊戲名稱中）：命中 4 筆（id 1/2/3/6），正確排除
 *     id=8「關閉」（名稱不含「28」），驗證 LIKE 模糊比對邏輯正確。
 *   - `page=1, pageSize=2`：回傳前 2 筆，`totalPage=3`（5 筆 ÷ 2 = 3 頁），分頁邏輯正確。
 * 純讀取、無副作用，符合分類判定。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { InHouseGameListSearch } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetGameListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_game_list',
        {
            title: 'Search in-house (自研) games list',
            description:
                '分頁查詢自研（in-house）遊戲清單（rajah: InHouseGameBackOffice.GetGameList），如二八槓' +
                '（CND28/ORG28/BIT28/MIN28）這類自研框架遊戲。可用 gameCode（精確比對）或 gameName' +
                '（模糊比對）篩選，兩者皆可省略（回傳全部）。2026-08-25 dev 實測目前規模是 5 筆的小型清單' +
                '（4 款正常遊戲代碼 + 1 筆 gameCode 為空字串的「關閉」停用佔位資料，這筆無法單獨用 gameCode' +
                '篩出——空字串在後端等同不篩選）。gameCode 在後端 in_house_game_frameworks 表有 UNIQUE ' +
                'INDEX，精確比對最多命中 1 筆，若已知代碼建議優先用它篩選；回傳的 id 可用於 ' +
                'InHouseGameBackOffice 其他 method（如編輯）的目標定位。無需任何權限節點，任何已登入本後台' +
                '的使用者皆可呼叫，純讀取、無副作用。',
            inputSchema: {
                gameName: z.string().optional().describe('遊戲名稱，模糊比對（後端 LIKE %關鍵字%）'),
                gameCode: z.string().optional().describe('遊戲代碼，精確比對（如 CND28，後端有 UNIQUE INDEX 保證最多命中 1 筆）；合法值全集可用另一個 MCP server（aladdin-platform）的 aladdin_platform_in_house_game_back_office_list_available_game_codes 取得（同一支後端 method，兩個 server 皆可呼叫）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(200).optional().describe('每頁筆數，預設 100（後端 DefaultPageSize），上限 200'),
            },
        },
        async ({ gameName, gameCode, page, pageSize }) => {
            const search = InHouseGameListSearch.fromObject({ gameName: gameName ?? '', gameCode: gameCode ?? '' });
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetGameList(search, page ?? 1, pageSize ?? 100));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage ?? 0 });
        },
    );
}
