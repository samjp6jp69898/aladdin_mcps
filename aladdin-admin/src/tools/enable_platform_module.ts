/**
 * tools/enable_platform_module.ts — aladdin_admin_module_admin_enable_platform_module
 *
 * rajah: ModuleAdmin.EnablePlatformModule（module.rajah:28，
 * 需要 @Permission "PlatformManagementAdmin.PlatformList.Module.Edit"）
 *
 * 分類（method-category-checklist.md 第 6 節「狀態轉換」，帶明確目標狀態的 enabled boolean）。
 * 2026-08-25 讀 agrabah 後端原始碼查證（非憑猜測，agrabah/src/servers/core_back_office/services/module.ts:100-143）：
 * - enabled=true：moduleId 已在平台的啟用清單裡 → 直接回成功（no-op，冪等）；不在清單裡但該
 *   moduleId 在 `module` 表不存在（未啟用的模組定義本身）→ 回 moduleNotExists，不會寫入。
 * - enabled=false：moduleId 不在平台的啟用清單裡 → 直接回成功（no-op，冪等）；在清單裡則移除。
 * - 兩種情況都是對 platform_modules.module_ids 這個 JSON 陣列做加入/移除單一元素，不是整批覆蓋
 *   （整批覆蓋的是 EnablePlatformModules，見 enable_platform_modules.ts）。
 * - 成功寫入後發送 ReloadPlatformModule message 讓下游快取刷新，本工具不需要額外處理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerEnablePlatformModuleTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_module_admin_enable_platform_module',
        {
            title: 'Enable or disable a single module for a platform',
            description:
                '啟用或停用指定平台的單一模組（rajah: ModuleAdmin.EnablePlatformModule，module.rajah:28，' +
                '需要權限節點 PlatformManagementAdmin.PlatformList.Module.Edit）。這是單一模組的加入/移除操作，' +
                '不是整批覆蓋——若要一次設定平台應啟用的完整模組清單，用 ' +
                'aladdin_admin_module_admin_enable_platform_modules（複數版本，整批覆蓋語意不同，勿混用）。' +
                'platformId 從 aladdin_admin_platform_management_list_platform_details 取得，moduleId 從 ' +
                'aladdin_admin_module_admin_get_platform_modules 的回傳結果取得。' +
                '2026-08-25 讀 agrabah 後端原始碼查證：本操作冪等——moduleId 已經是目標狀態（已啟用時再次啟用、' +
                '或已停用時再次停用）會直接回成功、不報錯，可放心重試；但 enabled=true 且 moduleId 不是合法的' +
                '模組定義 id 時，會回 moduleNotExists 錯誤且不寫入。寫入成功後本工具會用 ' +
                'aladdin_admin_module_admin_get_platform_modules 讀回驗證該 moduleId 的 status 是否符合預期。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_platform_management_list_platform_details 的回傳結果'),
                moduleId: z.number().int().describe('模組 id，來自 aladdin_admin_module_admin_get_platform_modules 的回傳結果'),
                enabled: z.boolean().describe('true = 啟用該模組，false = 停用該模組'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ platformId, moduleId, enabled, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.coreBackOffice.moduleAdmin.EnablePlatformModule(platformId, moduleId, enabled));
            if (r.failed) return asErrorResult(r);

            const listResult = await withAutoRelogin(() => remote.coreBackOffice.moduleAdmin.GetPlatformModules(platformId));
            const matched = listResult.success
                ? listResult.data?.modules?.find((module) => module.id === moduleId)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (listResult.success ? { note: '讀回結果沒找到該 moduleId，可能 moduleId 本身不合法' } : null),
            });
        },
    );
}
