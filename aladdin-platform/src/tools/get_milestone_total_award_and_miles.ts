/**
 * tools/get_milestone_total_award_and_miles.ts — aladdin_platform_world_cup_platform_get_milestone_total_award_and_miles
 *
 * rajah: WorldCupPlatform.GetMilestoneTotalAwardAndMiles(search MilestoneRecordSearch 1)
 * (totalAwardAndMiles TotalAwardAndMiles 1)（rajah/services/world_cup_back_office.rajah:426；
 * MilestoneRecordSearch 同檔 203-230、TotalAwardAndMiles 同檔 403-408）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder；service WorldCupPlatform 沒有
 * @NoPublic（world_cup_back_office.rajah:410-411 只有一行被註解掉的 `# @Permission "WorldCup"`）；
 * agrabah 後端確實有 override、非 base class 的 notImplemented——
 * agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:162-165
 * methodGetMilestoneTotalAwardAndMiles，委派共用的
 * agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:365-436 getTotalAwardAndMilesBase
 * （傳入 DbWorldCupMilestoneRecord.tableName）。
 *
 * 分類（method-category-checklist.md 第 1 節「讀取單筆」）：回傳單一 TotalAwardAndMiles struct（非 rows 陣列），
 * 是同一組搜尋條件下的 SQL 聚合值，不是清單，所以不套第 2 節的分頁/翻頁規則。
 * 第 1 節要求的「查無資料的實際行為」已從原始碼查證：SUM() 在沒有符合列時回 NULL，後端用
 * `Number(row.totalAward) || 0`（db:432-433）轉成 0，**不會回錯誤、也不會回 null**——
 * 因此 totalAward=0 無法區分「真的是 0」與「沒有任何符合的紀錄」，要區分請搭配
 * aladdin_platform_world_cup_platform_get_milestone_record 看筆數。
 *
 * 這支與 get_milestone_record 是**成對**使用的：後端兩者的 WHERE 條件由同一組欄位組成
 * （db:379-414 對照 db:152-206），description 因此要求呼叫端兩邊帶完全相同的篩選條件，否則
 * 總額會對不上列表。
 *
 * 跨租戶：SQL 條件寫死 `platform_id = ? AND activity_id = ?`，platform_id 取自 context.platformId（db:379-380）。
 *
 * 敏感資料（第 8 節）：回傳只有兩個聚合數字，無任何個資或密鑰。輸入含 memberName/memberId 作為篩選條件，
 * 但那是呼叫端自己提供的查詢鍵，非本 tool 對外吐出的資料。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MilestoneRecordSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    deepFixLongs,
    WORLD_CUP_ACTIVITY_TYPE_KEYS,
    WORLD_CUP_ACTIVITY_TYPE_MAP,
    WORLD_CUP_LUCKY_TEAMS_KEYS,
    WORLD_CUP_LUCKY_TEAMS_MAP,
} from '../const.ts';

export function registerGetMilestoneTotalAwardAndMilesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_milestone_total_award_and_miles',
        {
            title: 'Get total award and miles of world cup milestone records under the same filters',
            description:
                '取世界盃「任務集里程」紀錄在指定篩選條件下的**總派獎金與總里程**' +
                '（rajah: WorldCupPlatform.GetMilestoneTotalAwardAndMiles，world_cup_back_office.rajah:426）。' +
                '**本 service 目前沒有權限節點把關**——rajah 上的 `@Permission "WorldCup"` 整段被註解掉，' +
                '只要登入平台後台即可呼叫。' +
                '\n\n' +
                '**與 aladdin_platform_world_cup_platform_get_milestone_record 成對使用**：後端兩支的 WHERE 條件' +
                '由同一組欄位構成，所以要拿到「這份列表的合計」，這裡帶的篩選條件必須跟那支列表 tool ' +
                '**完全一致**（少帶或多帶任何一個條件，總額就不再是那份列表的合計）。' +
                '本 tool 沒有 page/pageSize——它算的是全部符合條件的列的 SQL SUM，不受分頁影響。' +
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
                activityType: z.enum(WORLD_CUP_ACTIVITY_TYPE_KEYS).optional().describe(
                    '任務分類（rajah 上標 @Hide 但 API 仍支援）：miles=累積里程進球/invite=邀請好友/' +
                    'signIn=每日簽到/goal=進球數里程/oneTime=一次任務/knockout=淘汰賽任務',
                ),
                luckyTeams: z.enum(WORLD_CUP_LUCKY_TEAMS_KEYS).optional().describe(
                    '幸運國家加成：isLuckyTeams=是、notLuckyTeams=否；不帶則不篩此條件',
                ),
                startTime: z.number().int().optional().describe('領獎時間區間起（毫秒 epoch），比對 created_at >= 此值；0 或不帶代表不篩'),
                endTime: z.number().int().optional().describe('領獎時間區間迄（毫秒 epoch），比對 created_at <= 此值；0 或不帶代表不篩'),
            },
        },
        async ({ activityId, orderNo, memberId, memberName, vipLevelId, levelId, activityType, luckyTeams, startTime, endTime }) => {
            const search = MilestoneRecordSearch.create({
                activityId,
                orderNo: orderNo ?? '',
                memberId: memberId ?? 0,
                memberName: memberName ?? '',
                vipLevelId: vipLevelId ?? 0,
                levelId: levelId ?? 0,
                activityType: activityType ? WORLD_CUP_ACTIVITY_TYPE_MAP[ activityType ] : 0,
                luckyTeams: luckyTeams ? WORLD_CUP_LUCKY_TEAMS_MAP[ luckyTeams ] : 0,
                startTime: startTime ?? 0,
                endTime: endTime ?? 0,
            });
            const r = await withAutoRelogin(
                () => remote.sportBackOffice.worldCupPlatform.GetMilestoneTotalAwardAndMiles(search),
            );
            if (r.failed) return asErrorResult(r);
            const totals = r.data?.totalAwardAndMiles ?? null;
            // totalAward 是 i64：protobufjs 在非 0 時給的是 Long 物件（{low, high, unsigned}），
            // 必須經 deepFixLongs 轉成一般數字才吐給 agent。totalMiles 是 i32，本來就是數字。
            return asTextResult({
                success: true,
                totalAward: deepFixLongs(totals?.totalAward ?? 0),
                totalMiles: totals?.totalMiles ?? 0,
                note: '0 可能代表「合計為 0」也可能代表「沒有任何符合條件的紀錄」，後端不區分；需要區分請改用 aladdin_platform_world_cup_platform_get_milestone_record 看筆數',
            });
        },
    );
}
