/**
 * tools/get_world_cup_knockout_total_award.ts — aladdin_platform_world_cup_platform_get_world_cup_knockout_total_award
 *
 * rajah: WorldCupPlatform.GetWorldCupKnockoutTotalAward(knockoutRecordSearch KnockoutRecordSearch 1)
 * (totalAward i64 1)（rajah/services/world_cup_back_office.rajah:438；KnockoutRecordSearch 同檔 340-364）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（world_cup_back_office.rajah 全檔
 * 沒有任何 Placeholder method）；service WorldCupPlatform 沒有 @NoPublic（同檔 410-441 的
 * `# @Permission "WorldCup"` 是被註解掉的 @Permission）；agrabah 後端確實有 override、非 base class 的
 * notImplemented——agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:223-226
 * methodGetWorldCupKnockoutTotalAward，委派
 * agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:539-616 GetWorldCupKnockoutTotalAward
 * （注意這支 helper 的函式名首字母大寫，與同檔其他 helper 命名風格不同，grep 時容易漏）。
 *
 * 分類（method-category-checklist.md 第 1 節「讀取單筆」）：回傳單一 i64 聚合值（非 rows 陣列），
 * 不套第 2 節的分頁/翻頁規則。第 1 節要求的「查無資料的實際行為」已查證：SUM() 沒有符合列時回 NULL，
 * 後端用 `Number(row.totalAward) || 0`（db:613）轉成 0，**不回錯誤、也不回 null**，因此 totalAward=0
 * 無法區分「合計真的是 0」與「一筆都沒有」（2026-08-28 dev 實測確認回 0 且 success=true）。
 *
 * **回傳形狀與里程/衝刺戰的總額 tool 不同**：那兩支回 TotalAwardAndMiles（totalAward + totalMiles），
 * 本支**只有 totalAward、沒有 totalMiles**——晉級爭冠賽沒有累計里程的概念，
 * 後端 SQL 也真的只 SELECT SUM(award)（db:596-601），不是本 tool 漏帶。
 *
 * 與 get_world_cup_knockout_records.ts 成對使用：兩者的 WHERE 條件由同一組欄位構成
 * （db:548-591 對照 db:458-501），帶相同篩選條件才會是那份列表的合計。
 *
 * i64 處理：totalAward 是 i64，protobufjs 在非 0 時解出來是 Long 物件（{low, high, unsigned}），
 * 必須經 const.ts 的 deepFixLongs 轉成一般數字才吐給 agent——2026-08-28 在姐妹 tool
 * get_goal_sprint_total_award_and_miles 上實際踩到過這個坑（少了這層轉換就把 Long 內部表示原樣吐出），
 * 本檔一開始就接上。deepFixLongs 對「單一 Long 物件」輸入會直接回 toNumber() 的結果
 * （const.ts:416-421 的第一個分支），已用 Long.fromString('123456789012345') 本機實測驗證。
 *
 * 跨租戶：SQL 條件寫死 `platform_id = ? AND activity_id = ?`，platform_id 取自 context.platformId（db:546-547）。
 *
 * 敏感資料（第 8 節）：回傳只有一個聚合數字，無個資或密鑰。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { KnockoutRecordSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    deepFixLongs,
    WORLD_CUP_KNOCKOUT_CONDITION_KEYS,
    WORLD_CUP_KNOCKOUT_CONDITION_MAP,
} from '../const.ts';

export function registerGetWorldCupKnockoutTotalAwardTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_world_cup_knockout_total_award',
        {
            title: 'Get total award of world cup knockout records under the same filters',
            description:
                '取世界盃「晉級爭冠賽」紀錄在指定篩選條件下的**總派獎金**' +
                '（rajah: WorldCupPlatform.GetWorldCupKnockoutTotalAward，world_cup_back_office.rajah:438）。' +
                '**本 service 目前沒有權限節點把關**——rajah 上的 `@Permission "WorldCup"` 整段被註解掉，' +
                '只要登入平台後台即可呼叫。' +
                '\n\n' +
                '**只回 totalAward，沒有 totalMiles**：晉級爭冠賽沒有累計里程的概念，後端 SQL 真的只 ' +
                'SELECT SUM(award)。這一點與 aladdin_platform_world_cup_platform_get_milestone_total_award_and_miles / ' +
                'aladdin_platform_world_cup_platform_get_goal_sprint_total_award_and_miles 不同（那兩支回 award + miles）。' +
                '\n\n' +
                '**與 aladdin_platform_world_cup_platform_get_world_cup_knockout_records 成對使用**：後端兩支的 ' +
                'WHERE 條件由同一組欄位構成，要拿到「那份列表的合計」，這裡帶的篩選條件必須跟列表 tool **完全一致**。' +
                '本 tool 沒有 page/pageSize——算的是全部符合條件的列的 SQL SUM，不受分頁影響。' +
                '\n\n' +
                '**activityId 必填**：後端在 activityId 沒帶或 <= 0 時直接回 invalidData 錯誤，' +
                '因此本 tool 的 schema 已設為必填且 >= 1。合法值請先呼叫 ' +
                'aladdin_platform_world_cup_platform_get_world_cup_info_list 取得。' +
                '查詢一律限定當前登入平台，帶別平台的 activityId 會得到 0。' +
                '\n\n' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:539-616）：' +
                '除了時間區間以外的篩選條件全部是 SQL `=` 精確比對，沒有 LIKE 模糊查詢；' +
                'startTime / endTime 例外，是 created_at 的 >= / <= 區間比較。' +
                '**沒有任何符合的紀錄時回 0，不是錯誤也不是 null**（SQL SUM 回 NULL，後端轉成 0），' +
                '所以 totalAward=0 無法區分「合計為 0」與「一筆都沒有」——要區分請改看列表 tool 的筆數。' +
                '\n\n' +
                '數值語意：totalAward 是 SUM(award)，rajah @Type "Currency" 的後端 stored 整數' +
                '（依幣別精度縮放，常見 ×10000）。已知精度限制：後端用 JavaScript Number 轉換 SQL 的 SUM 結果，' +
                '合計超過 2^53（≈9.007e15）時會有精度損失——以常見 ×10000 縮放換算，約當顯示金額 9007 億以上才會踩到。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                activityId: z.number().int().min(1).describe(
                    '世界盃活動 id（必填，rajah 上標 @Hide 但 API 強制要求）；' +
                    '來自 aladdin_platform_world_cup_platform_get_world_cup_info_list 的回傳 id',
                ),
                orderNo: z.string().optional().describe('訂單編號，精確比對（不是模糊查詢）'),
                memberId: z.number().int().min(1).optional().describe('會員 id，精確比對'),
                memberName: z.string().optional().describe('會員登入帳號，精確比對（不是模糊查詢）'),
                vipLevelId: z.number().int().min(1).optional().describe('VIP 等級 id，精確比對'),
                levelId: z.number().int().min(1).optional().describe('會員層級 id，精確比對（對應 DB 的 member_level_id）'),
                knockoutCondition: z.enum(WORLD_CUP_KNOCKOUT_CONDITION_KEYS).optional().describe(
                    '隊伍晉級條件：firstPlace=獲得第一名/secondPlace=第二名/thirdPlace=第三名/fourthPlace=第四名/' +
                    'reachTopFour=進四強/reachTopEight=進八強/reachTopSixTeen=進十六強',
                ),
                startTime: z.number().int().optional().describe('領獎時間區間起（毫秒 epoch），比對 created_at >= 此值；0 或不帶代表不篩'),
                endTime: z.number().int().optional().describe('領獎時間區間迄（毫秒 epoch），比對 created_at <= 此值；0 或不帶代表不篩'),
            },
        },
        async ({ activityId, orderNo, memberId, memberName, vipLevelId, levelId, knockoutCondition, startTime, endTime }) => {
            const search = KnockoutRecordSearch.create({
                activityId,
                orderNo: orderNo ?? '',
                memberId: memberId ?? 0,
                memberName: memberName ?? '',
                vipLevelId: vipLevelId ?? 0,
                levelId: levelId ?? 0,
                knockoutCondition: knockoutCondition ? WORLD_CUP_KNOCKOUT_CONDITION_MAP[ knockoutCondition ] : 0,
                startTime: startTime ?? 0,
                endTime: endTime ?? 0,
            });
            const r = await withAutoRelogin(
                () => remote.sportBackOffice.worldCupPlatform.GetWorldCupKnockoutTotalAward(search),
            );
            if (r.failed) return asErrorResult(r);
            // totalAward 是 i64：protobufjs 在非 0 時給 Long 物件，必須轉成一般數字。
            return asTextResult({
                success: true,
                totalAward: deepFixLongs(r.data?.totalAward ?? 0),
                note: '0 可能代表「合計為 0」也可能代表「沒有任何符合條件的紀錄」，後端不區分；'
                    + '需要區分請改用 aladdin_platform_world_cup_platform_get_world_cup_knockout_records 看筆數。'
                    + '本 method 沒有 totalMiles（晉級爭冠賽無里程概念）',
            });
        },
    );
}
