/**
 * tools/get_in_house_vendor_list.ts — aladdin_platform_in_house_game_back_office_get_vendor_list
 *
 * rajah: InHouseGameBackOffice.GetVendorList（in_house_game_back_office.rajah:273）：
 * `method GetVendorList(search InHouseGameVendorListSearch 1, page i32 2, pageSize i32 3) (rows [InHouseGameVendorList] 1, totalPage i32 2)`。
 * service 標頭只有 `@LoginRequired`、method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268
 * 註解，權限節點已移至 AbuPermissionAdmin/AbuPermissionPlatform）。
 * `InHouseGameVendorListSearch`（in_house_game_back_office.rajah:56-60）只有 `gameId`/`vendorName` 兩個欄位，無 `@Hide`。
 *
 * **這支 method 是 Admin/Platform 真的都有呼叫點**（與上一支 `ListAvailableGameCodes` 誤判為雙端共用不同，
 * 這次有逐一 grep 核對）：
 *   - Admin：`abu/admin/src/pages/game/two_eight/BetRecordList.vue:59`、`GameVendorSelect.vue:29`、
 *     `GameVendorList.vue:78`
 *   - Platform：`abu/platform/src/pages/game/GameRealtimeBetRecord.vue:51`、
 *     `abu/platform/src/pages/report/InHouseBetRecord.vue:374`
 * 因此本 tool 在 aladdin-admin 與 aladdin-platform 各建一份（服務端邏輯完全相同，各自的 remote client
 * 走各自後台的登入態），這份是 platform 版本。
 *
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:260-286
 * methodGetVendorList，底層表 `in_house_game_vendors`／`DbInHouseGameVendor`）：`gameId` 用 `game_id = ?`
 * 精確比對、`vendorName` 用 `name LIKE %...%` 模糊比對。依 method-category-checklist.md 第 2 節：
 * `gameId` 是**範圍鍵**（一個 game 底下可以有多個廠商，如 `list_available_game_codes.ts` 檔頭提到
 * 「加拿大 28」dev 實測就有 3 個廠商欄位），不是能鎖定單一目標的欄位；`vendorName` 是模糊比對，
 * 同樣無法鎖定單一目標——**屬 B 級（高風險，無可鎖定單一目標欄位）**。但 B 級規則的重點是「禁止把
 * 這類 method 包成內部業務鍵查找工具」，本 tool 只是單純的分頁清單查詢（不是拿來重新發明業務鍵定位
 * 查找），因此不需要套用「強制逐頁掃描到底」的規則，只需誠實揭露分頁與篩選欄位的限制。
 * 底層表 `in_house_game_vendors` 是企劃維護的自研廠商設定表（依附在自研遊戲底下），語意上是小型清單，
 * 不是會持續成長的 log 類表。回傳欄位對應：`InHouseGameVendorList.create(vendor)` 直接把
 * `DbInHouseGameVendor` 的欄位（id/gameId/name/currencyCode/status/remark）原樣映射，無轉換。
 *
 * === 2026-08-25 dev 實測（pk-platform.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_platform_in_house_game_back_office_get_vendor_list` tool：
 *   - 無篩選條件：回傳 9 筆，status 為 StatusEnum 數字（1=enabled、2=disabled 實測皆出現）、
 *     currencyCode 為字串代碼（CNY/JPY 皆出現）。多筆 name="未使用"、remark="可編輯用" 是企劃預留的
 *     空廠商欄位（如 gameId=1 有 3 個廠商欄位：1 個真的在用「東昇-加拿大28」+ 2 個「未使用」佔位）。
 *   - `gameId=1` 精確篩選：只回傳該 gameId 底下的 3 筆，與無篩選結果的子集關係一致。
 *   - `vendorName="東昇"` 模糊篩選：命中 4 筆（id 1/6/7/8），name 皆包含「東昇」，橫跨不同 gameId，
 *     驗證 vendorName 確實跨 game 全域模糊比對、不受 gameId 隱性限制。
 *   - 不存在的 gameId（999999）：回傳 `rows=[]`、totalPage=0，非錯誤。
 * 與 aladdin-admin 同名 tool 打同一份底層資料（同一個 in_house_game_vendors 表），兩邊 dev 實測結果
 * 逐筆一致（9 筆總數、id/gameId/name/currencyCode/status/remark 完全相同）。純讀取、無副作用，
 * 符合分類判定。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { InHouseGameVendorListSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetInHouseVendorListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_in_house_game_back_office_get_vendor_list',
        {
            title: 'Search in-house (自研) game vendors list',
            description:
                '分頁查詢自研（in-house）遊戲廠商清單（rajah: InHouseGameBackOffice.GetVendorList），如' +
                '「東昇-加拿大28」這類掛在某款二八槓遊戲底下的廠商配置。可用 gameId（精確比對，但一個' +
                'game 可能對應多個 vendor，非唯一鎖定）或 vendorName（模糊比對）篩選，兩者皆可省略' +
                '（回傳全部）。回傳的 status 是 StatusEnum 數字（非文字），id 可用於 UpdateVendorStatus' +
                '（啟用/停用切換）或 GetVendorEdit 的目標定位。無需任何權限節點，任何已登入本後台的' +
                '使用者皆可呼叫，純讀取、無副作用。',
            inputSchema: {
                gameId: z.number().int().optional().describe('所屬遊戲 id（本 server 沒有查遊戲清單的 tool，可用另一個 MCP server aladdin-admin 的 aladdin_admin_in_house_game_back_office_get_game_list 查得，兩端讀的是同一份母表），一個遊戲可能有多個廠商，此欄位不保證鎖定單一結果'),
                vendorName: z.string().optional().describe('廠商名稱，模糊比對（後端 LIKE %關鍵字%）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(200).optional().describe('每頁筆數，預設 100（後端 DefaultPageSize），上限 200'),
            },
        },
        async ({ gameId, vendorName, page, pageSize }) => {
            const search = InHouseGameVendorListSearch.fromObject({ gameId: gameId ?? 0, vendorName: vendorName ?? '' });
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetVendorList(search, page ?? 1, pageSize ?? 100));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage ?? 0 });
        },
    );
}
