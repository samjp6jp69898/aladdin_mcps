/**
 * tools/get_in_house_play_group_list.ts — aladdin_admin_in_house_game_back_office_get_play_group_list
 *
 * rajah: InHouseGameBackOffice.GetPlayGroupList（in_house_game_back_office.rajah:274）：
 * `method GetPlayGroupList(search InHouseGamePlayGroupListSearch 1, page i32 2, pageSize i32 3) (rows [InHouseGamePlayGroupList] 1, totalPage i32 2)`。
 * service 標頭只有 `@LoginRequired`、method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268
 * 註解，權限節點已移至 AbuPermissionAdmin/AbuPermissionPlatform）。
 * `InHouseGamePlayGroupListSearch`（in_house_game_back_office.rajah:95-101）有 `vendorId`/`status`/`name`
 * 三個可用欄位，另有一個 `playGroupId`（serial 2）**整行被註解掉**（`# playGroupId i32 2`）——這是
 * rajah 檔案裡的真實殘留註解，代表這支 method 原本可能規劃要支援用 id 精確查找，但目前的 protobuf
 * 定義並未啟用這個欄位，search struct 實際只有 3 個生效欄位，皆非 `@Hide`（沒有隱藏欄位可漏）。
 *
 * **前端呼叫點確認 Admin/Platform 兩端都真的有使用**（逐一 grep 核對，比照 GetVendorList 的判斷方式）：
 *   - Admin：`abu/admin/src/pages/game/two_eight/BetRecordList.vue:69`、`PlayGroupSelect.vue:35`、
 *     `GamePlayGroupList.vue:88`
 *   - Platform：`abu/platform/src/pages/game/robot/RobotBettingSettingList.vue:53`、
 *     `GameRealtimeBetRecord.vue:66`、`report/InHouseBetRecord.vue:391,403`
 * 因此本 tool 在 aladdin-admin 與 aladdin-platform 各建一份，這份是 admin 版本。
 *
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:301-346
 * methodGetPlayGroupList，底層表 `in_house_game_play_groups`／`DbInHouseGamePlayGroup`，INNER JOIN
 * `in_house_game_vendors` 取 currencyCode/vendorName）：`vendorId` 用 `pg.vendor_id = ?` 精確比對（範圍鍵，
 * 一個廠商可能有多個玩法組，非唯一鎖定）、`name` 用 `pg.name LIKE %...%` 模糊比對、`status` 用
 * `pg.status = ?` 精確比對（但這是篩選條件、不是鎖定單一目標的欄位）。依 method-category-checklist.md
 * 第 2 節，search struct 沒有 id/ids/code 類可鎖定單一目標欄位（唯一可能的 `playGroupId` 已被註解掉不
 * 存在），**屬 B 級**；同 GetVendorList 的判斷，本 tool 只是單純分頁清單查詢、不是重新發明業務鍵查找的
 * 內部工具，不需要套用「強制逐頁掃描到底」規則。底層表是企劃維護的自研玩法組設定表，語意上是小型清單。
 * 回傳欄位對應（in_house_game_back_office.ts:334-341）：`id`/`currencyCode`(←`v.currency_code`)/
 * `vendorName`(←`v.name`)/`name`(←`pg.name`)/`remark`/`status`（StatusEnum 數字，非 ActiveStatusEnum——
 * 注意 search 用的是 `ActiveStatusEnum`（enabled=1/disabled=2）篩選，但回傳的 `status` 欄位型別是
 * `StatusEnum`，兩者在 enabled/disabled 的數值上相同，但 `StatusEnum` 還有 frozen/deleted 等其他值，
 * search 用 ActiveStatusEnum 篩選時無法篩到那些值——這是 rajah 定義本身的欄位型別不對稱，不是本 tool
 * 造成的落差）。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_play_group_list` tool：
 *   - 無篩選條件：回傳 25 筆（id 1~25，多為二八槓各賠率組別的玩法組，如「加拿大28-1.8」）。
 *   - `vendorId=1`（東昇-加拿大28）：篩出 8 筆（id 25/12/8/7/6/5/4/1），皆為子集。
 *   - `status="enabled"`：篩出 10 筆（id 24/23/22/17/16/15/14/11/10/9），status 皆為 1。
 *   - 不存在的 vendorId（999999）：回傳 `rows=[]`、totalPage=0，非錯誤。
 * 與 aladdin-platform 同名 tool 打同一份底層資料，兩端 4 種情境的 id 列表逐一比對完全一致（同一批
 * dev 站台、同一份 in_house_game_play_groups 表）。純讀取、無副作用，符合分類判定。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { InHouseGamePlayGroupListSearch } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerGetInHousePlayGroupListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_play_group_list',
        {
            title: 'Search in-house (自研) play groups list',
            description:
                '分頁查詢自研（in-house）遊戲「玩法組」清單（rajah: InHouseGameBackOffice.GetPlayGroupList），' +
                '玩法組依附在某個廠商底下（一個廠商可有多個玩法組），常用於報表篩選與二八槓賠率/限額設定。' +
                '可用 vendorId（精確比對，但非唯一鎖定，可用 aladdin_admin_in_house_game_back_office_get_vendor_list ' +
                '查得）、name（模糊比對）、status（enabled/disabled）篩選，皆可省略（回傳全部）。回傳的 status ' +
                '是 StatusEnum 數字（可能出現 search 篩選不到的 frozen/deleted 等值），非 search 用的 ' +
                'ActiveStatusEnum。id 可用於 GetTwoEightOddsSetting/GetTwoEightBetLimitSetting/' +
                'UpdatePlayGroupStatus 等其他 method 的目標定位。無需任何權限節點，任何已登入本後台的' +
                '使用者皆可呼叫，純讀取、無副作用。',
            inputSchema: {
                vendorId: z.number().int().optional().describe('所屬廠商 id，可用 aladdin_admin_in_house_game_back_office_get_vendor_list 查得，一個廠商可能有多個玩法組，此欄位不保證鎖定單一結果'),
                name: z.string().optional().describe('玩法組名稱，模糊比對（後端 LIKE %關鍵字%）'),
                status: z.enum(Object.keys(ACTIVE_STATUS_MAP) as [ keyof typeof ACTIVE_STATUS_MAP ]).optional().describe('狀態篩選（enabled/disabled），省略則不篩選狀態'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(200).optional().describe('每頁筆數，預設 100（後端 DefaultPageSize），上限 200'),
            },
        },
        async ({ vendorId, name, status, page, pageSize }) => {
            const search = InHouseGamePlayGroupListSearch.fromObject({
                vendorId: vendorId ?? 0,
                name: name ?? '',
                status: status ? ACTIVE_STATUS_MAP[ status ] : 0,
            });
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetPlayGroupList(search, page ?? 1, pageSize ?? 100));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage ?? 0 });
        },
    );
}
