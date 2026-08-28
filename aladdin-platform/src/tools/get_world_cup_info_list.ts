/**
 * tools/get_world_cup_info_list.ts — aladdin_platform_world_cup_platform_get_world_cup_info_list
 *
 * rajah: WorldCupPlatform.GetWorldCupInfoList(worldCupSearchRequest WorldCupSearchRequest 1)
 * (rows [SpeActWorldCup] 1)（rajah/services/world_cup_back_office.rajah:417，service 定義同檔 411-443）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：
 * - 非 Placeholder：world_cup_back_office.rajah **全檔沒有任何 Placeholder method**
 *   （2026-08-28 `grep -ci placeholder` 回 0），service 411-443 的 11 支全是真方法。
 * - service WorldCupPlatform 非 @NoPublic（world_cup_back_office.rajah:410-411 只有一行被註解掉的
 *   `# @Permission "WorldCup"`，沒有 @NoPublic）。
 * - agrabah 後端**確實有 override**、不是 base class 的 notImplemented：
 *   agrabah/src/servers/sport_back_office/services/world_cup_platform.ts:68-73 `methodGetWorldCupInfoList`，
 *   委派給 agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:105-136 `getWorldCupInfoList`。
 *   注意 service 實作放在 **sport_back_office** server（不是同名的 world_cup_back_office 目錄，該目錄不存在），
 *   2026-08-28 實際 grep WorldCupPlatformBaseService 查證。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：A 級——search struct（WorldCupSearchRequest）
 * 內有可鎖定單一目標的 `id`，不是「只有範圍鍵 + 分頁」的 B 級。本 method **完全沒有分頁參數**，一次全撈；
 * 依第 2 節「完全不分頁的全撈」條款查證底層不是會持續成長的歷史/log 表：
 * world_cup_platform_db.ts:109/111 兩條 SQL 都是 `DbWorldCupInfo` 且一律帶 `platform_id = context.platformId`，
 * 這張表存的是「一屆世界盃活動的主體設定」（運營每屆手動建一筆），屬小型設定表；agrabah 端註解也自述
 * 「目前 response 為陣列 rows，未帶分頁參數；若活動數量大增需補分頁」（world_cup_platform.ts:64）。
 *
 * 跨租戶：兩條 SQL 都強制 `platform_id = context.platformId`，即使帶別平台的 id 也撈不到（回空陣列），
 * 無跨租戶讀取風險。
 *
 * 敏感資料（第 8 節）：SpeActWorldCup 全部欄位為活動設定（名稱、時間、圖片 URL、隊伍設定、任務設定），
 * 無密鑰/token/密碼，也無 realName/銀行帳號等真實個資，不需遮罩。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { WorldCupSearchRequest } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetWorldCupInfoListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_world_cup_platform_get_world_cup_info_list',
        {
            title: 'List world cup activity configurations of the current platform',
            description:
                '列出本平台的世界盃活動主體設定（rajah: WorldCupPlatform.GetWorldCupInfoList，' +
                'world_cup_back_office.rajah:417）。**本 service 目前沒有權限節點把關**——rajah 上的 ' +
                '`@Permission "WorldCup"` 整段被註解掉（world_cup_back_office.rajah:410-441），只要登入平台後台即可呼叫。' +
                '\n\n' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/sport_back_office/models/world_cup_platform_db.ts:105-136）：' +
                '不分頁、一次全撈本平台全部活動，依 id DESC 排序（最新建立的在最前面）；' +
                'id 省略或填 0 代表不篩選、列出全部，填了 id 就只回那一筆。' +
                '查詢一律強制加上 platform_id = 當前登入平台，帶別平台的 id 會回空陣列（不是錯誤），無法跨平台讀取。' +
                '\n\n' +
                '回傳的每筆 `id` 就是世界盃紀錄查詢類 tool 的 activityId 來源（該參數為必填）：' +
                'aladdin_platform_world_cup_platform_get_milestone_record、' +
                'aladdin_platform_world_cup_platform_get_milestone_total_award_and_miles、' +
                'aladdin_platform_world_cup_platform_get_goal_sprint_record。' +
                '\n\n' +
                '欄位語意：activityStatus 是活動開關（OpenStatusEnum，1=開啟）；showStartTime/showEndTime 是活動' +
                '展示時間區間（毫秒 epoch）；levelList 是可見的會員層級 id 陣列；worldCupTeam/milestone/goalSprint/' +
                'knockout 四個欄位在 DB 裡是 JSON 字串，後端 load 時 JSON.parse 還原成物件回傳（該欄位為 NULL 時，' +
                'worldCupTeam 回空陣列、其餘三個回 null）。' +
                '\n\n' +
                '**通則：回傳 JSON 裡「沒出現的欄位」＝該欄位是型別預設值**（protobuf 不序列化預設值，' +
                '本 tool 的輸出轉換也只保留實際存在的欄位）。所以活動關閉時看不到 activityStatus（預設 0=關閉）、' +
                'allowGuest 為 false 時看不到該鍵、levelList 為空時看不到該鍵——欄位缺席要讀成預設值，不是「查不到資料」。' +
                '另有一組欄位是**後端根本沒映射**：createdAt / updatedAt / platformId 三個在 DB 函式裡完全沒有被賦值' +
                '（world_cup_platform_db.ts:114-131 整段沒有這三行），所以永遠不會出現，也不代表資料庫裡沒有值——' +
                '需要建立/更新時間請改查 DB。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                id: z.number().int().optional().describe(
                    '世界盃活動 id；省略或填 0 代表列出本平台全部活動。此 id 只在本平台範圍內有效，' +
                    '帶別平台的 id 會得到空陣列而不是錯誤。',
                ),
            },
        },
        async ({ id }) => {
            const search = WorldCupSearchRequest.create({ id: id ?? 0 });
            const r = await withAutoRelogin(() => remote.sportBackOffice.worldCupPlatform.GetWorldCupInfoList(search));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.rows ?? []) });
        },
    );
}
