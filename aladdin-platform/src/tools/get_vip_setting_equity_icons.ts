/**
 * tools/get_vip_setting_equity_icons.ts — aladdin_platform_vip_level_platform_get_vip_setting_equity_icons
 *
 * rajah: VipLevelPlatform.GetVipSettingEquityIcons（vip_back_office.rajah:1255，
 * 需要權限節點 AppUser.Vip）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetVipSettingEquityIconsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_vip_level_platform_get_vip_setting_equity_icons',
        {
            title: 'List VIP equity icons',
            description:
                '列出本平台全部「VIP 權益圖標」選項（rajah: VipLevelPlatform.GetVipSettingEquityIcons，' +
                '需要權限節點 AppUser.Vip）。無參數，一次列出全部啟用中的圖標（固定小量列舉表，底層查詢無分頁、無 LIMIT，' +
                '只篩 status=enabled，agrabah/src/managers/vip_setting_manager.ts:178-206 確認）。' +
                '⚠️ 回傳每筆的 isSelect 固定為 disabled：後端 getVipSettingEquityIcons() 只有帶 vipLevelSettingId>0（查詢' +
                '某個 VIP 等級設定綁定了哪些圖標）時才會真正計算 isSelect，此公開 API 呼叫時 vipLevelSettingId 恆為 0，' +
                '不能用這支 tool 的 isSelect 判斷任何等級是否已勾選某圖標。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.GetVipSettingEquityIcons());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.equitySelects ?? []) });
        },
    );
}
