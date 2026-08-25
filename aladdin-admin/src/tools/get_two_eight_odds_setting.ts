/**
 * tools/get_two_eight_odds_setting.ts — aladdin_admin_in_house_game_back_office_get_two_eight_odds_setting
 *
 * rajah: InHouseGameBackOffice.GetTwoEightOddsSetting（in_house_game_back_office.rajah:280）：
 * `method GetTwoEightOddsSetting(playGroupId i32 1) (twoEightOddsSetting TwoEightOddsSetting 1)`。
 * service 標頭只有 `@LoginRequired`、method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268
 * 註解）。`TwoEightOddsSetting`（**定義在 `rajah/services/in_house_game.rajah:246-256`，不是
 * `in_house_game_back_office.rajah`**——這個 model 是前台/後台共用，前台二八槓遊戲頁面也會用同一個
 * model 顯示賠率表）：`playGroupId`(@Readonly)/`currency`(@Readonly)/`odds`([TwoEightOdds])，
 * `TwoEightOdds`（in_house_game.rajah:259-268）：`betItem`/`resultCondition`/`threshold`(@Type Currency)/
 * `ltOdds`(@Type Rate)/`geOdds`(@Type Rate)。全部欄位皆無 `@Hide`。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/OddsEditPopup.vue:47`
 * `api.remote.inHouseGameBackOffice.main.GetTwoEightOddsSetting(playGroupId)`；全庫搜尋
 * `abu/platform/src/pages` 找不到任何呼叫點，故本 tool 只放 aladdin-admin。
 *
 * === 【重要，dev 實測發現真實的後端例外，與程式碼初步推論不同】playGroupId 不存在時會撞到後端
 * null pointer 例外，回傳 errorCode=1（unknown）===
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:680-700
 * methodGetTwoEightOddsSetting）流程：
 * 1. 呼叫 `getPlayGroupSetting()`（同檔 1272-1288，查 `in_house_game_settings` 表，用 playGroupId 當
 *    targetId）——這支 helper 完全不驗證 playGroupId 本身是否存在，查無 setting row 時回
 *    `ServiceResult.fromData(null)`（成功、非錯誤）。
 * 2. `loadResult.data == null` 時呼叫 `generateInitTwoEightOddsSetting(playGroupId)`
 *    （同檔 1341 起）**在記憶體中生成一份完整的預設賠率表**，不查資料庫確認 playGroupId 是否真的存在。
 * 3. **接著呼叫 `getPlayGroupCurrency(context, playGroupId)`（同檔 1228-1243）**：SQL 對
 *    `in_house_game_play_groups INNER JOIN in_house_game_vendors WHERE pg.id = ?` 用 `queryOne`。
 *    playGroupId 不存在時 INNER JOIN 查無任何列，`queryOne` 回 `ServiceResult.fromData(null)`
 *    （`result.failed` 是 **false**，`result.data` 是 **null**）。但 `getPlayGroupCurrency` 只判斷了
 *    `result.failed`（:1238-1240 回空字串），**沒有判斷 `result.data === null` 的情況**，直接執行
 *    `return result.data.currency_code`（:1242）——**對 `null` 取屬性會拋出 TypeError**，被上層框架
 *    捕捉轉成 `ErrorCode.unknown`（=1，`genie/src/common/error_code.ts:3`）。
 *
 * **結論（已用 dev 實測驗證，見下方）**：這是一個真實存在的後端邊界 bug——第 1、2 步的「不報錯、生成
 * 預設值」設計意圖，被第 3 步 `getPlayGroupCurrency` 沒判斷 `data === null` 的疏漏打斷，最終效果是
 * **playGroupId 不存在時，這支 method 反而會回傳一個語意不明的 `errorCode=1`（unknown）**，不是乾淨的
 * `objectNotFound`、也不是原本設計想做的「靜默回預設值」。本 tool 忠實呈現這個錯誤（`asErrorResult`），
 * 不試圖在 MCP 層猜測或掩蓋，但在 description 明確標註這是已知的後端行為，避免呼叫端誤以為是本 tool
 * 或網路問題。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 1 節「讀取單筆」的變體（Get or generate default）。「id 不存在的實際行為」已用 dev 實測釐清為
 * `errorCode=1`（非預期中的 objectNotFound，也非原始碼粗讀時以為的靜默成功）。無跨租戶風險——底層
 * `in_house_game_settings`/`in_house_game_play_groups`/`in_house_game_vendors` 皆不綁 platformId。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_two_eight_odds_setting` tool：
 *   - `playGroupId=1`（get_in_house_play_group_list 實測的「加拿大28-1.8」，真的有設定過賠率）：
 *     回傳 `{playGroupId:1, currency:"CNY", odds:[...多筆真實賠率資料...]}`，欄位齊全。
 *   - `playGroupId=999999999`（不存在）：回傳 `{success:false, errorCode:1, errorName:"(未知錯誤碼)"}`，
 *     與上方原始碼分析完全吻合——**不是靜默成功，是後端 null pointer 例外被轉成 unknown 錯誤**，
 *     推翻了原先讀程式碼時「應該會不報錯、生成預設值」的初步推論。
 * 純讀取、無寫入 DB 的副作用（但會觸發後端未處理的例外）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetTwoEightOddsSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_two_eight_odds_setting',
        {
            title: 'Get Two-Eight (二八槓) odds setting for a play group',
            description:
                '取得指定玩法組（playGroupId）的二八槓賠率設定（rajah: InHouseGameBackOffice.' +
                'GetTwoEightOddsSetting），含 currency（該玩法組所屬廠商幣別）與 odds（各 betItem/' +
                'resultCondition 組合的 threshold/ltOdds/geOdds 賠率明細）。odds[].threshold（@Type ' +
                '"Currency"）回傳的是 stored 值（依幣別 decimalPlaces 放大過的整數，非顯示金額），' +
                'ltOdds/geOdds（@Type "Rate"）同樣是放大過的整數倍率，皆不要直接當成使用者看到的數字使用。' +
                '【重要陷阱，已 dev 實測驗證】若傳入不存在的 playGroupId，後端會因為內部 null pointer' +
                '例外回傳 errorCode=1（unknown）——這是已知的後端邊界 bug（getPlayGroupCurrency 沒判斷' +
                '查無資料的情況），不是本 tool 或網路問題；請先用 ' +
                'aladdin_admin_in_house_game_back_office_get_play_group_list 或 ' +
                'aladdin_admin_in_house_game_back_office_get_play_group_edit 確認 playGroupId 存在再呼叫' +
                '這支。若該 playGroupId 存在但尚未設定過賠率，後端會正常生成一份初始值為 0 的預設賠率表' +
                '（不報錯）。無需任何權限節點，任何已登入本後台的使用者皆可查詢。純讀取，不寫入 DB。',
            inputSchema: {
                playGroupId: z.number().int().describe('自研遊戲玩法組 id，來自 aladdin_admin_in_house_game_back_office_get_play_group_list 的回傳結果；傳入不存在的 id 會回 errorCode=1（已知後端邊界 bug），不是正常的找不到錯誤碼'),
            },
        },
        async ({ playGroupId }) => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetTwoEightOddsSetting(playGroupId));
            if (r.failed) {
                return asErrorResult(r, r.errorCode === 1
                    ? { hint: `playGroupId=${ playGroupId } 很可能不存在，或其關聯的廠商列已不存在（理論情境，目前全庫無刪除 vendor 的程式路徑）——errorCode=1(unknown) 是已知的後端邊界 bug（getPlayGroupCurrency 對查無資料的情況拋出未處理例外），建議先用 get_play_group_list/get_play_group_edit 確認此 id 是否存在` }
                    : undefined);
            }
            return asTextResult({ success: true, twoEightOddsSetting: r.data?.twoEightOddsSetting ?? null });
        },
    );
}
