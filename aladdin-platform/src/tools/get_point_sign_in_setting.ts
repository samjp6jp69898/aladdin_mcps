/**
 * tools/get_point_sign_in_setting.ts — aladdin_platform_point_platform_get_point_sign_in_setting
 *
 * rajah: PointPlatform.GetPointSignInSetting（point_back_office.rajah:275，
 * 需要 @Permission "Store.Point.Activity.SignIn"）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetPointSignInSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_point_platform_get_point_sign_in_setting',
        {
            title: 'Get sign-in reward settings',
            description:
                '取得本平台「商城系統 > 積分管理 > 積分活動 > 簽到獎勵」的設定（rajah: ' +
                'PointPlatform.GetPointSignInSetting，需要權限節點 Store.Point.Activity.SignIn）。無參數，單例設定。' +
                '2026-08-25 讀原始碼查證（agrabah/src/servers/point_back_office/services/point_platform.ts:728-756）：' +
                '若尚未設定過，查無紀錄，各欄位回零值/空陣列（不會自動建立預設值，與 GetPointSetting 不同）。' +
                'depositAmounts 是多幣別陣列（{code, value}），depositCondition=daily 時代表「每日充值達此金額才可簽到」；' +
                'streakBonuses 是連續簽到天數對應的積分倍率表。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.pointBackOffice.pointPlatform.GetPointSignInSetting());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, settingEdit: deepFixLongs(r.data?.settingEdit ?? null) });
        },
    );
}
