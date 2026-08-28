/**
 * tools/get_world_cup_knockout_records.ts — aladdin_platform_world_cup_platform_get_world_cup_knockout_records
 *
 * rajah: WorldCupPlatform.GetWorldCupKnockoutRecords(knockoutRecordSearch KnockoutRecordSearch 1,
 * page i32 2, pageSize i32 3) (rows [KnockoutRecord] 1, totalPage i32 2, totalRow i32 3)
 * （rajah/services/world_cup_back_office.rajah:435；KnockoutRecordSearch 定義同檔 340-364、
 * KnockoutRecord 同檔 368-399；KnockoutConditionEnum 在 rajah/services/world_cup_common.rajah:66-81）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（world_cup_back_office.rajah 全檔
 * 沒有任何 Placeholder method）；service WorldCupPlatform 沒有 @NoPublic（同檔 410-441 的
 * `# @Permission "WorldCup"` 是被註解掉的 @Permission）；agrabah 後端確實有 override、非 base class 的
 * notImplemented——agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:203-206
 * methodGetWorldCupKnockoutRecords，委派
 * agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:438-537 getWorldCupKnockoutRecords。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：**A 級**——search struct 內有可鎖定單一目標的
 * orderNo 與 memberId/memberName。zod schema 對照 rajah `model KnockoutRecordSearch` 全部 9 個欄位列出，
 * 包含 @Hide 的 activityId（後端強制必填，db:444-448 沒帶或 <= 0 直接回 invalidData）。
 *
 * **pageSize 型別與姐妹 method 不同，這裡要特別小心**：本 method 的 pageSize 在 rajah 上是**裸 i32**
 * （world_cup_back_office.rajah:435），不是姐妹 method GetMilestoneRecord / GetGoalSprintRecord 用的
 * PageSizeEnum。後端只有一條 `pageSize === PageSizeEnum.serverDefault → DefaultPageSize`（db:504-506）的
 * 轉換，**沒有任何上界 clamp**，之後直接進 withPage 組 LIMIT（database_helper.ts:13-19）。
 * 依 method-category-checklist.md 第 2 節「若為裸 i32……不要賭一次塞極大 pageSize 取代翻頁」，
 * 本 tool 的 zod schema 把上限收在 200（與姐妹 method 的 PageSizeEnum 上限一致），不開放任意大值。
 *
 * 分頁陷阱：agrabah 共用的 getPageData（agrabah/src/common/database_helper.ts:204-230）**只在 page === 1 時**
 * 才 count 並計算 totalPage/totalRow，page >= 2 一律回 0（2026-08-28 已在 dev 用 audit log tool 實測驗證）。
 *
 * 跨租戶：SQL 條件寫死 `platform_id = ? AND activity_id = ?`，platform_id 取自 context.platformId（db:458-459）；
 * 連 teamId→teamName 對照表也是先用 `platform_id = ? AND id = ?` 撈該活動設定才建的（db:452-456）。
 *
 * 敏感資料（第 8 節）：回傳含 memberId / memberName。memberName 是**會員登入帳號**、不是 realName，
 * 也不是銀行卡號/開戶姓名，不在第 8 節要求遮罩的真實個資範圍；與本 server 既有會員查詢 tool 一致不遮罩。
 * 無密鑰/token 欄位。
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

export function registerGetWorldCupKnockoutRecordsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_world_cup_knockout_records',
        {
            title: 'Query world cup knockout (晉級爭冠賽) award records',
            description:
                '分頁查詢世界盃「晉級爭冠賽」的領獎紀錄（rajah: WorldCupPlatform.GetWorldCupKnockoutRecords，' +
                'world_cup_back_office.rajah:435）。**本 service 目前沒有權限節點把關**——rajah 上的 ' +
                '`@Permission "WorldCup"` 整段被註解掉，只要登入平台後台即可呼叫。' +
                '\n\n' +
                '**activityId 必填**：後端在 activityId 沒帶或 <= 0 時直接回 invalidData 錯誤，' +
                '因此本 tool 的 schema 已設為必填且 >= 1。合法但不存在或屬於別平台的 id 則是另一回事：' +
                '那會正常回 success 加空陣列，不是錯誤。合法值請先呼叫 ' +
                'aladdin_platform_world_cup_platform_get_world_cup_info_list 取得。' +
                '\n\n' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:438-537）：' +
                '除了時間區間以外的篩選條件全部是精確比對（SQL `=`），沒有任何 LIKE 模糊查詢——' +
                'orderNo / memberName 打錯一個字就查不到；startTime / endTime 例外，是 created_at 的 >= / <= 區間比較。' +
                '排序固定 created_at DESC。查詢一律限定當前登入平台。' +
                '\n\n' +
                '**pageSize 與其他兩支紀錄查詢 tool 不同**：本 method 的 pageSize 在後端是裸整數（不是 PageSizeEnum），' +
                '後端除了「0 換成預設值 100」之外**沒有任何上限保護**。本 tool 因此把上限收在 200，' +
                '請正常翻頁，不要試圖用超大 pageSize 一次撈完。' +
                '\n\n' +
                '**分頁陷阱（務必遵守）**：totalPage / totalRow **只有在 page=1 的回應裡才是真值**，' +
                'page>=2 一律回 0（後端共用的 getPageData 只在第一頁做 count，' +
                'agrabah/src/common/database_helper.ts:204-217；2026-08-28 已用同一台 dev 的 ' +
                'aladdin_platform_audit_platform_get_audit_logs 實測驗證：page=1 回 totalPage=2611，' +
                'page=2 同樣回滿 10 筆但 totalPage=0）。不要拿 page>=2 的 totalPage=0 當作「沒有資料了」。' +
                '\n\n' +
                '欄位語意（與其他兩支紀錄 tool 不同，這支有幾個獨有欄位）：' +
                'teamName 是後端拿該活動設定裡的隊伍清單（worldCupTeam JSON）用 teamId 反查出來的顯示名，' +
                '**若該隊伍已被從活動設定裡移除，teamName 會是空字串，但 teamId 仍是原始 id**；' +
                'reselect（是否重選）後端回的是**中文字串**「是」或「-」（不是布林、也不是數字），不要當成數值解析；' +
                'knockoutCondition 是晉級條件 KnockoutConditionEnum：1=獲得第一名、2=第二名、3=第三名、4=第四名、' +
                '5=進四強、6=進八強、7=進十六強；collectTime 是領獎時間（毫秒 epoch，後端取 created_at）。' +
                'award 是 @Type "Currency" 的 stored 整數（依幣別精度縮放，常見 ×10000）；' +
                'audit 是 @Type "Rate" 的稽核倍數 ×10000 整數。' +
                '\n\n' +
                '本 tool 沒有 miles 欄位——晉級爭冠賽沒有累計里程的概念，對應的總額統計 tool ' +
                '（aladdin_platform_world_cup_platform_get_world_cup_knockout_total_award）也只回 totalAward、沒有 totalMiles。' +
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
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始；只有 page=1 的回應才帶真實的 totalPage/totalRow'),
                pageSize: z.number().int().min(1).max(200).optional().describe(
                    '每頁筆數，1~200；不帶則用後端預設 100。後端此參數是裸整數、沒有上限保護，' +
                    '上限 200 是本工具加的保護，不是後端擋的',
                ),
            },
        },
        async ({ activityId, orderNo, memberId, memberName, vipLevelId, levelId, knockoutCondition, startTime, endTime, page, pageSize }) => {
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
                () => remote.sportBackOffice.worldCupPlatform.GetWorldCupKnockoutRecords(search, page, pageSize ?? 0),
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
