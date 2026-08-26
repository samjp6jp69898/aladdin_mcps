/**
 * tools/resolve_in_house_play_group_game_ids.ts —
 * aladdin_platform_game_vendor_platform_get_game_ids_by_in_house_play_group_ids
 *
 * rajah: GameVendorPlatform.GetGameIdsByInHousePlayGroupIds（game_back_office.rajah:1068，
 * service GameVendorPlatform 區塊：game_back_office.rajah:1050 起）。
 *
 * 簽名：`GetGameIdsByInHousePlayGroupIds(playGroupIds [i32] 1) (links [InHousePlayGroupGameLink] 1)`，
 * `InHousePlayGroupGameLink { playGroupId i32 1, gameVendorGameId i32 2, brandId i32 3 }`
 * （game_back_office.rajah:1026-1030）。方法本身、service 標頭都沒有 `@Permission`
 * （service 標頭上一行 `# @Permission "GameVendor"` 是被註解掉的殘留，不生效），也沒有 `@NoPublic`——
 * 任何登入本平台後台的使用者皆可呼叫。
 *
 * 用途：把 in-house（自研遊戲）的 playGroupId（如即時注單 `RealtimeBetRecord.gameVendorGameId`
 * 欄位註解所述，見 in_house_game_back_office.rajah:458）批次回推成 `game_vendor_games.id`
 * （gameVendorGameId，可作為其他 tool 的遊戲識別碼）與 brandId（依當下平台的顯示標籤/廠商品牌
 * 設定即時算出，同一 playGroupId 在不同平台可能得到不同 brandId）。
 *
 * agrabah 後端實作（agrabah/src/servers/game_back_office/services/game_vendor_platform.ts
 * methodGetGameIdsByInHousePlayGroupIds，約 2083 行起）：對 game_vendor_games JOIN
 * game_vendors 用 `gvg.game_id IN (?) AND gv.adapter = 'InHouse'` 查詢，是真的有後端邏輯的
 * override，不是 base class 預設的 notImplemented 佔位——已核對原始碼確認，不是 Placeholder
 * 方法（未以 `Placeholder` 開頭）。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 2 節「讀取清單/集合查詢」——回傳型別是陣列（links），但形狀貼近該節「Batch 開頭的查詢類」
 * 子類（雖然方法名不是 Batch 開頭，但語意等價：playGroupIds 陣列 → links 陣列，且無 page/pageSize，
 * 不是需要逐頁掃描的 B 級清單）。依該子類要求：
 *   - **不能假設回傳陣列與輸入 id 陣列同長度、同順序**——後端用 SQL `IN (?)` 查詢，查不到的
 *     playGroupId 不會出現在 `links` 裡（不是回傳某種佔位值），呼叫端必須用回傳資料裡的
 *     `playGroupId` 欄位重新比對，不能用 index 對應。本 tool 因此額外計算並回傳
 *     `unresolvedPlayGroupIds`（輸入陣列去重後，扣掉 `links` 裡出現過的 playGroupId），
 *     不讓呼叫端自己再做一次比對。
 *   - 空陣列輸入：後端有提早分支直接回傳 `links: []`（見上述實作第一行 `if (playGroupIds.length
 *     === 0) return []`），非錯誤。
 *
 * === 2026-08-25 dev 實測狀況（VPN 已恢復，已完成真實驗證）===
 * 依 abu/.claude/skills/test-method/SKILL.md 腳本範本，在 `abu/platform` 用
 * `credentials.platform.env`（API_URL=https://pk-platform.alddev.com）登入成功，直接呼叫
 * rajah method `remote.gameBackOffice.gameVendorPlatform.GetGameIdsByInHousePlayGroupIds`
 * （繞過尚未掛進 index.ts 的本 MCP tool，打底層 method 本身）。結果：
 *   - 範圍掃描 playGroupId 1~50：errorCode=0，回傳 22 筆 link（如
 *     `{playGroupId:1, gameVendorGameId:313, brandId:20}`），確認正常情況下真的有資料可查。
 *   - 混合情境 `[1(存在), 999999901(不存在)]`：links 只回傳 playGroupId=1 那筆，999999901
 *     完全不出現在回傳裡——**驗證了「查不到的 id 不會出現在 links，需用回傳 playGroupId 重新比對」
 *     這個判定是對的**，本 tool 的 `unresolvedPlayGroupIds` 計算方式（輸入去重後扣掉 links 裡出現過的
 *     playGroupId）與實際行為相符。
 *   - 全部不存在 `[999999901, 999999902]`：errorCode=0、links=[]，不是錯誤，符合分類判定。
 *   - 重複輸入 `[1, 1]`：links 只回傳 1 筆（不重複），SQL `IN (?)` 語意本就不會因輸入重複值而
 *     重複輸出同一列，本 tool 目前原樣透傳 links 的行為沒有問題。
 *   - brandId 在不同 playGroupId 間確實不同（測得 0 / 20 / 38 / 39），但**跨平台是否不同**這次
 *     用同一組帳密切換 `platform-code` header（0/1/2）測試結果三者相同——無法排除是帳號本身綁定
 *     單一 platformId、header 未真正切換平台所致，此結論仍不確定，未進一步深究（非本次驗證重點，
 *     不影響本 tool 的行為正確性，只影響「brandId 會隨平台變化」這句描述的精確度）。
 * 結論：本檔案原先依 rajah 定義 + agrabah 原始碼推導出的行為說明，已用真實 dev 呼叫核對一致，
 * 無需修正邏輯。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerResolveInHousePlayGroupGameIdsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_get_game_ids_by_in_house_play_group_ids',
        {
            title: 'Resolve in-house play group ids to game vendor game ids',
            description:
                '把 in-house（自研遊戲）的 playGroupId 批次回推成 game_vendor_games.id（gameVendorGameId，' +
                '可作為其他 tool 的遊戲識別碼）與 brandId（rajah: GameVendorPlatform.GetGameIdsByInHousePlayGroupIds，' +
                'game_back_office.rajah:1068）。常見用途：即時注單 / 歷史紀錄只存 playGroupId，需要這支方法轉出' +
                '對應的廠商遊戲 id 才能查詢遊戲名稱、圖示等顯示資訊。' +
                '無需任何權限節點，任何已登入本平台後台的使用者皆可呼叫。' +
                '重要限制：查不到的 playGroupId 不會出現在 rows 裡（後端用 SQL IN 子句查詢，不回傳佔位值），' +
                '本 tool 已在回傳的 unresolvedPlayGroupIds 標出這些 id，呼叫端不需要自己重新比對，但要注意' +
                '「查不到」的常見原因：該 playGroupId 對應的遊戲不是 in-house adapter（是三方廠商遊戲）、' +
                'playGroupId 本身不存在、或本平台尚未建立對應的 game_vendor_games 記錄。' +
                '2026-08-25 已於 dev（pk-platform.alddev.com）直接呼叫底層 rajah method 完成真實驗證：' +
                '存在/不存在混合輸入、全不存在、重複 id 輸入三種情境的實際回傳皆與上述行為說明一致。',
            inputSchema: {
                playGroupIds: z.array(z.number().int())
                    .min(1, '至少要帶一個 playGroupId')
                    .describe(
                        'in-house 遊戲的 playGroupId 陣列（即時注單/歷史紀錄中 gameVendorGameId 欄位的來源，' +
                        '見 RealtimeBetRecord model 註解）。查不到的 id 不會出現在回傳的 rows 裡，' +
                        '會列在 unresolvedPlayGroupIds。',
                    ),
            },
        },
        async ({ playGroupIds }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetGameIdsByInHousePlayGroupIds(playGroupIds));
            if (r.failed) return asErrorResult(r);

            const rows = r.data?.links ?? [];
            const resolvedIds = new Set(rows.map(link => link.playGroupId));
            const unresolvedPlayGroupIds = [ ...new Set(playGroupIds) ].filter(id => !resolvedIds.has(id));

            return asTextResult({ success: true, rows, unresolvedPlayGroupIds });
        },
    );
}
