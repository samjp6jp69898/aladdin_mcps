/**
 * tools/get_information_read_count.ts — aladdin_platform_common_info_platform_get_read_count
 *
 * rajah: CommonInfoPlatform.GetReadCount（information_back_office.rajah:95，
 * @Permission "DailyOperation.Information.Ops.View"）——批次查詢多筆信息各自的已讀人數。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/information_back_office/services/
 * common.ts:46-71，methodGetReadCount 真實實作，非 notImplemented 空殼）：
 * - 直接對 DbReadLog 以 `SELECT info_id, COUNT(*) AS read_count ... WHERE info_id IN (?) AND
 *   platform_id = ? GROUP BY info_id` 聚合查詢，每 100 筆 id 分一批；同一批內重複 id 會去重（Set +
 *   `!countMap.has(id)` 過濾）避免查兩次，但去重範圍只在同一批（100 筆）內——若同一個 id 在跨批
 *   之後又出現、且該 id 查詢結果是 0（沒有已讀紀錄不會進 countMap），會被重新查一次；不影響回傳
 *   正確性，只是效率上不是全域去重。
 * - **回傳陣列與輸入 infoIds 陣列同長度、同順序**：最後一步是 `response.counts =
 *   infoIds.map(id => countMap.get(id) ?? 0)`，查不到（或該筆信息目前沒有任何已讀紀錄）的 id
 *   會回 0，不是被跳過或報錯——這點與 method-category-checklist.md 第 2 節對「Batch 開頭查詢」
 *   的一般警告（不能假設回傳陣列與輸入同長度/同順序）不同，這支方法的實作結構性保證了對應關係，
 *   不需要呼叫端自行用 id 欄位比對。
 * - 沒有驗證 infoIds 對應的信息是否真的存在，也沒有做 platform 歸屬以外的權限檢查（只要有這個
 *   節點的權限，帶哪個 infoId 都查得動，不會因為這筆信息屬於別的 type 或別人建立就被擋）。回 0
 *   有三種可能：id 不存在、id 存在但目前 0 人已讀、id 存在但屬於別的平台（SQL 固定帶
 *   `platform_id = context.platformId`，跨平台的 id 查得動但一定回 0，不會洩漏別平台的已讀數），
 *   三者從回傳值無法區分。
 * - infoIds 傳空陣列時，for 迴圈 0 次執行、countMap 維持空，最後 `[].map(...)` 回傳空陣列，
 *   不會報錯。
 *
 * 2026-08-25 dev 實測（stdio 直打本工具，dev 帳密，對 pk-platform.alddev.com，資料取自同 domain
 * 已完成的 aladdin_platform_common_info_platform_get_configs 讀到的真實 id）：
 * - 帶多筆存在的 id（含至少一筆已讀人數 > 0、一筆已讀人數為 0）：counts 陣列長度與輸入一致、
 *   逐一對應正確。
 * - 混入一個不存在的 id（例如 999999999）：該位置回 0，不報錯，與檔頭「不存在的 id 一律回 0」
 *   一致。
 * - 帶重複 id：回傳陣列長度與輸入長度一致（含重複位置），每個位置的值相同（去重查詢、複用同一個
 *   count），未因去重邏輯漏算或錯位。
 * - 空陣列：回傳空陣列，不報錯。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetInformationReadCountTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_common_info_platform_get_read_count',
        {
            title: 'Get read counts for back-office information items',
            description:
                '批次查詢多筆信息（公告/緊急通知/最新消息……）各自的已讀人數（rajah: ' +
                'CommonInfoPlatform.GetReadCount，需要權限節點 DailyOperation.Information.Ops.View）。' +
                'infoIds 從 aladdin_platform_common_info_platform_get_configs 回傳的 rows[].id 取得。' +
                '回傳的 counts 陣列與輸入 infoIds 陣列**同長度、同順序**（後端實作保證，逐一對應，不需要' +
                '呼叫端自行用其他欄位比對）；不存在的 id、目前 0 人已讀的 id、或屬於別平台的 id 一律' +
                '回 0（三者無法從回傳值區分，但查詢固定限定在本平台範圍內，不會洩漏別平台的已讀數）。' +
                'infoIds 為空陣列時回傳空陣列，不會報錯。',
            inputSchema: {
                infoIds: z.array(z.number().int()).max(1000).describe(
                    '要查詢已讀人數的信息 id 清單，來自 aladdin_platform_common_info_platform_get_configs' +
                    '回傳的 rows[].id，可包含重複值（後端會盡量去重查詢，但回傳陣列仍會依原始輸入長度/' +
                    '順序展開）。上限 1000 筆是本工具自加的結構性防呆（後端本身無上限，但正常用法不會' +
                    '一次查這麼多）。',
                ),
            },
        },
        async ({ infoIds }) => {
            const r = await withAutoRelogin(() => remote.informationBackOffice.commonInfoPlatform.GetReadCount(infoIds));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, counts: r.data?.counts ?? [] });
        },
    );
}
