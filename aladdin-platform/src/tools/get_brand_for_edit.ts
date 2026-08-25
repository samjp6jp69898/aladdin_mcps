/**
 * tools/get_brand_for_edit.ts — aladdin_platform_game_vendor_platform_get_brand_for_edit
 *
 * rajah: GameVendorPlatform.GetBrandForEdit(id i32 1) (brand PlatformGameBrandEdit 1)
 * （game_back_office.rajah:1097，@Permission "GameVendor"）——讀取本平台單一遊戲品牌的
 * 編輯用資料，是 `CreateOrUpdateBrands`（尚未包成 MCP tool）的讀現值搭配方法。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/game_back_office/services/
 * game_vendor_platform.ts:1271-1291，methodGetBrandForEdit）：
 * - 查詢條件是 `platform_id = ? AND id = ?`（`context.platformId` + 呼叫端傳入的 id），
 *   **確實有做租戶隔離**：id 存在但屬於別的平台時，這個查詢直接查不到，不會誤讀到別平台的品牌。
 * - 查不到時明確回 `ErrorCode.idNotExists`，不是靜默回空物件或誤報成功，行為可信賴。
 * - 找到後另外呼叫 `localizationManager.assignLocalizations()` 補上多語系欄位（title 等
 *   `[LocalizationString]` 欄位），這一步失敗會讓整支呼叫回錯誤，不會回傳語系不完整的部分資料。
 * - `PlatformGameBrandEdit`（rajah:684-700）欄位：id/title(多語)/code/gameVendorId/tag/
 *   squareImage/rectangleImage/bannerImage(皆多語)，**沒有 status 欄位**（品牌啟用/停用狀態
 *   要另外呼叫姊妹方法 `UpdateBrandStatus`／清單版的 `ListAllBrands` 才看得到），也沒有任何
 *   密鑰/PII 欄位，不需要遮罩。
 *
 * **2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 用真正的 MCP stdio Client 打
 * tools/call，涵蓋 zod schema 驗證與 registerTool handler 本身；tool 已掛進 tools/index.ts
 * 後才測，確認真的能透過 tools/list 找到、透過 tools/call 呼叫得到）：存在的 id 回傳完整資料；
 * 不存在的 id（999999999）與 id=0 皆回傳 `errorCode=11`（genie 通用碼 idNotExists，不在
 * AgrabahErrorCodeEnum 業務碼範圍內，errorName 顯示"(未知錯誤碼)"是正常現象），非靜默空值。
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetBrandForEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_get_brand_for_edit',
        {
            title: 'Get one game brand\'s edit detail by id',
            description:
                '用品牌 id 讀取本平台單一遊戲品牌的編輯用資料（rajah: GameVendorPlatform.GetBrandForEdit）——' +
                'title（多語系名稱）、code（品牌代碼）、gameVendorId（所屬廠商）、tag（分類）、' +
                'squareImage/rectangleImage/bannerImage（皆多語系圖片）。**沒有 status 欄位**，品牌啟用/停用' +
                '狀態要用 aladdin_platform_game_vendor_platform_list_all_brands 查。' +
                'id 用 aladdin_platform_game_vendor_platform_list_all_brands 回傳的 id 欄位取得。' +
                '後端查詢有帶當前平台 id 做過濾，id 存在但屬於別的平台時查不到（不會誤讀到別平台資料）；' +
                'id 不存在（含 id=0）時回 errorCode=11（idNotExists，dev 實測確認），不是靜默回空值。' +
                '純讀取查詢，不會修改任何資料，可安全重複呼叫。' +
                '**2026-08-25 已通過 dev 實測**（真正 MCP stdio Client 打 tools/call，涵蓋存在 id、不存在 id、' +
                'id=0 三種情境）。',
            inputSchema: {
                id: z.number().int().describe('品牌的內部流水號 id，來自 aladdin_platform_game_vendor_platform_list_all_brands 的回傳 id 欄位'),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetBrandForEdit(id));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, brand: r.data?.brand ?? null });
        },
    );
}
