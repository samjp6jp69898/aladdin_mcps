/**
 * tools/get_vip_level_settings.ts — aladdin_platform_vip_level_platform_get_vip_level_settings
 *
 * rajah: VipLevelPlatform.GetVipLevelSettings（vip_back_office.rajah:1258，
 * 無 @Permission）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetVipLevelSettingsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_vip_level_platform_get_vip_level_settings',
        {
            title: 'List VIP level settings',
            description:
                '列出本平台全部啟用中的 VIP 等級設定（新版 VIP 體系，rajah: VipLevelPlatform.GetVipLevelSettings，' +
                '此 method 無 @Permission）。無參數，只回 status=enabled 的紀錄（停用等級不會出現，' +
                'agrabah/src/managers/vip_setting_manager.ts:247-248 確認），固定小量列舉表，' +
                'agrabah/src/servers/vip_back_office/services/vip_level_platform.ts:238-245 透過 ' +
                'vipSettingCacheManager 快取讀取、無分頁；2026-08-25 dev 實測回傳筆數與平台 VIP 等級數一致，' +
                '非會持續成長的表）。⚠️ 舊版體系 VipPlatform.GetVipLevelConfigs 資料已無人維護（dev 實測 0 筆），' +
                '本 tool 才是現行 VIP 等級設定的正確來源。回傳的 id 供後續 VipLevelPlatform 系列（等級詳情/編輯/刪除/' +
                '排程等）method 使用。金額欄位為 CurrencyLink（i64），已用 deepFixLongs 轉為一般數字。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.GetVipLevelSettings());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: deepFixLongs(r.data?.rows ?? []) });
        },
    );
}
