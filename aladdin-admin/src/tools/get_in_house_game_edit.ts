/**
 * tools/get_in_house_game_edit.ts — aladdin_admin_in_house_game_back_office_get_game_edit
 *
 * rajah: InHouseGameBackOffice.GetGameEdit（in_house_game_back_office.rajah:277）：
 * `method GetGameEdit(gameId i32 1) (gameEdit InHouseGameEdit 1)`。service 標頭只有 `@LoginRequired`、
 * method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268 註解）。
 * `InHouseGameEdit`（in_house_game_back_office.rajah:25-43）欄位：`gameType`/`gameCode`/`name`/`remark`/
 * `basicSetting`(BasicSetting → TwoEightBasicSetting)/`gameConfig`(GameConfig → [FetcherConfig{type,
 * apiConfig{apiUrl,duration},enabled}])，全部欄位皆無 `@Hide`；`apiUrl` 的敏感性評估見下方 dev 實測段落
 * （不是無腦斷言無敏感資料）。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/GameEditPopup.vue:106`
 * `api.remote.inHouseGameBackOffice.main.GetGameEdit(gameId)`（編輯彈窗載入現值用）；全庫搜尋
 * `abu/platform/src/pages` 找不到任何呼叫點，故本 tool 只放 aladdin-admin。
 *
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:362-398
 * methodGetGameEdit）：`loadObject(DbInHouseGame, 'id = ?', [gameId])`（底層表 `in_house_game_frameworks`，
 * 非 `in_house_game`——這個表名在同 domain 其他 tool 檔頭已修正過同樣的錯誤），**找不到時明確回
 * `ErrorCode.objectNotFound`**（非空物件、非靜默成功），已用 dev 實測驗證（見下方）。
 * `basicSetting`/`gameConfig` 是從獨立的 setting 表（`in_house_game_settings`／`InHouseGameManager.getSetting`）
 * 讀出來的巢狀設定，可能為 `null`（該遊戲尚未設定過對應分類的 setting）。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 1 節「讀取單筆（Get by id，回傳單一 model）」。無 `@Optional` 標記，id 不存在的行為必須實測
 * （已測，回 `objectNotFound` errorCode）。無跨租戶風險——`in_house_game_frameworks`/`in_house_game_settings`
 * 兩張表皆繼承 `WithTimestamp`（非 `WithPlatformAndTimestamp`），不綁 platformId/agentId，本來就是全域
 * 可見的企劃設定資料，無「別平台資料外洩」的疑慮。非 `*ForEdit` 系列命名但功能等價（供編輯頁載入現值），已逐欄核對回傳欄位皆非
 * 內部隱藏欄位。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_game_edit` tool：
 *   - `gameId=1`（get_game_list 實測的「加拿大 28」）：成功回傳 gameEdit，gameCode="CND28"、
 *     name="加拿大 28"、basicSetting.twoEight 有完整的開盤/封盤時間設定（drawInterval=210000 等）、
 *     gameConfig.fetcherConfigs 有一筆三方開獎結果來源設定（type=1/apiConfig.apiUrl/duration/enabled）。
 *   - `gameId=999999999`（不存在）：回傳 `errorCode=14`（genie base `ErrorCode.objectNotFound`，
 *     `genie/src/common/error_code.ts:16`；非 `AgrabahErrorCodeEnum` 自訂碼，所以 `asErrorResult` 的
 *     反查 `errorName` 顯示「(未知錯誤碼)」是預期行為，不是本 tool 的錯誤），非靜默空物件、非 RPC
 *     層級例外，驗證與原始碼判讀一致。
 *
 * **apiUrl 敏感性評估（獨立 review 要求補測，不能只斷言無 @Hide 就跳過）**：dev 實測看到的真實值是
 * `https://loktar-api.ljbprod.site/loktar-portal/inner-api/canada28/draw/result`——三方廠商（loktar）的
 * 外部開獎結果查詢端點，**URL 本身（含 path）沒有 query string、沒有內嵌 token/key/密碼**，`inner-api`
 * 只是三方自己的路徑命名，不是本平台的內網位址。比對 method-category-checklist.md 第 8 節「回傳值
 * 本身是密鑰的」「輸入/輸出含明文密碼/token」等條件，此欄位不符合任何一條，不需要遮罩。但這是真實的
 * 三方營運端點設定，**與 GameEditPopup.vue 頁面本身一樣，沒有任何權限節點保護**（service 只掛
 * `@LoginRequired`），任何登入 admin 後台的帳號原本就看得到——本 tool 沒有擴大既有的暴露面，只是把
 * 同一份資料以另一個管道（MCP/agent 對話）呈現，這點在 description 已如實說明「不綁 platformId」。
 * 純讀取、無副作用，符合分類判定。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetInHouseGameEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_game_edit',
        {
            title: 'Get in-house (自研) game edit detail by id',
            description:
                '取得單一自研（in-house）遊戲的完整可編輯詳情（rajah: InHouseGameBackOffice.GetGameEdit），' +
                '含 gameType/gameCode/name/remark、二八槓開盤設定（basicSetting.twoEight：drawInterval/' +
                'advanceOpenTime/advanceCloseTime/maxPredictDuration/maintenanceStartTime/maintenanceEndTime）、' +
                '以及開獎結果來源設定（gameConfig.fetcherConfigs：type/apiConfig.apiUrl/apiConfig.duration/' +
                'enabled，可能為 null）。apiUrl 是真實的三方開獎查詢端點（2026-08-25 dev 實測未見內嵌' +
                'token/密碼），但這份資料本身跟後台頁面一樣無任何權限節點保護，任何已登入本後台的使用者' +
                '皆可查詢，本 tool 不擴大既有暴露面。gameId 找不到時回傳 errorCode=14（objectNotFound），' +
                '不是靜默空物件。這是全平台共用的企劃設定資料（不綁 platformId）。id 來源：' +
                'aladdin_admin_in_house_game_back_office_get_game_list 的回傳結果。純讀取、無副作用。',
            inputSchema: {
                gameId: z.number().int().describe('自研遊戲 id，來自 aladdin_admin_in_house_game_back_office_get_game_list 的回傳結果'),
            },
        },
        async ({ gameId }) => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetGameEdit(gameId));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, gameEdit: r.data?.gameEdit ?? null });
        },
    );
}
