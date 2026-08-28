/**
 * tools/get_goal_sprint_total_award_and_miles.ts — aladdin_platform_world_cup_platform_get_goal_sprint_total_award_and_miles
 *
 * rajah: WorldCupPlatform.GetGoalSprintTotalAwardAndMiles(search GoalSprintRecordSearch 1)
 * (totalAwardAndMiles TotalAwardAndMiles 1)（rajah/services/world_cup_back_office.rajah:432；
 * GoalSprintRecordSearch 同檔 234-261、TotalAwardAndMiles 同檔 403-408）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（world_cup_back_office.rajah 全檔
 * 沒有任何 Placeholder method）；service WorldCupPlatform 沒有 @NoPublic（同檔 410-441 的
 * `# @Permission "WorldCup"` 是被註解掉的 @Permission，不是 @NoPublic）；agrabah 後端確實有 override、
 * 非 base class 的 notImplemented——agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:181-184
 * methodGetGoalSprintTotalAwardAndMiles，委派共用的
 * agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:365-436 getTotalAwardAndMilesBase
 * （傳入 DbWorldCupGoalSprintRecord.tableName）。
 *
 * 分類（method-category-checklist.md 第 1 節「讀取單筆」）：回傳單一 TotalAwardAndMiles struct（非 rows 陣列），
 * 是同一組搜尋條件下的 SQL 聚合值，不套第 2 節的分頁/翻頁規則。
 * 第 1 節要求的「查無資料的實際行為」已查證：SUM() 沒有符合列時回 NULL，後端用 `Number(row.totalAward) || 0`
 * （db:432-433）轉成 0，**不回錯誤、也不回 null**——totalAward=0 因此無法區分「合計真的是 0」與
 * 「一筆都沒有」（2026-08-28 dev 實測：activityId=9 沒有任何進球衝刺戰紀錄時確實回 0 且 success=true）。
 *
 * **與 aladdin_platform_world_cup_platform_get_milestone_total_award_and_miles 的差異**：兩支後端共用
 * 同一個 getTotalAwardAndMilesBase，只差傳入的 tableName 與 search 型別。base 用
 * `'luckyTeams' in search`（db:393）與 `'activityMissionType' in search`（db:401）做欄位分流——
 * GoalSprintRecordSearch 這個 model 本身**沒有 luckyTeams 欄位**（rajah 234-261），所以走進來的一定是
 * activityMissionType 那條分支。本 tool 的 inputSchema 因此有 activityMissionType、沒有 luckyTeams，
 * 與里程那支正好相反，不是漏寫。
 *
 * 與 get_goal_sprint_record.ts 成對使用：兩者的 WHERE 條件由同一組欄位構成，帶相同篩選條件才會是
 * 那份列表的合計。
 *
 * 跨租戶：SQL 條件寫死 `platform_id = ? AND activity_id = ?`，platform_id 取自 context.platformId（db:379-380）。
 *
 * 敏感資料（第 8 節）：回傳只有兩個聚合數字，無個資或密鑰。
 *
 * 2026-08-28 dev 實測踩到並修正的一個真 bug：totalAward 在 rajah 是 i64，protobufjs 解出來在非 0 時
 * 是 Long 物件（{low, high, unsigned}），沒有轉換就會把這個內部表示原樣吐給 agent。已改為經 const.ts 的
 * deepFixLongs 轉成一般數字。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GoalSprintRecordSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    deepFixLongs,
    WORLD_CUP_ACTIVITY_MISSION_TYPE_KEYS,
    WORLD_CUP_ACTIVITY_MISSION_TYPE_MAP,
    WORLD_CUP_ACTIVITY_TYPE_KEYS,
    WORLD_CUP_ACTIVITY_TYPE_MAP,
} from '../const.ts';

export function registerGetGoalSprintTotalAwardAndMilesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_goal_sprint_total_award_and_miles',
        {
            title: 'Get total award and miles of world cup goal sprint records under the same filters',
            description:
                '取世界盃「進球衝刺戰」紀錄在指定篩選條件下的**總派獎金與總里程**' +
                '（rajah: WorldCupPlatform.GetGoalSprintTotalAwardAndMiles，world_cup_back_office.rajah:432）。' +
                '**本 service 目前沒有權限節點把關**——rajah 上的 `@Permission "WorldCup"` 整段被註解掉，' +
                '只要登入平台後台即可呼叫。' +
                '\n\n' +
                '**與 aladdin_platform_world_cup_platform_get_goal_sprint_record 成對使用**：後端兩支的 WHERE 條件' +
                '由同一組欄位構成，要拿到「那份列表的合計」，這裡帶的篩選條件必須跟列表 tool **完全一致**。' +
                '本 tool 沒有 page/pageSize——它算的是全部符合條件的列的 SQL SUM，不受分頁影響。' +
                '\n\n' +
                '**注意不要跟任務集里程那支混用**：本 tool 的篩選條件有 activityMissionType、**沒有** luckyTeams；' +
                'aladdin_platform_world_cup_platform_get_milestone_total_award_and_miles 反過來。這是後端兩個 ' +
                'search model 定義本身的差異，不是本工具漏帶欄位。' +
                '\n\n' +
                '**activityId 必填**：後端在 activityId 沒帶或 <= 0 時直接回 invalidData 錯誤，' +
                '因此本 tool 的 schema 已設為必填且 >= 1。合法值請先呼叫 ' +
                'aladdin_platform_world_cup_platform_get_world_cup_info_list 取得。' +
                '查詢一律限定當前登入平台，帶別平台的 activityId 會得到 0。' +
                '\n\n' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:365-436）：' +
                '除了時間區間以外的篩選條件全部是 SQL `=` 精確比對，沒有 LIKE 模糊查詢；' +
                'startTime / endTime 例外，是 created_at 的 >= / <= 區間比較。' +
                '**沒有任何符合的紀錄時回 0，不是錯誤也不是 null**（SQL SUM 回 NULL，後端轉成 0），' +
                '所以 totalAward=0 無法區分「合計真的是 0」與「一筆都沒有」——要區分請改看列表 tool 的筆數。' +
                '\n\n' +
                '數值語意：totalAward 是 SUM(award)，rajah @Type "Currency" 的後端 stored 整數' +
                '（依幣別精度縮放，常見 ×10000）；totalMiles 是 SUM(miles)，一般整數不縮放。' +
                '已知精度限制：後端用 JavaScript Number 轉換 SQL 的 SUM 結果（db:432-433），' +
                '合計超過 2^53（≈9.007e15）時會有精度損失——以常見 ×10000 縮放換算，約當顯示金額 9007 億以上才會踩到。純讀取查詢，不修改任何資料，可安全重複呼叫。',
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
                activityType: z.enum(WORLD_CUP_ACTIVITY_TYPE_KEYS).optional().describe(
                    '任務分類（rajah 上標 @Hide 但 API 仍支援）：miles=累積里程進球/invite=邀請好友/' +
                    'signIn=每日簽到/goal=進球數里程/oneTime=一次任務/knockout=淘汰賽任務',
                ),
                activityMissionType: z.enum(WORLD_CUP_ACTIVITY_MISSION_TYPE_KEYS).optional().describe(
                    '活動任務（達成條件種類）：accrueMiles=累積里程/inviteAndDeposit=邀請好友並首存/' +
                    'dayDepositAndBetCount=當日累計存款金額或有效投注/daySportBet=當日體育累計有效投注/' +
                    'dayDeposit=當日累計存款金額/dayBetCount=當日累計有效投注/goal=累計進球/' +
                    'accrueDeposit=活動期間累計存款金額/accrueBet=活動期間累計有效投注',
                ),
                startTime: z.number().int().optional().describe('領獎時間區間起（毫秒 epoch），比對 created_at >= 此值；0 或不帶代表不篩'),
                endTime: z.number().int().optional().describe('領獎時間區間迄（毫秒 epoch），比對 created_at <= 此值；0 或不帶代表不篩'),
            },
        },
        async ({ activityId, orderNo, memberId, memberName, vipLevelId, levelId, activityType, activityMissionType, startTime, endTime }) => {
            const search = GoalSprintRecordSearch.create({
                activityId,
                orderNo: orderNo ?? '',
                memberId: memberId ?? 0,
                memberName: memberName ?? '',
                vipLevelId: vipLevelId ?? 0,
                levelId: levelId ?? 0,
                activityType: activityType ? WORLD_CUP_ACTIVITY_TYPE_MAP[ activityType ] : 0,
                activityMissionType: activityMissionType ? WORLD_CUP_ACTIVITY_MISSION_TYPE_MAP[ activityMissionType ] : 0,
                startTime: startTime ?? 0,
                endTime: endTime ?? 0,
            });
            const r = await withAutoRelogin(
                () => remote.sportBackOffice.worldCupPlatform.GetGoalSprintTotalAwardAndMiles(search),
            );
            if (r.failed) return asErrorResult(r);
            const totals = r.data?.totalAwardAndMiles ?? null;
            // totalAward 是 i64：protobufjs 在非 0 時給的是 Long 物件（{low, high, unsigned}），
            // 直接吐出去 agent 讀不懂，必須轉成一般數字（2026-08-28 dev 實測踩到，見檔頭）。
            // totalMiles 是 i32，本來就是數字，不需轉。
            return asTextResult({
                success: true,
                totalAward: deepFixLongs(totals?.totalAward ?? 0),
                totalMiles: totals?.totalMiles ?? 0,
                note: '0 可能代表「合計為 0」也可能代表「沒有任何符合條件的紀錄」，後端不區分；需要區分請改用 aladdin_platform_world_cup_platform_get_goal_sprint_record 看筆數',
            });
        },
    );
}
