/**
 * tools/get_vip_point_setting.ts — aladdin_platform_point_platform_get_vip_point_setting
 *
 * rajah: PointPlatform.GetVipPointSetting（point_back_office.rajah:264，
 * 需要 @Permission "Store.Point.Setting.Ops.Edit"）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetVipPointSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_get_vip_point_setting',
        {
            title: 'Get a VIP level point rebate setting for editing',
            description:
                '取得指定 VIP 層級的積分設定完整編輯用資料（rajah: PointPlatform.GetVipPointSetting，' +
                '需要權限節點 Store.Point.Setting.Ops.Edit），是 ' +
                'aladdin_platform_point_platform_update_vip_point_setting 的讀現值搭配方法。vipLevelSettingId 從 ' +
                'aladdin_platform_point_platform_list_vip_point_settings 取得。2026-08-25 讀原始碼查證' +
                '（agrabah/src/servers/point_back_office/services/point_platform.ts:507-558）：若該層級尚無設定紀錄，' +
                '後端會即時建立預設值再回傳，不會回錯誤。回傳的 rebateRateDefault/displayTagPointRebates[].rate ' +
                '是多幣別陣列（每種平台幣別各一筆 {code, value}），displayTagPointRebates 固定涵蓋全部遊戲分類' +
                '（GameDisplayTagEnum，非 unknown 值），userLevelIds 是參與此積分返利規則的會員層級 id 清單。',
            inputSchema: {
                vipLevelSettingId: z.number().int().describe('VIP 層級 id，來自 aladdin_platform_point_platform_list_vip_point_settings 的回傳結果'),
            },
        },
        async ({ vipLevelSettingId }) => {
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetVipPointSetting(vipLevelSettingId));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, settingEdit: deepFixLongs(r.data?.settingEdit ?? null) });
        },
    );
}
