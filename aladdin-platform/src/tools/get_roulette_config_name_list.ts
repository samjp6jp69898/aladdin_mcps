/**
 * tools/get_roulette_config_name_list.ts — aladdin_platform_roulette_platform_get_config_name_list
 *
 * rajah: RoulettePlatform.GetConfigNameList（roulette_back_office.rajah:328，
 * 刻意不掛 @Permission——rajah 註解說明這是跨一級菜單共用的下拉來源，廣告系統跳轉設置/商城/
 * 活動編輯彈窗都會呼叫，掛在 service 標頭會被套用 BonusCenter.Lottery 權限節點反而擋錯角色）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:344-365，
 * methodGetConfigNameList）：真的查 DB（`platform_id = ?`）+ 逐筆補多語 showName，非
 * placeholder。無參數、不分頁——轉盤配置是營運人員手動建立的設定，數量有限。
 *
 * 2026-08-26 dev 實測（pk-platform.alddev.com，帳號 landon001）：回傳真實資料
 * （id=8/9/10... 附中文 showName），確認非空。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetRouletteConfigNameListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_get_config_name_list',
        {
            title: 'Get the current platform\'s roulette config id + name list',
            description:
                '取得當前平台全部轉盤配置的 id + 多語名稱清單（rajah: RoulettePlatform.GetConfigNameList，' +
                '無權限節點限制——這支是跨一級菜單共用的下拉來源）。無參數、不分頁，供其他 tool（如 ' +
                'aladdin_platform_roulette_platform_get_roulette_config_by_id）取得合法 id。' +
                '2026-08-26 dev 實測回傳真實資料。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetConfigNameList());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
