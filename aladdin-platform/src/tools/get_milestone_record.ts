/**
 * tools/get_milestone_record.ts — aladdin_platform_world_cup_platform_get_milestone_record
 *
 * rajah: WorldCupPlatform.GetMilestoneRecord(search MilestoneRecordSearch 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [MilestoneRecord] 1, totalPage i32 2, totalRow i32 3)
 * （rajah/services/world_cup_back_office.rajah:423；MilestoneRecordSearch 定義同檔 203-230、
 * MilestoneRecord 同檔 265-300；MissionCondition 在 rajah/services/world_cup_common.rajah:362-378）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder；service WorldCupPlatform 沒有
 * @NoPublic（world_cup_back_office.rajah:410-411 只有一行被註解掉的 `# @Permission "WorldCup"`）；
 * agrabah 後端確實有 override、非 base class 的 notImplemented——
 * agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:120-123 methodGetMilestoneRecord，
 * 委派 agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:139-255 getWorldCupMilestoneRecord。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：**A 級**——search struct 內有可鎖定單一目標的
 * orderNo（訂單編號，精確比對）與 memberId/memberName，不是「只有範圍鍵 + 分頁」的 B 級高風險情境。
 * 依第 2 節 A 級要求，zod schema 對照 rajah `model MilestoneRecordSearch` **全部欄位**列出，
 * **包含 @Hide 欄位**：activityId 與 activityType 在 rajah 上標了 @Hide（後台表單不顯示），
 * 但 API 仍然吃這兩個欄位，且 activityId 更是後端強制必填（db:146-150 沒帶或 <= 0 直接回 invalidData），
 * 不列出來這支 tool 根本無法使用。
 *
 * 分頁陷阱（第 2 節「回傳沒有 totalPage/totalRow 的」相關，本例是另一種變形）：本 method 有 totalPage/totalRow，
 * 但 agrabah 共用的 getPageData（agrabah/src/common/database_helper.ts:204-230）**只在 page === 1 時**
 * 才去 count 並計算 totalPage/totalRow，page >= 2 一律回 0。呼叫端不能拿第 2 頁以後的 totalPage 當終止條件，
 * 詳見 description。
 *
 * 跨租戶：SQL 條件寫死 `platform_id = ? AND activity_id = ?` 且 platform_id 取自 context.platformId
 * （db:153-154），帶別平台的 activityId 撈不到資料。
 *
 * 敏感資料（第 8 節）：回傳含 memberId / memberName。memberName 是**會員登入帳號**、不是 realName，
 * 也不是銀行卡號/開戶姓名，不在第 8 節要求遮罩的真實個資範圍（該節點名的是 realName /
 * account / accountName / bankAccount）；本 server 既有的會員相關查詢 tool
 * （如 list_point_transactions.ts）同樣原樣回傳帳號，這裡保持一致不另外遮罩。
 * 回傳無密鑰/token/密碼欄位。
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
    PAGE_SIZE_KEYS,
    PAGE_SIZE_MAP,
    WORLD_CUP_ACTIVITY_TYPE_KEYS,
    WORLD_CUP_ACTIVITY_TYPE_MAP,
    WORLD_CUP_LUCKY_TEAMS_KEYS,
    WORLD_CUP_LUCKY_TEAMS_MAP,
} from '../const.ts';

export function registerGetMilestoneRecordTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_milestone_record',
        {
            title: 'Query world cup milestone (任務集里程) award records',
            description:
                '分頁查詢世界盃「任務集里程」的領獎紀錄（rajah: WorldCupPlatform.GetMilestoneRecord，' +
                'world_cup_back_office.rajah:423）。**本 service 目前沒有權限節點把關**——rajah 上的 ' +
                '`@Permission "WorldCup"` 整段被註解掉，只要登入平台後台即可呼叫。' +
                '\n\n' +
                '**activityId 必填**：後端在 activityId 沒帶或 <= 0 時直接回 invalidData 錯誤（不是回空陣列），' +
                '因此本 tool 的 schema 已把它設為必填且 >= 1——少帶會先被參數驗證擋下、不會打到後端。' +
                '注意「合法的正整數但不存在或屬於別平台」是另一回事：那會正常回 success 加空陣列，' +
                '不是錯誤（2026-08-28 dev 實測 activityId=99999 確認）。' +
                '合法值請先呼叫 aladdin_platform_world_cup_platform_get_world_cup_info_list 取得。' +
                '查詢一律限定在當前登入平台（SQL 條件為 platform_id = 當前平台 AND activity_id = ?），' +
                '帶別平台的 activityId 會查不到資料。' +
                '\n\n' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:139-255）：' +
                '**除了時間區間以外的篩選條件全部是精確比對（SQL `=`），沒有任何 LIKE 模糊查詢**——' +
                'orderNo / memberName 打錯一個字就查不到；startTime / endTime 例外，是 created_at 的 >= / <= 區間比較。' +
                '（agrabah 該 service 的註解宣稱走「模糊搜尋」，與實際程式碼不符，以程式碼為準。）' +
                '排序固定 created_at DESC（最新的在最前面）。' +
                '\n\n' +
                '**分頁陷阱（務必遵守）**：totalPage / totalRow **只有在 page=1 的回應裡才是真值**，' +
                'page>=2 的回應一律回 0（後端共用的 getPageData 只在第一頁才做 count，' +
                'agrabah/src/common/database_helper.ts:204-217；2026-08-28 用同一台 dev 的 ' +
                'aladdin_platform_audit_platform_get_audit_logs 實測驗證過這個共用行為：page=1 回 totalPage=2611，' +
                'page=2 同樣回滿 10 筆資料但 totalPage=0）。要翻頁請先用 page=1 拿到 totalPage 後照它翻，' +
                '或以「回傳筆數 < pageSize」判定最後一頁；**不要**拿 page>=2 回應裡的 totalPage=0 當作「沒有資料了」。' +
                '\n\n' +
                '金額欄位語意：award 是 rajah @Type "Currency" 的後端 stored 整數（依幣別精度縮放，常見 ×10000），' +
                'audit 是 @Type "Rate" 的稽核倍數 ×10000 整數（例如 30000 代表 3 倍）；' +
                'miles 是里程數，一般整數不縮放。missionTarget / missionAchievement 是 MissionCondition 結構' +
                '（mileage 里程、deposit 存款、bet 投注、member 人數、goals 進球數），' +
                '分別代表這筆任務的目標值與實際達成值，其中 deposit / bet 同樣是 Currency stored 整數。' +
                '\n\n' +
                'luckyTeams 是「幸運國家加成」：對外一律用 isLuckyTeams / notLuckyTeams（DB 底層存的是 0/1，' +
                '後端會轉換，呼叫端不要送 0/1）。純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                activityId: z.number().int().min(1).describe(
                    '世界盃活動 id（必填，rajah 上標 @Hide 但 API 強制要求）；' +
                    '來自 aladdin_platform_world_cup_platform_get_world_cup_info_list 的回傳 id。' +
                    '沒帶或 <= 0 後端回 invalidData 錯誤。',
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
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始；只有 page=1 的回應才帶真實的 totalPage/totalRow'),
                pageSize: z.enum(PAGE_SIZE_KEYS).optional().describe(
                    '每頁筆數，後端型別是 PageSizeEnum（固定選項，非任意數字）：' +
                    'serverDefault/size10/size20/size30/size50/size100/size200；' +
                    '省略或帶 serverDefault 時後端換成 DefaultPageSize=100',
                ),
            },
        },
        async ({ activityId, orderNo, memberId, memberName, vipLevelId, levelId, activityType, luckyTeams, startTime, endTime, page, pageSize }) => {
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
                () => remote.sportBackOffice.worldCupPlatform.GetMilestoneRecord(search, page, pageSize ? PAGE_SIZE_MAP[ pageSize ] : 0),
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
