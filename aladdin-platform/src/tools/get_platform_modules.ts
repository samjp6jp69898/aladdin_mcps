/**
 * tools/get_platform_modules.ts — aladdin_platform_module_platform_get_platform_modules
 *
 * rajah: ModulePlatform.GetPlatformModules（module.rajah:39，無 @Permission，
 * 任何登入平台後台的使用者皆可查詢）
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetPlatformModulesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_module_platform_get_platform_modules',
        {
            title: "List this platform's enabled modules",
            description:
                '查詢目前登入的平台已啟用的模組清單（rajah: ModulePlatform.GetPlatformModules，module.rajah:39，' +
                '無 @Permission，任何登入平台後台的使用者皆可查詢）。無參數，後端用 context.platformId 自動取得' +
                '目前登入身分所屬的平台，不需要也不接受 platformId 參數。' +
                '2026-08-25 讀 agrabah/src/servers/core_back_office/services/module_platform.ts:34-53 查證：' +
                '回傳的 PlatformModuleLite（僅 id + name）只含已啟用的模組，不含已停用的——與 aladdin-admin 的 ' +
                'aladdin_admin_module_admin_get_platform_modules 不同：admin 端回傳全部模組（含 enabled/disabled ' +
                '狀態），platform 端只回傳已啟用的子集，且欄位更精簡。若要調整平台模組啟停，需改用 aladdin-admin 的 ' +
                'aladdin_admin_module_admin_enable_platform_module / aladdin_admin_module_admin_enable_platform_modules' +
                '——platform 後台本身沒有寫入模組啟停的能力。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.coreBackOffice.modulePlatform.GetPlatformModules());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, modules: r.data?.modules ?? [] });
        },
    );
}
