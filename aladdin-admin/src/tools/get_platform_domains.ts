/**
 * tools/get_platform_domains.ts — aladdin_admin_core_admin_get_platform_domains
 *
 * rajah: CoreAdmin.GetPlatformDomains(platformId i32 1) (rows [PlatformDomain] 1, totalPage i32 2)
 * （rajah/services/core.rajah:224-225，需要權限節點 PlatformManagementAdmin.PlatformList.Domain）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic（service CoreAdmin
 * 沒有 @NoPublic，本方法本身也沒有；只有同 service 內的 CreatePlatform 才有 method 級 @NoPublic）；
 * agrabah 對應實作 agrabah/src/servers/core_back_office/services/core_admin.ts:179-195
 * （methodGetPlatformDomains）確認有真實實作，非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——雖然回傳型別有 `totalPage`，但
 * 2026-08-25 讀源碼查證：後端 `response.totalPage = 1`（core_admin.ts:192）是寫死的常數，這支
 * method 沒有真正分頁（一次撈出 `platform_id = ? AND gate_id IN (agent, platform)` 全部符合的列，
 * 無 LIMIT），`totalPage` 欄位是遺留的回傳格式、不代表真的有分頁機制。本工具如實回傳
 * `totalPage`，但 description 會說明它恆為 1、不能拿來判斷是否還有下一頁。
 *
 * 2026-08-25 讀源碼查證：
 * - 只查詢 `gate_id IN (agent, platform)` 的域名（DbDomain 表），**不含 App 端域名**。App 端域名
 *   由另一支 `CorePlatform.GetAppDomains`（rajah/services/core.rajah:285-286）管理，**這支其實是
 *   公開 method**（`@Permission "AdminManagement.Domain.AppDomain"`），只是本輪未包裝，不是內部
 *   不開放——真正 method 級 @NoPublic 的是同 service 的 `CreateOrUpdateAppDomain`（core.rajah:288-289）。
 *   （易混淆點：另有一支同名 `Core.GetAppDomains`，core.rajah:177，屬於整個 service 級 @NoPublic 的
 *   `service Core`，core.rajah:167——這支才是真的內部 RPC，跟 `CorePlatform.GetAppDomains` 是兩支
 *   不同的 method，命名規則要求的「連 service 一起確認」在此有實際踩坑意義。）
 * - `domainType` 由後端依 `gate_id` 動態計算（PlatformDomainTypeEnum：platform=1/agent=2/
 *   promotion=3，rajah/services/core.rajah:203-207），這支 method 只會回傳 platform/agent 兩種值，
 *   promotion 不會出現在這支的回傳裡（core_admin.ts:188 的三元判斷只有 platform/agent 兩個分支）。
 * - `updatedAtTimestamp`/`createdAtTimestamp` 是 i64，經 protobufjs decode 可能是 Long 物件，已用
 *   `toPlainNumber()` 轉換。
 * - platformId 不存在時：目前查詢條件只是普通 WHERE 過濾，不存在的 platformId 會回空陣列，不是
 *   錯誤（未見任何存在性檢查程式碼）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

export function registerGetPlatformDomainsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_core_admin_get_platform_domains',
        {
            title: 'List a platform\'s platform/agent gate domains',
            description:
                '列出指定平台底下的域名清單（rajah: CoreAdmin.GetPlatformDomains，需要權限節點 ' +
                'PlatformManagementAdmin.PlatformList.Domain）。只包含 platform/agent 兩種 gate 的域名' +
                '（domainType: platform=1/agent=2），**不含 App 端域名**（App 端域名是另一支公開 method ' +
                'CorePlatform.GetAppDomains，只是本輪未包裝，不是內部不開放）。' +
                'platformId 從 aladdin_admin_platform_management_list_platform_details 取得；不存在的 ' +
                'platformId 會回空陣列，不是錯誤。' +
                '回傳的 totalPage 恆為 1（後端寫死，非真實分頁機制），不能拿來判斷是否還有更多資料——' +
                '這支 method 本身就是一次撈出全部符合條件的列，沒有分頁。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_platform_management_list_platform_details 的回傳結果'),
            },
        },
        async ({ platformId }) => {
            const r = await withAutoRelogin(() => remote.coreBackOffice.coreAdmin.GetPlatformDomains(platformId));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
