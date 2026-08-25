/**
 * tools/list_platform_modules.ts — aladdin_admin_module_admin_get_platform_modules
 *
 * rajah: ModuleAdmin.GetPlatformModules（module.rajah:26，
 * service 級 @Permission "PlatformManagementAdmin.PlatformList.Module"）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformModulesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_module_admin_get_platform_modules',
        {
            title: "List a platform's modules with their enabled/disabled status",
            description:
                '查詢指定平台的模組清單，含每個模組目前啟用/停用狀態（rajah: ModuleAdmin.GetPlatformModules，' +
                'module.rajah:26，需要權限節點 PlatformManagementAdmin.PlatformList.Module）。' +
                '回傳全平台已啟用的模組定義（`module` 表 status=enabled 的列，通常是固定小數量），' +
                '每筆的 status 依「該模組是否在這個平台的 platform_modules.module_ids 裡」現算 enabled/disabled，' +
                '不是模組定義本身的啟停（2026-08-25 讀 agrabah/src/servers/core_back_office/services/module.ts:64-87 查證）。' +
                'platformId 從 aladdin_admin_platform_management_list_platform_details 取得。' +
                '若 platformId 不存在，後端回 platformNotExists 錯誤（不會回空陣列）。' +
                '回傳的 module id 供 aladdin_admin_module_admin_enable_platform_module / ' +
                'aladdin_admin_module_admin_enable_platform_modules 的 moduleId(s) 參數使用。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_platform_management_list_platform_details 的回傳結果'),
            },
        },
        async ({ platformId }) => {
            const r = await withAutoRelogin(() => remote.coreBackOffice.moduleAdmin.GetPlatformModules(platformId));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, modules: r.data?.modules ?? [] });
        },
    );
}
