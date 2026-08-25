/**
 * tools/get_point_holiday_setting.ts — aladdin_platform_point_platform_get_point_holiday_setting
 *
 * rajah: PointPlatform.GetPointHolidaySetting（point_back_office.rajah:292，
 * 需要 @Permission "Store.Point.Activity.Holiday"）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetPointHolidaySettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_get_point_holiday_setting',
        {
            title: 'Get holiday bonus settings (switch + list)',
            description:
                '取得本平台「商城系統 > 積分管理 > 積分活動 > 節假日獎勵」的設定（開關 + 節假日設置列表，' +
                'rajah: PointPlatform.GetPointHolidaySetting，需要權限節點 Store.Point.Activity.Holiday）。無參數，' +
                '單例開關 + 不分頁全撈（節假日筆數為小型列舉表，非會持續成長）。' +
                '2026-08-25 讀原始碼查證（agrabah/src/servers/point_back_office/services/point_platform.ts:824-847）：' +
                'status 若尚未設定過會自動建立預設值（disabled）；rows 只回未（軟）刪除的設置，依開始時間排序。' +
                'rows[].id 供 aladdin_platform_point_platform_create_or_update_point_holiday_bonus（id>0 編輯）與 ' +
                'aladdin_platform_point_platform_delete_point_holiday_bonus 使用。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointHolidaySetting());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, status: r.data?.status, rows: deepFixLongs(r.data?.rows ?? []) });
        },
    );
}
