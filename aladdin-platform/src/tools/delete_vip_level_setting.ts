/**
 * tools/delete_vip_level_setting.ts — aladdin_platform_vip_level_platform_delete_vip_level_setting
 *
 * rajah: VipLevelPlatform.DeleteVipLevelSetting（vip_back_office.rajah:1264，
 * 需要 @Permission "AppUser.Vip.VipLevelConfig.Delete"）
 *
 * 分類（method-category-checklist.md 第 7 節「刪除」）：軟刪除（agrabah
 * vip_level_platform.ts:443 UPDATE ... SET status = deleted，非硬刪除）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerDeleteVipLevelSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_vip_level_platform_delete_vip_level_setting',
        {
            title: 'Delete a VIP level setting (soft delete)',
            description:
                '刪除一筆 VIP 等級設定（rajah: VipLevelPlatform.DeleteVipLevelSetting，需要權限節點 ' +
                'AppUser.Vip.VipLevelConfig.Delete）。**軟刪除**（vip_level_platform.ts:443：UPDATE ... SET status = ' +
                'deleted，正確有帶 platform_id 條件，非跨租戶風險方法）。' +
                '⚠️ 該等級仍有真實會員時會擋下（errorCode=vipLevelSettingHasUsers，2026-08-25 dev 對 id=50/userNum=2510 ' +
                '實測回 errorCode=1004、資料未被刪除），不是無條件可刪。' +
                '⚠️ 冪等行為特殊：2026-08-25 dev 實測對已刪除的 id 或完全不存在的 id 重複呼叫皆回 errorCode=0 成功' +
                '（底層 UPDATE 影響 0 列時不檢查，一律回成功），**不能用「呼叫成功」判斷這個 id 原本真的存在或真的被刪除**，' +
                '呼叫前後都要用 aladdin_platform_vip_level_platform_get_vip_level_settings 讀回確認實際狀態。' +
                '⚠️ 讀回本身走記憶體快取（vip_setting_manager.ts:602-603），快取失效是刪除後才發布的 fire-and-forget ' +
                '訊息，本 tool 內部緊接著讀回時有極小機率快取尚未失效、短暫仍看到該 id（假陰性），不代表刪除沒生效；' +
                'readBack 欄位為 read_back_failed 或 still_present 時建議稍後再查一次確認，不要當場斷定失敗。' +
                'id 從 aladdin_platform_vip_level_platform_get_vip_level_settings 的 rows 取得。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('VIP 等級設定 id，來自 aladdin_platform_vip_level_platform_get_vip_level_settings 的 rows'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.DeleteVipLevelSetting(id));
            if (r.failed) return asErrorResult(r);

            const checkR = await withAutoRelogin(() => remote.vipBackOffice.vipLevelPlatform.GetVipLevelSettings());
            const readBack = checkR.failed
                ? 'read_back_failed'
                : (checkR.data?.rows ?? []).some((row) => row.id === id) ? 'still_present' : 'confirmed_removed';

            return asTextResult({
                success: true,
                message: '刪除呼叫已成功（errorCode=0，這不代表該 id 原本真的存在），請以 readBack 判斷實際狀態',
                readBack,
            });
        },
    );
}
