/**
 * tools/update_in_house_play_group_status.ts — aladdin_admin_in_house_game_back_office_update_play_group_status
 *
 * rajah: InHouseGameBackOffice.UpdatePlayGroupStatus（in_house_game_back_office.rajah:286）：
 * `method UpdatePlayGroupStatus(playGroupId i32 1, status StatusEnum 2) ()`。service 標頭只有
 * `@LoginRequired`、method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268 註解）。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/GamePlayGroupList.vue:142`
 * `api.remote.inHouseGameBackOffice.main.UpdatePlayGroupStatus(playGroupId, status)`；全庫搜尋
 * `abu/platform/src/pages` 找不到任何呼叫點，故本 tool 只放 aladdin-admin。
 *
 * === 【重要前置條件，與 sibling UpdateVendorStatus 不同】啟用（status=enabled）前會檢查賠率與
 * 下注限額設定是否已完整設定，不完整會擋下 ===
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:1186-1220+
 * methodUpdatePlayGroupStatus）：`status === StatusEnum.enabled` 時，會先各查一次
 * `getPlayGroupSetting(GameSettingTypeEnum.Odds)` 與 `getPlayGroupSetting(GameSettingTypeEnum.Bet)`
 * （同檔 1272-1288，即 `get_two_eight_odds_setting.ts`/`get_two_eight_bet_limit_setting.ts` 底層用的
 * 同一支 helper），只要任一個查詢失敗或回傳 null（尚未設定過），直接回
 * `AgrabahErrorCodeEnum.settingsNotCompleted`（=1313），**完全不會執行到 `updateStatus`**——這是這支
 * method 特有的前置驗證，`UpdateVendorStatus` 沒有這一層檢查。status=disabled 則無此限制，任何玩法組
 * 都能直接停用。
 *
 * 沒有像 sibling `UpdateVendorStatus` 那樣的下游「連鎖寫入其他表」（玩法組是葉節點，底下沒有更細的
 * 實體會被這支 method 一併改狀態），但**「葉節點、無下游影響」不能簡化成「enable 沒有業務後果」**：
 * `InHouseGameManager.setPlayGroupCache`（`agrabah/src/managers/in_house_game_manager.ts:662-676`）在
 * `status=enabled` 時，若該玩法組所屬廠商與遊戲**也都是 enabled**，會把它寫進 Redis 的可用玩法組
 * cache（`TIMEOUT: 0` 永不過期，見同檔 :106-108 註解「won't self-heal」），這張 cache 是
 * `in_house_game_api`（前台 API，`active_play_groups_cache.ts:17` 讀取、`betting_handler.ts` 的
 * `checkPlayGroup` 拿來當下注/撤單放行依據）判斷「這個玩法組現在能不能讓玩家下注」的依據；機器人
 * 端則**不經過這張 cache**，`in_house_game_master` 的 `bot_dispatcher.ts:116` 是直接呼叫
 * `InHouseGameManager.getEnabledPlayGroups()` 查 DB（三表 JOIN 篩 vendor/game/play_group 皆
 * enabled）決定要不要對這個玩法組派注，下一局開始時就會生效。也就是說，對一個廠商與遊戲都已啟用的
 * 玩法組呼叫 `status=enabled`，效果是**立即讓玩家可下注、下一局起機器人也會開始下注**，不是單純的
 * 資料庫欄位切換。`status=disabled` 呼叫 `clearPlayGroupCache`（同檔 :657-660）移除同一個 key，
 * 玩家端效果對稱；機器人端下一次 `getEnabledPlayGroups` 查詢就會排除掉這個玩法組。
 *
 * `updateStatus`（`agrabah/src/common/database_helper.ts:24-49`）沿用同一套規則：status 非法值回
 * `errorCode=9`（invalidData，本 tool 的 zod schema 會先擋下，實務上不會真的觸發）；影響列數 0
 * （playGroupId 不存在）回 `errorCode=14`（objectNotFound）。
 *
 * **每次成功呼叫（enable 或 disable）都會寫入持久化操作日誌**（in_house_game_back_office.ts:1212-1222，
 * 依 status 分送 `AdminActionIdEnum.inHouseGamePlayGroupEnable`/`inHouseGamePlayGroupDisable`，經
 * `audit()` 落地成 AuditLog，含操作者/IP/`{id, gameName, status}`）——這是設計上刻意的稽核軌跡，
 * 不是「髒資料」，但代表**任何呼叫（含測試/來回復原）都會在稽核系統留下永久紀錄**，不會因為之後把
 * 狀態改回去就消失，呼叫前應納入考量（尤其自動化重試/探索性呼叫應避免對真實玩法組頻繁切換）。
 *
 * `InHouseGamePlayGroupEdit`（GetPlayGroupEdit 的回傳 model）**沒有 status 欄位**（同 sibling
 * GetVendorEdit 的情況），本 tool 寫入後改用 `GetPlayGroupList` 讀回驗證（這支讀回本身不受影響，但
 * 也會被計入正常的 RPC 呼叫，不會額外產生稽核紀錄——稽核只掛在 UpdatePlayGroupStatus 本身）。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 6 節「狀態轉換」：帶明確目標狀態參數，非批量。有前置驗證副作用（見上），description 已揭露。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * **【測試計畫有一項推翻，如實記錄，且原本用來補強推論的證據事後發現方法論無效，一併撤回】**
 * 原計畫選 playGroupId=2（名稱「未調整」的佔位玩法組）測試 settingsNotCompleted 路徑，預期它因為是
 * 佔位資料應該沒有設定過賠率/限額。實際呼叫 `status="enabled"` 卻**直接成功**（非預期）——這件事本身
 * 就是可靠證據：`methodUpdatePlayGroupStatus` 的前置檢查要求 odds 與 bet 兩者 `data !== null` 才會放行
 * （in_house_game_back_office.ts:1189-1198），enable 成功代表 **playGroupId=2 底層確實有這兩張設定的
 * DB 列**。**這次意外的 enable 呼叫已立即用同一支 tool 呼叫 `status="disabled"` 復原**，playGroupId=2
 * 最終狀態確認回到 disabled。
 *
 * 原本另外想用 `get_two_eight_odds_setting`/`get_two_eight_bet_limit_setting` 唯讀查詢 playGroupId=13/3
 * 「查得到資料」來佐證「25 個玩法組全部都有設定列」，**這個推論已撤回**：這兩支 GET method 在底層
 * DB 查無資料時會用 `generateInitTwoEightOddsSetting`/`generateInitTwoEightBetLimitSetting`
 * 在記憶體生成一份樣板值直接回傳成功（見 `get_two_eight_odds_setting.ts`/
 * `get_two_eight_bet_limit_setting.ts` 檔頭），**GET 查得到資料無法區分「真的有設定」與「DB 沒有列、
 * 回傳的是生成樣板」**，不能拿來當作「有設定列」的證據。因此：
 *   - 目前唯一確定「真的有設定列」的是 playGroupId=1、2；playGroupId=3/13 等其他玩法組是否有設定列
 *     **未經驗證**，不排除有玩法組真的能觸發 settingsNotCompleted，只是這次選到的測試對象剛好都有。
 *   - **settingsNotCompleted（errorCode=1313）本身的檢查邏輯**是讀原始碼確認存在（agrabah 原始碼
 *     :1189-1198，行號與條件已核對無誤），但這次 dev 測試沒有真的觸發過這個分支，如實標註為推論。
 *   - 呼叫端不能用玩法組顯示名稱（如「未調整」）猜測是否會觸發 settingsNotCompleted。
 * - **正常 round-trip**：playGroupId=1（「加拿大28-1.8」）原始狀態 disabled：`status="enabled"` 成功、
 *   round-trip 確認變成 enabled；`status="disabled"`（改回原值）成功、round-trip 確認恢復 disabled。
 * - `playGroupId=999999999`（不存在）：回傳 `errorCode=14`（objectNotFound）。
 * **業務狀態（DB 欄位）已完全復原**：playGroupId=1、2 最終狀態皆與測試前相同。**但稽核系統留有
 * 4 筆操作日誌**（playGroupId=1 的刻意 round-trip 2 筆 + playGroupId=2 意外 enable 又復原 2 筆）——
 * 這是本 method 每次成功呼叫都會寫的持久化紀錄（見上方說明），設計上就不會、也不應該被抹除，不算
 * 「留下髒資料」，但如實記錄以免誤讀成「完全沒有任何痕跡」。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { InHouseGamePlayGroupListSearch } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateInHousePlayGroupStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_update_play_group_status',
        {
            title: 'Update an in-house (自研) game play group status',
            description:
                '切換自研（in-house）遊戲玩法組的啟用/停用狀態（rajah: InHouseGameBackOffice.' +
                'UpdatePlayGroupStatus）。無需任何權限節點，任何已登入本後台的使用者皆可呼叫。' +
                '【重要前置條件，讀原始碼確認存在，但 dev 環境尚未實際觸發過】status="enabled" ' +
                '時，後端原始碼會先檢查這個玩法組是否已完整設定賠率（TwoEightOddsSetting）與下注限額' +
                '（TwoEightBetLimitSetting），任一項底層設定表完全沒有列會直接回 errorCode=1313' +
                '（settingsNotCompleted）、不寫入——這個檢查邏輯讀原始碼確認存在，但目前 dev 環境測過的' +
                '玩法組剛好都已有設定，沒有真的觸發過這個分支，不能保證所有玩法組都不會觸發。' +
                'status="disabled" 沒有這個前置檢查，任何玩法組都能直接停用。' +
                '【重要業務影響，不只是資料庫欄位切換】status="enabled" 若該玩法組所屬廠商與遊戲也都是' +
                'enabled，會立即讓它出現在 Redis 可用玩法組 cache（永不過期），立即開放前台玩家下注；' +
                '機器人端不經過這張 cache，是下一局才會透過查 DB 判定是否對它派注。status="disabled" ' +
                '立即移除 cache（玩家端立即停止），機器人端下一次查詢就會排除。每次成功呼叫（enable 或' +
                'disable）都會寫入持久化操作日誌，這是設計如此的稽核軌跡，不會因為之後改回去就消失。' +
                'GetPlayGroupEdit 沒有 status 欄位，本 tool 寫入後改用 GetPlayGroupList' +
                '讀回驗證。playGroupId 不存在回 errorCode=14（objectNotFound）；status 帶非法列舉值理論上回' +
                'errorCode=9（invalidData，本 tool 的 zod schema 會在送出前直接擋下，實務上不會真的觸發）。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境時，執行前必須先用 AskUserQuestion' +
                '（或功能相同方式）明確詢問使用者是否要在正式環境執行，取得同意後才可帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                playGroupId: z.number().int().describe('自研遊戲玩法組 id，來自 aladdin_admin_in_house_game_back_office_get_play_group_list 的回傳結果'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled；status="enabled" 會先檢查賠率與下注限額設定是否完整，不完整會回 errorCode=1313'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ playGroupId, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.UpdatePlayGroupStatus(playGroupId, STATUS_MAP[ status ]));
            if (r.failed) {
                return asErrorResult(r, r.errorCode === 1313
                    ? {
                        hint: `playGroupId=${ playGroupId } 尚未完整設定賠率（TwoEightOddsSetting）或下注限額（TwoEightBetLimitSetting）。可用 ` +
                            'aladdin_admin_in_house_game_back_office_get_two_eight_odds_setting/get_two_eight_bet_limit_setting（唯讀）查看目前的' +
                            '設定內容，但這兩支查不到「是否真的有設定列」（查無資料時會回一份生成的樣板值，不代表已設定）；要真正建立設定，' +
                            '需要呼叫 rajah InHouseGameBackOffice.UpdateTwoEightOddsSetting/UpdateTwoEightBetLimitSetting（in_house_game_back_office.rajah:295-296），' +
                            '目前這兩支 method 尚未包裝成 MCP tool，暫時只能請操作者到後台 UI（GamePlayGroupList.vue 的賠率/限額編輯彈窗）設定。',
                    }
                    : undefined);
            }

            const listResult = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetPlayGroupList(
                InHouseGamePlayGroupListSearch.fromObject({ vendorId: 0, status: 0, name: '' }), 1, 200,
            ));
            const matched = !listResult.failed ? listResult.data?.rows?.find((row) => row.id === playGroupId) : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (!listResult.failed ? { note: '讀回清單中沒找到這個 playGroupId，非預期，請人工確認', rows: listResult.data?.rows } : null),
            });
        },
    );
}
