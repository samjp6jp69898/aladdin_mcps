/**
 * tools/delete_point_holiday_bonus.ts — aladdin_platform_point_platform_delete_point_holiday_bonus
 *
 * rajah: PointPlatform.DeletePointHolidayBonus（point_back_office.rajah:301，
 * 需要 @Permission "Store.Point.Activity.Holiday.Ops.Delete"）
 *
 * 分類（method-category-checklist.md 第 7 節「刪除」）：軟刪除（rajah 註解「軟刪除」+
 * 2026-08-25 讀 point_platform.ts:982-1005 查證，status → deleted）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerDeletePointHolidayBonusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_delete_point_holiday_bonus',
        {
            title: 'Delete a holiday bonus entry (soft delete)',
            description:
                '刪除一筆節假日獎勵設置（rajah: PointPlatform.DeletePointHolidayBonus，需要權限節點 ' +
                'Store.Point.Activity.Holiday.Ops.Delete）。**軟刪除**（2026-08-25 讀原始碼查證，' +
                'point_platform.ts:982-1005：status 改為 deleted，非硬刪除，不會再出現在 ' +
                'aladdin_platform_point_platform_get_point_holiday_setting 的 rows）。id 不存在或已被刪除時回錯誤碼 ' +
                'pointHolidayBonusNotFound（非設計為冪等，重複刪除同一 id 會報錯而非 no-op）。' +
                'id 從 aladdin_platform_point_platform_get_point_holiday_setting 的 rows 取得。' +
                '寫入成功後用 GetPointHolidaySetting 讀回驗證該 id 確實不再出現在清單中。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('節假日設置 id，來自 aladdin_platform_point_platform_get_point_holiday_setting 的 rows'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.DeletePointHolidayBonus(id));
            if (r.failed) return asErrorResult(r);

            const checkR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointHolidaySetting());
            const stillExists = !checkR.failed && (checkR.data?.rows ?? []).some((row) => row.id === id);

            return asTextResult({
                success: true,
                message: '節假日設置已刪除',
                readBackConfirmedRemoved: !stillExists,
            });
        },
    );
}
