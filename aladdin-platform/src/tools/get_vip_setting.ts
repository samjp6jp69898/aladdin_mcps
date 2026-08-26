/**
 * tools/get_vip_setting.ts — aladdin_platform_vip_level_platform_get_vip_setting
 *
 * rajah: VipLevelPlatform.GetVipSetting（vip_back_office.rajah:1269，
 * 需要權限節點 AppUser.Vip）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetVipSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_vip_level_platform_get_vip_setting',
        {
            title: 'Get VIP global setting',
            description:
                '取得本平台 VIP 全域設定（單例，rajah: VipLevelPlatform.GetVipSetting，需要權限節點 ' +
                'AppUser.Vip）。無參數，內部以 context.platformId 查詢（vip_level_platform.ts:509-516，' +
                '非呼叫端可控的 id 參數，無跨租戶風險），走快取讀取（in-memory TTL 約 3 分鐘，更新後短暫時間內' +
                '可能讀到舊值）。⚠️ levelAuditMultiple/birthAuditMultiple/monthAuditMultiple/weekAuditMultiple/' +
                'dayAuditMultiple 這五個「稽核倍數」欄位是 rajah @Type "Rate"，原始回傳值＝實際倍數 ×10000' +
                '（例如回傳 30000 代表 3 倍，非 30000 倍）；各 *ValidityTime（有效時間）欄位單位是小時。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.GetVipSetting());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, setting: deepFixLongs(r.data?.setting ?? null) });
        },
    );
}
