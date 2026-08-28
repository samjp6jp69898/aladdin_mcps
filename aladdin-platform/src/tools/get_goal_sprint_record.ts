/**
 * tools/get_goal_sprint_record.ts — aladdin_platform_world_cup_platform_get_goal_sprint_record
 *
 * rajah: WorldCupPlatform.GetGoalSprintRecord(search GoalSprintRecordSearch 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [GoalSprintRecord] 1, totalPage i32 2, totalRow i32 3)
 * （rajah/services/world_cup_back_office.rajah:429；GoalSprintRecordSearch 定義同檔 234-261、
 * GoalSprintRecord 同檔 304-336；MissionCondition 在 rajah/services/world_cup_common.rajah:362-378）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder；service WorldCupPlatform 沒有
 * @NoPublic（world_cup_back_office.rajah:410-411 只有一行被註解掉的 `# @Permission "WorldCup"`）；
 * agrabah 後端確實有 override、非 base class 的 notImplemented——
 * agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:142-145 methodGetGoalSprintRecord，
 * 委派 agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:257-361 getWorldCupGoalSprintRecord。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：**A 級**——search struct 內有可鎖定單一目標的
 * orderNo（訂單編號，精確比對）與 memberId/memberName。依 A 級要求，zod schema 對照 rajah
 * `model GoalSprintRecordSearch` **全部 10 個欄位**列出，**包含 @Hide 欄位** activityId 與 activityType
 * （@Hide 只代表後台表單不顯示，API 仍支援；activityId 更是後端強制必填，db:264-268 沒帶或 <= 0 直接回 invalidData）。
 *
 * 與 get_milestone_record.ts 的差異（兩支 search model 長得很像，容易混淆，這裡寫明）：
 * 本 method 的 search **有 activityMissionType、沒有 luckyTeams**；milestone 那支反過來。
 * 這不是筆誤——後端 getTotalAwardAndMilesBase（db:393-404）就是用 `'luckyTeams' in search` /
 * `'activityMissionType' in search` 做型別分流的。
 *
 * 分頁陷阱：本 method 有 totalPage/totalRow，但 agrabah 共用的 getPageData
 * （agrabah/src/common/database_helper.ts:204-230）**只在 page === 1 時**才 count 並計算
 * totalPage/totalRow，page >= 2 一律回 0（2026-08-28 已在 dev 用 audit log tool 實測驗證此共用行為）。
 *
 * 跨租戶：SQL 條件寫死 `platform_id = ? AND activity_id = ?`，platform_id 取自 context.platformId（db:271-272）。
 *
 * 敏感資料（第 8 節）：回傳含 memberId / memberName。memberName 是**會員登入帳號**、不是 realName，
 * 也不是銀行卡號/開戶姓名，不在第 8 節要求遮罩的真實個資範圍；本 server 既有的會員相關查詢 tool
 * （如 list_point_transactions.ts）同樣原樣回傳帳號，這裡保持一致。無密鑰/token 欄位。
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
    PAGE_SIZE_KEYS,
    PAGE_SIZE_MAP,
    WORLD_CUP_ACTIVITY_MISSION_TYPE_KEYS,
    WORLD_CUP_ACTIVITY_MISSION_TYPE_MAP,
    WORLD_CUP_ACTIVITY_TYPE_KEYS,
    WORLD_CUP_ACTIVITY_TYPE_MAP,
} from '../const.ts';

export function registerGetGoalSprintRecordTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_goal_sprint_record',
        {
            title: 'Query world cup goal sprint (進球衝刺戰) award records',
            description:
                '分頁查詢世界盃「進球衝刺戰」的領獎紀錄（rajah: WorldCupPlatform.GetGoalSprintRecord，' +
                'world_cup_back_office.rajah:429）。**本 service 目前沒有權限節點把關**——rajah 上的 ' +
                '`@Permission "WorldCup"` 整段被註解掉，只要登入平台後台即可呼叫。' +
                '\n\n' +
                '**activityId 必填**：後端在 activityId 沒帶或 <= 0 時直接回 invalidData 錯誤（不是回空陣列），' +
                '因此本 tool 的 schema 已設為必填且 >= 1——少帶會先被參數驗證擋下、不會打到後端。' +
                '合法的正整數但不存在或屬於別平台則是另一回事：那會正常回 success 加空陣列，不是錯誤。' +
                '合法值請先呼叫 aladdin_platform_world_cup_platform_get_world_cup_info_list 取得。' +
                '\n\n' +
                '**與任務集里程那支的篩選條件不同，不要混用**：本 tool 有 activityMissionType（活動任務種類）' +
                '但**沒有** luckyTeams；aladdin_platform_world_cup_platform_get_milestone_record 反過來' +
                '（有 luckyTeams、沒有 activityMissionType）。這是後端 model 定義本身的差異。' +
                '\n\n' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:257-361）：' +
                '**除了時間區間以外的篩選條件全部是精確比對（SQL `=`），沒有任何 LIKE 模糊查詢**——' +
                'orderNo / memberName 打錯一個字就查不到；startTime / endTime 例外，是 created_at 的 >= / <= 區間比較。' +
                '（agrabah 該 service 的註解宣稱走「模糊搜尋」，與實際程式碼不符，以程式碼為準。）' +
                '排序固定 created_at DESC（最新的在最前面）。查詢一律限定當前登入平台。' +
                '\n\n' +
                '**分頁陷阱（務必遵守）**：totalPage / totalRow **只有在 page=1 的回應裡才是真值**，' +
                'page>=2 的回應一律回 0（後端共用的 getPageData 只在第一頁才做 count，' +
                'agrabah/src/common/database_helper.ts:204-217；2026-08-28 用同一台 dev 的 ' +
                'aladdin_platform_audit_platform_get_audit_logs 實測驗證過這個共用行為：page=1 回 totalPage=2611，' +
                'page=2 同樣回滿 10 筆資料但 totalPage=0）。要翻頁請先用 page=1 拿到 totalPage 後照它翻，' +
                '或以「回傳筆數 < pageSize」判定最後一頁；**不要**拿 page>=2 回應裡的 totalPage=0 當作「沒有資料了」。' +
                '\n\n' +
                '金額欄位語意：award 是 rajah @Type "Currency" 的後端 stored 整數（依幣別精度縮放，常見 ×10000），' +
                'audit 是 @Type "Rate" 的稽核倍數 ×10000 整數（例如 30000 代表 3 倍）；miles 是里程數，一般整數不縮放。' +
                'missionTarget / missionAchievement 是 MissionCondition 結構（mileage 里程、deposit 存款、' +
                'bet 投注、member 人數、goals 進球數），分別是這筆任務的目標值與實際達成值，' +
                '其中 deposit / bet 同樣是 Currency stored 整數。' +
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
                activityMissionType: z.enum(WORLD_CUP_ACTIVITY_MISSION_TYPE_KEYS).optional().describe(
                    '活動任務（達成條件種類）：accrueMiles=累積里程/inviteAndDeposit=邀請好友並首存/' +
                    'dayDepositAndBetCount=當日累計存款金額或有效投注/daySportBet=當日體育累計有效投注/' +
                    'dayDeposit=當日累計存款金額/dayBetCount=當日累計有效投注/goal=累計進球/' +
                    'accrueDeposit=活動期間累計存款金額/accrueBet=活動期間累計有效投注',
                ),
                startTime: z.number().int().optional().describe('領獎時間區間起（毫秒 epoch），比對 created_at >= 此值；0 或不帶代表不篩'),
                endTime: z.number().int().optional().describe('領獎時間區間迄（毫秒 epoch），比對 created_at <= 此值；0 或不帶代表不篩'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始；只有 page=1 的回應才帶真實的 totalPage/totalRow'),
                pageSize: z.enum(PAGE_SIZE_KEYS).optional().describe(
                    '每頁筆數，後端型別是 PageSizeEnum（固定選項，非任意數字）：' +
                    'serverDefault/size10/size20/size30/size50/size100/size200；' +
                    '省略或帶 serverDefault 時後端換成 DefaultPageSize=100',
                ),
            },
        },
        async ({ activityId, orderNo, memberId, memberName, vipLevelId, levelId, activityType, activityMissionType, startTime, endTime, page, pageSize }) => {
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
                () => remote.sportBackOffice.worldCupPlatform.GetGoalSprintRecord(search, page, pageSize ? PAGE_SIZE_MAP[ pageSize ] : 0),
            );
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                totalPage: r.data?.totalPage ?? 0,
                totalRow: r.data?.totalRow ?? 0,
                totalsOnlyValidOnFirstPage: page !== 1
                    ? 'page>=2 的回應不含真實 totalPage/totalRow（後端只在 page=1 做 count），此處的 0 不代表沒有資料'
                    : undefined,
            });
        },
    );
}
