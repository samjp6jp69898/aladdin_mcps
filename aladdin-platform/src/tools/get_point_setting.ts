/**
 * tools/get_point_setting.ts — aladdin_platform_point_platform_get_point_setting
 *
 * rajah: PointPlatform.GetPointSetting（point_back_office.rajah:258，
 * 需要 @Permission "Store.Point.Setting.Configuration"）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetPointSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_get_point_setting',
        {
            title: 'Get platform-wide point settings',
            description:
                '取得本平台的全局積分設定（rajah: PointPlatform.GetPointSetting，' +
                '需要權限節點 Store.Point.Setting.Configuration）。無參數，單例設定。' +
                '2026-08-25 讀原始碼查證（agrabah/src/servers/point_back_office/services/point_platform.ts:657-667）：' +
                '若平台尚未有此設定紀錄，後端會即時建立預設值再回傳。dueType（TimeLimitTypeEnum）決定積分時效規則：' +
                'unlimitedTime=無限制、absoluteTime=絕對到期時間（看 dueAtTimestamp）、relativeTime=相對天數' +
                '（看 dueDay，取得積分後 N 天到期）。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointSetting());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, setting: deepFixLongs(r.data?.setting ?? null) });
        },
    );
}
