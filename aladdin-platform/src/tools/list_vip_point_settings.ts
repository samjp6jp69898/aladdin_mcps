/**
 * tools/list_vip_point_settings.ts — aladdin_platform_point_platform_list_vip_point_settings
 *
 * rajah: PointPlatform.ListVipPointSettings（point_back_office.rajah:255，
 * 需要 @Permission "Store.Point.Setting"）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerListVipPointSettingsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_list_vip_point_settings',
        {
            title: 'List VIP-level point rebate settings',
            description:
                '列出本平台每個 VIP 層級的積分返利設定摘要（rajah: PointPlatform.ListVipPointSettings，' +
                '需要權限節點 Store.Point.Setting）。無參數，一次列出全部 VIP 層級（層級數固定小量，非會持續' +
                '成長的表）。回傳的 vipLevelSettingId 供 aladdin_platform_point_platform_get_vip_point_setting / ' +
                'aladdin_platform_point_platform_update_vip_point_setting 使用。' +
                '2026-08-25 讀原始碼查證（agrabah/src/servers/point_back_office/services/point_platform.ts:468-493）：' +
                '每個層級若尚未有積分設定紀錄，後端會即時建立預設值再回傳，不會回缺漏該層級的情況。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.ListVipPointSettings());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.rows ?? []) });
        },
    );
}
