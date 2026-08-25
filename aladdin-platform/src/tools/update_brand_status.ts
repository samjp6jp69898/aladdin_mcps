/**
 * tools/update_brand_status.ts — aladdin_platform_game_vendor_platform_update_brand_status
 *
 * rajah: GameVendorPlatform.UpdateBrandStatus(brandId i32 1, newStatus StatusEnum 2)
 * （game_back_office.rajah:1101，@Permission "GameVendor.GameSetting.Brand.Status.Toggle"）——
 * 切換單一遊戲品牌的啟用/停用狀態。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:1378-1394，
 * methodUpdateBrandStatus）：
 * - 先用 `loadObject(DbPlatformGameBrand, 'platform_id = ? AND id = ?', ...)` 確認品牌存在且屬於
 *   當前平台，**這次有正確檢查 `!loadResult.data`**、查不到明確回 `ErrorCode.objectNotFound`
 *   （跟同 service 的 `CreateOrUpdateBrands` 不同——那支漏了這個 null 檢查，已在 mcp-rajah-tasks
 *   標記 needs_clarification 並回報疑似跨租戶寫入風險，本方法沒有這個問題，可放心處理）。
 * - 確認存在後改用 `updateStatus()` helper（`common/database_helper.ts`，跟 `UpdateGameVendorStatus`/
 *   `UpdateGameVendorGameStatus` 同一套，WHERE 有帶 platformId），不是裸 UPDATE，沒有姊妹方法
 *   `UpdateGameVendorMaintenanceStatus` 那種「不存在 id 靜默成功」的風險。
 * - `PlatformGameBrandEdit`（`GetBrandForEdit` 的回傳型別）**沒有 status 欄位**，無法用它讀現值；
 *   改用 `ListAllBrands`（`PlatformGameBrandEssential` 含 status 欄位）當唯讀基準——品牌是廠商底下
 *   再細分的子分類，預期是小型列舉規模（`list_all_brands.ts` 開發時 dev 環境無篩選查詢實測回傳
 *   23 筆；獨立 review 另外用 CQA 唯讀 DB 對 `game.platform_game_brands` 做過 COUNT，各平台最多 37
 *   筆，量級一致），用 pageSize=100（後端 fallback 值）不分頁一次撈取即可涵蓋全部，不套用第 2 節
 *   B 級分頁掃描規則。
 *
 * **2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 用真正的 MCP stdio Client 打
 * tools/call，涵蓋 zod schema 驗證與 registerTool handler 本身）：不存在的 brandId 回明確錯誤
 * （非靜默成功）、非法列舉值回錯誤、round-trip 切換 enabled/disabled 並復原、同值呼叫短路。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameBrandEssentialSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

async function findBrandById(brandId: number) {
    const search = PlatformGameBrandEssentialSearch.create({ gameVendorId: 0, tag: -1, title: '' });
    const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllBrands(1, search, 100));
    if (r.failed) return { failedResult: r, matchedRow: undefined } as const;
    const matchedRow = r.data?.rows?.find((row) => row.id === brandId);
    return { failedResult: undefined, matchedRow, allRows: r.data?.rows ?? [] } as const;
}

export function registerUpdateBrandStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_update_brand_status',
        {
            title: "Update a game brand's status",
            description:
                '把某個遊戲品牌的啟用/停用狀態改成指定值（rajah: GameVendorPlatform.UpdateBrandStatus，需要權限節點 ' +
                'GameVendor.GameSetting.Brand.Status.Toggle）。brandId 用 aladdin_platform_game_vendor_platform_list_all_brands ' +
                '回傳的 id 欄位取得。status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/' +
                '停用只會用到 enabled/disabled。brandId 不存在（或存在但不屬於當前平台）時明確回錯誤，不是靜默成功。' +
                '目標狀態與現值相同時直接呼叫後端也會成功，本工具仍先讀現值、相同則短路不呼叫後端，純粹省一次寫入 RPC。' +
                '這支 RPC 沒有帶 status 的單筆查詢方法（GetBrandForEdit 沒有 status 欄位），寫入前後皆改用 ' +
                'aladdin_platform_game_vendor_platform_list_all_brands（本平台品牌數量為小型列舉規模，一次查全部）比對 ' +
                'brandId 讀現值與讀回驗證。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**2026-08-25 已通過 dev 實測**（真正 MCP stdio Client 打 tools/call，涵蓋不存在 brandId、' +
                'round-trip 切換 + 復原、同值短路）。',
            inputSchema: {
                brandId: z.number().int().describe('品牌的內部流水號 id，來自 aladdin_platform_game_vendor_platform_list_all_brands 的回傳 id 欄位'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ brandId, status, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            const found = await findBrandById(brandId);
            if (found.failedResult) return asErrorResult(found.failedResult);
            if (!found.matchedRow) {
                return asTextResult({
                    success: false,
                    message: `brandId=${ brandId } 沒有出現在本平台的品牌清單裡（可能不存在，或屬於別的平台）`,
                });
            }
            if (found.matchedRow.status === targetStatus) {
                return asTextResult({ success: true, message: '目標狀態與現值相同，未呼叫後端 RPC', readBack: found.matchedRow });
            }

            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateBrandStatus(brandId, targetStatus));
            if (r.failed) return asErrorResult(r);

            const after = await findBrandById(brandId);
            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: after.matchedRow ?? { note: '讀回清單中沒找到這個 id，非預期，請人工確認' },
            });
        },
    );
}
