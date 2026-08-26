/**
 * tools/get_in_house_play_group_edit.ts — aladdin_admin_in_house_game_back_office_get_play_group_edit
 *
 * rajah: InHouseGameBackOffice.GetPlayGroupEdit（in_house_game_back_office.rajah:279）：
 * `method GetPlayGroupEdit(playGroupId i32 1) (playGroupEdit InHouseGamePlayGroupEdit 1)`。
 * service 標頭只有 `@LoginRequired`、method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268
 * 註解）。`InHouseGamePlayGroupEdit`（in_house_game_back_office.rajah:115-131）欄位：`id`(@Readonly)/
 * `currencyCode`(@NoEdit)/`vendorId`(@NoEdit)/`name`/`remark`/`ruleContent`([LocalizationString] 富文本
 * 規則說明)/`oddsGroupKey`（賠率組別 enum，rajah 註解特別提醒「修改本欄位會即時改變歷史賠率報表的分組
 * 結果，不影響金額總和只影響歸屬」——這是寫入方法的風險提示，本 tool 是唯讀 Get，不受影響，但供未來
 * 寫這支 method 的 Update 版本時參考）。全部欄位皆無 `@Hide`。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/GamePlayGroupEditPopup.vue:60`
 * `api.remote.inHouseGameBackOffice.main.GetPlayGroupEdit(playGroupId)`；全庫搜尋 `abu/platform/src/pages`
 * 找不到任何呼叫點，故本 tool 只放 aladdin-admin。
 *
 * === 【重要，已 dev 實測推翻最初的原始碼推論】playGroupId 不存在時是「靜默回空」，不是報錯 ===
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:448-478
 * methodGetPlayGroupEdit）不是走 GetGameEdit/GetVendorEdit 的 `loadObject` + `objectNotFound` 模式，而是：
 * ```
 * const result = await context.relationalDatabase.queryOne(sql, [playGroupId]);
 * if (result.failed || !result.data) {
 *     return result.errorToGenie();
 * }
 * ```
 * `queryOne`（mysql_relational_database_engine.ts:66-74）查無資料時回 `ServiceResult.fromData(null)`——
 * `errorCode` 是 `success`（0）。`errorToGenie()`（genie/src/client/index.ts:79-81）不論 errorCode 是否
 * 為 success，一律包成 `GenieResult.error(this.errorCode, this.message)`，也就是這裡實際呼叫的是
 * `GenieResult.error(0, '')`。**原本讀原始碼推論「client 端仍會判定為失敗」是錯的**——genie client 的
 * `ServiceResult.failed` getter（genie/src/client/index.ts:45-47）是 `ErrorCode.isError(this.errorCode)`，
 * `errorCode=0` 一律判定為**不是**錯誤。2026-08-25 dev 實測（見下方）證實：`playGroupId=999999999`
 * 時 RPC 回傳 `success: true`，`response.playGroupEdit` 從未被賦值（因為早退在賦值那行之前），genie
 * client 端反序列化出來就是 `undefined`／`null`——**這是 method-category-checklist.md 第 1 節「id 不存在
 * 的實際行為」三種可能之一：靜默回空值 struct，不是回錯誤碼、也不是拋例外**。本 tool 的 handler 因此
 * **不能只看 `r.failed`**，必須額外判斷 `playGroupEdit` 是否為 null 才能正確告知呼叫端「找不到」。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 1 節「讀取單筆（Get by id，回傳單一 model）」。id 不存在的行為已如上實測釐清（RPC 層級成功，
 * playGroupEdit 為 null——三種可能行為裡最危險的一種，因為天真的呼叫端會以為「RPC 沒報錯」就當作
 * 找到了）。無跨租戶風險——`in_house_game_play_groups`/`in_house_game_vendors` 皆繼承 `WithTimestamp`，
 * 不綁 platformId/agentId。`ruleContent` 富文本欄位同 GetVendorEdit 的富文本欄位模式
 * （`queryLongByIdWithoutError`，`LocalizationServiceIdEnum.inHouseGameRuleContent` 專屬 service id
 * 圈定範圍），是遊戲規則說明文案，前台會顯示給玩家看，非敏感資料。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_play_group_edit` tool：
 *   - `playGroupId=1`（get_in_house_play_group_list 實測的「加拿大28-1.8」）：成功回傳 playGroupEdit，
 *     id/currencyCode/vendorId/name/oddsGroupKey 齊全，ruleContent 有一筆 zh-CN 空字串（該玩法組尚未
 *     填寫規則說明內容，但語系列本身存在）。
 *   - `playGroupId=999999999`（不存在）：底層 RPC 回傳 `success: true`（`r.failed === false`）、
 *     `playGroupEdit` 未定義——與上方原始碼分析完全吻合，證實這是後端的真實邊界行為。本 tool 的
 *     handler 已針對這個情境額外判斷，改回傳 `success: false` + 明確的 `notFound` 提示給呼叫端，
 *     不會把後端這個「假成功」原樣透傳造成呼叫端誤判。
 * 純讀取、無副作用，符合分類判定。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetInHousePlayGroupEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_play_group_edit',
        {
            title: 'Get in-house (自研) play group edit detail by id',
            description:
                '取得單一自研（in-house）遊戲玩法組的完整可編輯詳情（rajah: InHouseGameBackOffice.' +
                'GetPlayGroupEdit），含 id/currencyCode/vendorId/name/remark/oddsGroupKey，以及 ruleContent' +
                '（多語富文本規則說明，前台展示文案，可能為空字串）。' +
                '【重要陷阱，已 dev 實測驗證】playGroupId 不存在時，後端 RPC 本身回傳成功（不是業務錯誤碼），' +
                '只是 playGroupEdit 為空——本 tool 已在內部額外判斷這個情境，回傳結構化的 ' +
                '`{ success: false, notFound: true }` 明確告知呼叫端「找不到」，不會把後端這個容易誤判的' +
                '「假成功」原樣透傳。無需任何權限節點，任何已登入本後台的使用者皆可查詢。id 來源：' +
                'aladdin_admin_in_house_game_back_office_get_play_group_list 的回傳結果。純讀取、無副作用。',
            inputSchema: {
                playGroupId: z.number().int().describe('自研遊戲玩法組 id，來自 aladdin_admin_in_house_game_back_office_get_play_group_list 的回傳結果'),
            },
        },
        async ({ playGroupId }) => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetPlayGroupEdit(playGroupId));
            if (r.failed) return asErrorResult(r);
            const playGroupEdit = r.data?.playGroupEdit ?? null;
            if (playGroupEdit === null) {
                // 精確地說是「查無資料」：後端 SQL 對 in_house_game_play_groups 與 in_house_game_vendors
                // 做 INNER JOIN（無 FK 約束），playGroupId 不存在、或其關聯的 vendor 列已不存在（目前
                // 全庫沒有任何刪除 vendor 的程式路徑，只有人工 DB 操作才可能造成，理論存在但實務未見）
                // 都會落到這個分支，不只是「id 不存在」單一原因。
                return asTextResult({
                    success: false,
                    notFound: true,
                    message: `playGroupId=${ playGroupId } 查無資料（id 不存在，或其關聯的廠商列已不存在）。` +
                        '後端對此情境回傳 RPC 成功但無資料（已知後端邊界行為），本 tool 已在此攔截並轉換為' +
                        '明確的找不到訊號。',
                });
            }
            return asTextResult({ success: true, playGroupEdit });
        },
    );
}
