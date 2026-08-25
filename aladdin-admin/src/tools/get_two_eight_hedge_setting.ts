/**
 * tools/get_two_eight_hedge_setting.ts — aladdin_admin_in_house_game_back_office_get_two_eight_hedge_setting
 *
 * rajah: InHouseGameBackOffice.GetTwoEightHedgeSetting（in_house_game_back_office.rajah:282）：
 * `method GetTwoEightHedgeSetting(playGroupId i32 1) (twoEightHedgeSetting TwoEightHedgeSetting 1)`。
 * service 標頭只有 `@LoginRequired`、method 本身無 `@Permission`。`TwoEightHedgeSetting`
 * （in_house_game_back_office.rajah:212-221）：`playGroupId`(@Readonly)/`maxItems`（每局最多可下注玩法
 * 數，MinValue 1/MaxValue 9999）/`groups`([HedgeGroup]，`HedgeGroup.items` 是 `[i32]` betItem 清單，
 * 對沖策略分組）。全部欄位皆無 `@Hide`，無金額類欄位（不像 sibling GetTwoEightOddsSetting/
 * GetTwoEightBetLimitSetting 有 Currency/Rate 型別欄位）。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/HedgeSettingEditPopup.vue:37`
 * `api.remote.inHouseGameBackOffice.main.GetTwoEightHedgeSetting(playGroupId)`；全庫搜尋
 * `abu/platform/src/pages` 找不到任何呼叫點，故本 tool 只放 aladdin-admin。
 *
 * === 【與同 domain 的兩個 sibling（GetTwoEightOddsSetting/GetTwoEightBetLimitSetting）不同，這支
 * 沒有 currency 查詢、沒有 null pointer 陷阱】===
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:1045-1065
 * methodGetTwoEightHedgeSetting）：呼叫 `getPlayGroupSetting()`（同檔 1272-1288，查無資料時回
 * `ServiceResult.fromData(null)`，成功、不驗證 playGroupId 存在）；`loadResult.data == null` 時**直接在
 * 記憶體建構** `TwoEightHedgeSetting.create({ playGroupId, maxItems: 10 })`（DEFAULT_MAX_ITEMS=10）
 * ——**沒有像 sibling 那樣接著呼叫 `getPlayGroupCurrency()`**，整支 method 完全不查
 * `in_house_game_play_groups`/`in_house_game_vendors` 表，也就沒有那個 null pointer 例外的觸發路徑。
 * 已用 dev 實測驗證（見下方）：不存在的 playGroupId 也會得到 RPC 成功的預設值回應，這次是真的「靜默回
 * 預設值」，不是陷阱。呼叫端同樣無法單靠這支 method 判斷 playGroupId 是否真的存在。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 1 節「讀取單筆」的變體（Get or generate default）。無跨租戶風險——底層
 * `in_house_game_settings` 表不綁 platformId。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_two_eight_hedge_setting` tool：
 *   - `playGroupId=1`（get_in_house_play_group_list 實測的「加拿大28-1.8」）：回傳
 *     `{playGroupId:1, maxItems:10}`，`groups` 欄位未出現在序列化回應中（空陣列被 protobuf JSON
 *     省略，語意上等同空陣列——這個玩法組尚未設定過對沖分組）。
 *   - `playGroupId=999999999`（不存在）：**回傳 success:true**，`{playGroupId:999999999, maxItems:10}`
 *     （DEFAULT_MAX_ITEMS 預設值），同樣沒有 `groups` 欄位——與原始碼分析吻合，這支 method 對不存在的
 *     playGroupId 真的是靜默生成預設值，不像 sibling 會拋例外。
 * 純讀取，不寫入 DB。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetTwoEightHedgeSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_two_eight_hedge_setting',
        {
            title: 'Get Two-Eight (二八槓) hedge (對沖) setting for a play group',
            description:
                '取得指定玩法組（playGroupId）的二八槓對沖策略設定（rajah: InHouseGameBackOffice.' +
                'GetTwoEightHedgeSetting），含 maxItems（每局最多可下注玩法數，預設 10）與 groups' +
                '（對沖分組，每組是一組 betItem id 清單）。' +
                '【重要陷阱，已 dev 實測驗證，與同 domain 的 get_two_eight_odds_setting/' +
                'get_two_eight_bet_limit_setting 不同】這支 method 不查詢玩法組所屬廠商幣別，因此' +
                '**沒有那兩支 sibling tool 遇到的 null pointer 例外**——傳入不存在的 playGroupId 一樣會' +
                '得到 RPC 成功的回應（maxItems=10 的預設值），不會報錯，本 tool 同樣無法單靠這支 method' +
                '判斷 playGroupId 是否真的存在，若需要確認合法性請先用 ' +
                'aladdin_admin_in_house_game_back_office_get_play_group_list 或 ' +
                'get_play_group_edit 查證。無需任何權限節點，任何已登入本後台的使用者皆可查詢。' +
                '純讀取，不寫入 DB。',
            inputSchema: {
                playGroupId: z.number().int().describe('自研遊戲玩法組 id，來自 aladdin_admin_in_house_game_back_office_get_play_group_list 的回傳結果；傳入不存在的 id 不會報錯，會得到 maxItems=10 的預設對沖設定'),
            },
        },
        async ({ playGroupId }) => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetTwoEightHedgeSetting(playGroupId));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, twoEightHedgeSetting: r.data?.twoEightHedgeSetting ?? null });
        },
    );
}
