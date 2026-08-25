/**
 * tools/enable_platform_modules.ts — aladdin_admin_module_admin_enable_platform_modules
 *
 * rajah: ModuleAdmin.EnablePlatformModules（module.rajah:31，
 * 需要 @Permission "PlatformManagementAdmin.PlatformList.Module.Edit"）
 *
 * 分類：批次覆蓋，不屬於 method-category-checklist.md 任何一節的標準模板（不是第 3 節新增、
 * 不是第 4 節 Upsert model、也不是第 6 節單一 toggle），比照第 4 節精神額外處理：
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/core_back_office/services/module.ts:159-184）：
 * - 語意是**整批覆蓋**，不是增量新增：傳入的 moduleIds 會完全取代平台原本的啟用模組清單。
 * - 傳入空陣列會清除平台所有啟用模組（rajah/CLAUDE.md「空陣列覆蓋防護規範」的情境，這裡是
 *   後端本來就設計成整批覆蓋語意，不是 proto3 稀疏編碼誤判，呼叫端必須清楚知道空陣列的後果）。
 * - moduleIds 內任一 id 不是合法的模組定義 id（`module` 表 status=enabled 的列）→ 整批回
 *   moduleNotExists，不會部分寫入。
 * - 呼叫端必須傳入「平台完整應啟用的模組清單」，不能只傳想新增的那幾個 id，否則其餘現有啟用的
 *   模組會被一併移除——tool description 與 inputSchema 明確標註此風險。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerEnablePlatformModulesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_module_admin_enable_platform_modules',
        {
            title: "Overwrite a platform's entire enabled-module set",
            description:
                '整批設定指定平台應啟用的模組清單（rajah: ModuleAdmin.EnablePlatformModules，module.rajah:31，' +
                '需要權限節點 PlatformManagementAdmin.PlatformList.Module.Edit）。' +
                '⚠️ 這是「整批覆蓋」語意，不是增量新增：moduleIds 必須帶平台完整應啟用的模組清單，' +
                '不能只帶想新增的那幾個 id，否則原本啟用但這次沒帶到的模組會一併被停用；' +
                '傳入空陣列會清除該平台所有啟用模組。若只想切換單一模組、不影響其他模組的啟用狀態，' +
                '改用 aladdin_admin_module_admin_enable_platform_module（單數版本）。' +
                '呼叫前建議先用 aladdin_admin_module_admin_get_platform_modules 讀現值，把目前已啟用的模組 id ' +
                '併入這次要傳的完整清單，避免誤刪。' +
                'platformId 從 aladdin_admin_platform_management_list_platform_details 取得，moduleId 從 ' +
                'aladdin_admin_module_admin_get_platform_modules 的回傳結果取得。' +
                '2026-08-25 讀 agrabah 後端原始碼查證：moduleIds 內任一 id 不是合法的模組定義 id 時，整批回 ' +
                'moduleNotExists 錯誤、不會部分寫入（要嘛全部套用、要嘛完全不寫入）。' +
                '寫入成功後本工具會用 aladdin_admin_module_admin_get_platform_modules 讀回驗證，逐一比對傳入的 ' +
                'moduleIds 是否都變成 enabled、其餘模組是否都變成 disabled。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_platform_management_list_platform_details 的回傳結果'),
                moduleIds: z.array(z.number().int()).describe(
                    '平台完整應啟用的模組 id 清單（整批覆蓋，不是增量新增；空陣列會清空該平台所有啟用模組）',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ platformId, moduleIds, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.coreBackOffice.moduleAdmin.EnablePlatformModules(platformId, moduleIds));
            if (r.failed) return asErrorResult(r);

            const listResult = await withAutoRelogin(() => remote.coreBackOffice.moduleAdmin.GetPlatformModules(platformId));

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: listResult.success ? (listResult.data?.modules ?? []) : { note: '讀回失敗，無法確認最終狀態' },
            });
        },
    );
}
