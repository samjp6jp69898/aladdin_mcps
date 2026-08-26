/**
 * tools/get_roulette_reward_name_list.ts — aladdin_platform_roulette_platform_get_reward_name_list
 *
 * rajah: RoulettePlatform.GetRewardNameList（roulette_back_office.rajah:340，
 * 需要 @Permission "BonusCenter.Lottery"）——取得當前平台全部轉盤獎勵設定的 id + 名稱清單。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:770-778，
 * methodGetRewardNameList）：真的查 DB（`platform_id = ?`），非 placeholder；`name` 是單一
 * 語系字串（非 LocalizationString 陣列，跟同 service 的 GetConfigNameList.showName 型別不同）。
 * 無參數、不分頁——轉盤獎勵是營運人員手動建立的設定，數量有限。
 *
 * 2026-08-26 dev 實測（pk-platform.alddev.com，帳號 landon001）：回傳真實資料
 * （id=7/8/9... 附中文 name），確認非空。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetRouletteRewardNameListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_get_reward_name_list',
        {
            title: "Get the current platform's roulette reward id + name list",
            description:
                '取得當前平台全部轉盤獎勵設定的 id + 名稱清單（rajah: RoulettePlatform.GetRewardNameList，' +
                '需要權限節點 BonusCenter.Lottery）。無參數、不分頁，供其他 tool（如 ' +
                'aladdin_platform_roulette_platform_get_roulette_reward_by_id）取得合法 id。' +
                'name 是單一語系字串（不像同 service 的 config 名稱清單是多語陣列）。' +
                '2026-08-26 dev 實測回傳真實資料。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRewardNameList());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
