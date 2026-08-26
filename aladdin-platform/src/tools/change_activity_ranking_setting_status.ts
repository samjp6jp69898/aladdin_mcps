/**
 * tools/change_activity_ranking_setting_status.ts — aladdin_platform_ranking_platform_change_activity_ranking_setting_status
 *
 * rajah: RankingPlatform.ChangeActivityRankingSettingStatus(id i32 1, status StatusEnum 2)
 * （ranking_back_office.rajah:104，需要 @Permission "BonusCenter.AcRanking"）——把單一活動
 * 排行榜設定改成指定狀態（後台「優惠中心 > 活動排行榜」列表頁的啟用/停用開關）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/ranking_back_office/services/ranking_platform.ts:54-63，
 * methodChangeActivityRankingSettingStatus，底層呼叫共用 helper `updateStatus`，
 * agrabah/src/common/database_helper.ts:25-50）：
 * - `updateStatus` 會先檢查 `StatusEnum.hasOwnProperty(status)`，非法列舉值直接回
 *   `invalidData`；SQL 影響列數為 0（id 不存在或不屬於當前 platformId）明確回
 *   `objectNotFound`——跟同 domain 其他方法常見的「id 不存在仍靜默回成功」陷阱不同，
 *   這支後端有做好 affectedRows 檢查，tool 層不需要額外先讀現值防呆。
 *
 * **2026-08-26 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，
 * 涵蓋：不存在的 id=999999999 → errorCode=14 objectNotFound；非法列舉值 254 → errorCode=9
 * invalidData；目標狀態與現值相同（disabled→disabled）→ errorCode=0 成功視為冪等；
 * round-trip 對真實資料 id=1020 切換 disabled→enabled→讀回驗證變更生效→切回 disabled→
 * 讀回驗證已復原，全程無殘留髒資料）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerChangeActivityRankingSettingStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ranking_platform_change_activity_ranking_setting_status',
        {
            title: 'Change an activity ranking setting status',
            description:
                '把單一活動排行榜設定改成指定狀態（rajah: RankingPlatform.ChangeActivityRankingSettingStatus，' +
                '需要權限節點 BonusCenter.AcRanking）。id 從 ' +
                'aladdin_platform_ranking_platform_list_activity_ranking_setting 取得。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會' +
                '用到 enabled/disabled。' +
                '**2026-08-26 dev 實測確認**：id 不存在時後端會正確回 objectNotFound（不是靜默成功），非法列舉值' +
                '會回 invalidData；目標狀態與現值相同時呼叫仍會成功（視為冪等 no-op）。',
            inputSchema: {
                id: z.number().int().describe('活動排行榜設定 id，來自 aladdin_platform_ranking_platform_list_activity_ranking_setting'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled'),
            },
        },
        async ({ id, status }) => {
            const r = await withAutoRelogin(() => remote.rankingBackOffice.rankingPlatform.ChangeActivityRankingSettingStatus(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, message: '狀態已更新' });
        },
    );
}
