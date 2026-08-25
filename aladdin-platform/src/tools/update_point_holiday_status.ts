/**
 * tools/update_point_holiday_status.ts — aladdin_platform_point_platform_update_point_holiday_status
 *
 * rajah: PointPlatform.UpdatePointHolidayStatus（point_back_office.rajah:295，
 * 需要 @Permission "Store.Point.Activity.Holiday.Ops.Toggle"）
 *
 * 分類（method-category-checklist.md 第 6 節「狀態轉換」）：帶明確目標狀態，非無參數 bit-flip。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerUpdatePointHolidayStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_update_point_holiday_status',
        {
            title: 'Toggle the holiday bonus feature on/off',
            description:
                '切換本平台「節假日獎勵」功能的開關（rajah: PointPlatform.UpdatePointHolidayStatus，需要權限節點 ' +
                'Store.Point.Activity.Holiday.Ops.Toggle）。只影響開關本身，不影響已設定的節假日清單' +
                '（aladdin_platform_point_platform_get_point_holiday_setting 的 rows）。寫入成功後用 ' +
                'GetPointHolidaySetting 讀回驗證。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                status: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態：enabled=開啟、disabled=關閉'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.UpdatePointHolidayStatus(ACTIVE_STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            const checkR = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointHolidaySetting());
            return asTextResult({
                success: true,
                message: '節假日獎勵開關已更新',
                status: checkR.failed ? null : checkR.data?.status,
            });
        },
    );
}
