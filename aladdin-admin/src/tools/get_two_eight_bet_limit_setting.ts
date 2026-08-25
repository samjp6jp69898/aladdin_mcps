/**
 * tools/get_two_eight_bet_limit_setting.ts — aladdin_admin_in_house_game_back_office_get_two_eight_bet_limit_setting
 *
 * rajah: InHouseGameBackOffice.GetTwoEightBetLimitSetting（in_house_game_back_office.rajah:281）：
 * `method GetTwoEightBetLimitSetting(playGroupId i32 1) (twoEightBetLimitSetting TwoEightBetLimitSetting 1)`。
 * service 標頭只有 `@LoginRequired`、method 本身無 `@Permission`。`TwoEightBetLimitSetting`
 * （in_house_game_back_office.rajah:172-203，這次**定義在 back_office 檔案本身**，跟 sibling
 * `TwoEightOddsSetting` 定義在 `in_house_game.rajah` 不同，每支都要各自核對，不能假設同一套規律）：
 * `playGroupId`(@Readonly)/`currency`(@Readonly)/`maxItems`/`maxTotalAmount`(@Type Currency)/
 * `maxItemDefaultAmount`(@Type Currency)/`roundTotalAmount`(@Type Currency)/
 * `roundItemDefaultAmount`(@Type Currency)/`itemLimit`([ItemLimit]，betItem/maxAmount/roundMaxAmount，
 * 見同檔 158-168）。全部欄位皆無 `@Hide`。`itemLimit[].betItem` 的數值分兩個不連續區間（in_house_game_
 * back_office.rajah:722 註解證實）：0~27 是「數字下注」牌面編碼、101~116 是「feature 下注」
 * （對應 `TwoEightBetItemFeatureEnum`，rajah/services/in_house_game.rajah:102-127），2026-08-25 dev
 * 實測回傳的 44 筆（28+16）正好對應這兩組區間的完整值域，不是資料異常。金額欄位（maxTotalAmount 等 +
 * itemLimit 內的 maxAmount/roundMaxAmount）皆為 stored 值（依幣別 decimalPlaces 放大過），見下方
 * description 提醒。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/BetLimitSettingEditPopup.vue:46`
 * `api.remote.inHouseGameBackOffice.main.GetTwoEightBetLimitSetting(playGroupId)`；全庫搜尋
 * `abu/platform/src/pages` 找不到任何呼叫點，故本 tool 只放 aladdin-admin。
 *
 * === 【與 sibling GetTwoEightOddsSetting 完全相同的後端陷阱】playGroupId 不存在時會撞到 null pointer
 * 例外，回傳 errorCode=1（unknown）===
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:715-735
 * methodGetTwoEightBetLimitSetting）與 `methodGetTwoEightOddsSetting`（同檔 680-700）是**逐行同構**的
 * 程式碼：`getPlayGroupSetting()` 查無設定時用 `generateInitTwoEightBetLimitSetting(playGroupId)` 生成
 * 記憶體預設值（不驗證 playGroupId 存在），接著無條件呼叫 :730 `settingValue.currency =
 * await getPlayGroupCurrency(context, playGroupId)`——這支 helper（同檔 1228-1243）已在
 * `get_two_eight_odds_setting.ts` 檔頭詳細記錄過：對 `queryOne` 查無資料（`result.data === null`，
 * `result.failed` 是 false）沒有防呆，直接 `result.data.currency_code` 拋 TypeError，被
 * `agrabah/src/common/server.ts:223-228` 的外層 catch 轉成 `ErrorCode.unknown`（=1）。這支 method
 * 呼叫的是**同一支** `getPlayGroupCurrency`，理當有一模一樣的行為——已用 dev 實測驗證確實如此
 * （見下方），不是憑「兩支程式碼長得像」就假設一定一樣。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 1 節「讀取單筆」的變體（Get or generate default），與 GetTwoEightOddsSetting 同分類、同陷阱。
 * 無跨租戶風險——底層表皆不綁 platformId。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_two_eight_bet_limit_setting` tool：
 *   - `playGroupId=1`（get_in_house_play_group_list 實測的「加拿大28-1.8」）：回傳
 *     twoEightBetLimitSetting，currency="CNY"、maxItems/maxTotalAmount/itemLimit 等欄位齊全。
 *   - `playGroupId=999999999`（不存在）：回傳 `errorCode=1`（unknown），與 GetTwoEightOddsSetting
 *     的實測結果一致，證實兩支 method 共用的 `getPlayGroupCurrency` 陷阱行為相同。
 * 純讀取，不寫入 DB（但會觸發後端未處理的例外）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetTwoEightBetLimitSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_two_eight_bet_limit_setting',
        {
            title: 'Get Two-Eight (二八槓) bet limit setting for a play group',
            description:
                '取得指定玩法組（playGroupId）的二八槓下注限額設定（rajah: InHouseGameBackOffice.' +
                'GetTwoEightBetLimitSetting），含 currency、maxItems（每局最多可下注玩法數）、' +
                'maxTotalAmount/maxItemDefaultAmount/roundTotalAmount/roundItemDefaultAmount（各級距' +
                '下注上限）、itemLimit（單一玩法的個別上限覆寫，含 maxAmount/roundMaxAmount）。' +
                '【金額欄位注意】maxTotalAmount 等（@Type "Currency"）與 itemLimit 內的 maxAmount/' +
                'roundMaxAmount 回傳的都是 stored 值（依幣別 decimalPlaces 放大過的整數，i64 以字串' +
                '形式序列化，如 "2000000000"），**不是**使用者在後台介面上看到的顯示金額，不要直接把' +
                '這個數字當成顯示金額使用或呈現給人看，需先確認該幣別的 decimalPlaces 換算比例。' +
                '【重要陷阱，已 dev 實測驗證，與 aladdin_admin_in_house_game_back_office_' +
                'get_two_eight_odds_setting 共用同一個後端 helper、同一種陷阱】若傳入不存在的' +
                'playGroupId，後端會因為內部 null pointer 例外回傳 errorCode=1（unknown），不是乾淨的' +
                'objectNotFound。請先用 aladdin_admin_in_house_game_back_office_get_play_group_list 或 ' +
                'get_play_group_edit 確認 playGroupId 存在再呼叫這支。若該 playGroupId 存在但尚未設定過' +
                '限額，後端會正常生成一份預設限額表（不報錯）。無需任何權限節點，任何已登入本後台的' +
                '使用者皆可查詢。純讀取，不寫入 DB。',
            inputSchema: {
                playGroupId: z.number().int().describe('自研遊戲玩法組 id，來自 aladdin_admin_in_house_game_back_office_get_play_group_list 的回傳結果；傳入不存在的 id 會回 errorCode=1（已知後端邊界 bug），不是正常的找不到錯誤碼'),
            },
        },
        async ({ playGroupId }) => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetTwoEightBetLimitSetting(playGroupId));
            if (r.failed) {
                return asErrorResult(r, r.errorCode === 1
                    ? { hint: `playGroupId=${ playGroupId } 很可能不存在，或其關聯的廠商列已不存在（理論情境）——errorCode=1(unknown) 是已知的後端邊界 bug（getPlayGroupCurrency 對查無資料的情況拋出未處理例外），建議先用 get_play_group_list/get_play_group_edit 確認此 id 是否存在` }
                    : undefined);
            }
            return asTextResult({ success: true, twoEightBetLimitSetting: r.data?.twoEightBetLimitSetting ?? null });
        },
    );
}
