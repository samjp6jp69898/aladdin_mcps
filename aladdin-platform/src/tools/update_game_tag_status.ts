/**
 * tools/update_game_tag_status.ts — aladdin_platform_game_vendor_platform_update_game_tag_status
 *
 * rajah: GameVendorPlatform.UpdateGameTagStatus(tagType GameTagTypeEnum 1, tag i32 2, newStatus StatusEnum 3)
 * （game_back_office.rajah:1113，@Permission "GameVendor.GameSetting.DisplayTag"）——切換單一遊戲
 * 標籤（`platform_game_tags`）的啟用/停用狀態，用 `tagType + tag` 這組複合鍵定位，不是內部流水號 id。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:1472-1494，
 * methodUpdateGameTagStatus）：
 * - **`tagType` 不限於 appDisplay**：`GameTagTypeEnum` 共 4 個值（vendorFee=1/appDisplay=2/rebate=3/
 *   frontendGroup=4，game_back_office.rajah:43-52），程式碼裡有一段被註解掉的「只允許 appDisplay」
 *   檢查（`// only support app display now` + 註解掉的 if），代表目前實際允許呼叫端對任何 tagType
 *   呼叫。
 * - 直接用 `UPDATE platform_game_tags SET status=? WHERE platform_id=? AND tag_type=? AND tag=?`，
 *   查詢條件正確帶 `platform_id`（無跨租戶風險），且明確檢查 `updateResult.data === 0` 時回
 *   `ErrorCode.objectNotFound`——跟姊妹方法 `UpdateGameVendorMaintenanceStatus`（同 service 但不同
 *   model，那支忘記檢查 affectedRows）不同，這支沒有「不存在組合靜默成功」的風險。
 * - `newStatus` 由程式碼自行驗證（`!StatusEnum.hasOwnProperty(newStatus) || newStatus === StatusEnum.last`
 *   才拒絕），不是依賴 rajah 框架層的 enum decode。
 * - `platform_game_tags` 資料表有 `updated_at TIMESTAMP ... ON UPDATE CURRENT_TIMESTAMP`
 *   （migrations/game/202510211501_create_game_tags.sql），理論上同值呼叫仍會讓 MySQL 判定該列
 *   有變更、`affectedRows>0`，不會被誤判成 objectNotFound。
 *
 * **預讀/讀回依 tagType 分流（2026-08-25 review 修正）**：原草稿誤以為「除了 appDisplay 以外沒有
 * 對應查詢方法」而放棄全部 4 種 tagType 的預讀/讀回，經獨立 review 指出這與事實不符，修正如下：
 * - `appDisplay` → `GameVendorPlatform.ListAllGameDisplayTags`（game_back_office.rajah:1107，回傳
 *   `PlatformGameDisplayTag[]`，含 `@Hide status` 欄位，`@Hide` 只影響後台表單顯示、API 仍回傳）
 * - `rebate` → `GameVendorPlatform.ListAllGameRebateTags`（game_back_office.rajah:1129，簽名
 *   `(page, pageSize)`，無 search 參數，回傳 `PlatformGameTag[]`，含 `@Hide status` 欄位）
 * - `frontendGroup` → `GameVendorPlatform.ListAllGameFrontendGroupTags`（game_back_office.rajah:1140，
 *   簽名 `(search, page, pageSize)`，回傳 `PlatformGameTag[]`，含 `@Hide status` 欄位）
 * - **`vendorFee` 真的沒有對應查詢 RPC**（全檔搜尋找不到 `ListAllGameVendorFeeTags` 或同類方法），
 *   這種類型無法預讀/讀回驗證，本工具會照常呼叫底層 RPC（後端本身的 platform 範圍過濾 + affectedRows
 *   檢查已足夠防呆），但 readBack 會回傳 null 並附註原因。
 * - 三支查詢 RPC 都不是掛好的 MCP tool（除了 `ListAllGameDisplayTags` 已包成
 *   `aladdin_platform_game_vendor_platform_list_all_game_display_tags`），本工具直接呼叫底層
 *   `remote.gameBackOffice.gameVendorPlatform.*`，比照其他狀態切換工具（如 `update_brand_status.ts`
 *   呼叫 `ListAllBrands`）的既有模式，不需要每個查詢都先包成獨立 MCP tool 才能內部使用。
 *
 * **2026-08-25 已通過 dev 實測**（tool 掛進 tools/index.ts 之後，對 pk-platform.alddev.com 用真正
 * 的 MCP stdio Client 打 tools/call，涵蓋 zod schema 驗證與 registerTool handler 本身；用
 * tagType=appDisplay、tag=1（電子分類）測試）：不存在的 tag（999999）回 errorCode=14（非靜默成功）、
 * status=unknown（合法列舉值 0）成功寫入並讀回確認、同值呼叫成功、round-trip 切換 disabled→enabled
 * 並讀回驗證、測完額外用 list_all_game_display_tags 重新查詢確認 tag=1 的 status 已復原為 1
 * （enabled），全程無殘留髒資料。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
    PlatformGameDisplayTagSearch,
    GameFrontendGroupTagSearch,
} from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

const TAG_TYPE_KEYS = [ 'vendorFee', 'appDisplay', 'rebate', 'frontendGroup' ] as const;
const TAG_TYPE_MAP: Record<(typeof TAG_TYPE_KEYS)[number], number> = {
    vendorFee: 1,
    appDisplay: 2,
    rebate: 3,
    frontendGroup: 4,
};

/** 依 tagType 分流查詢現值；vendorFee 沒有對應查詢 RPC，回傳 null。 */
async function findTagStatus(tagType: (typeof TAG_TYPE_KEYS)[number], tag: number): Promise<{ failedResult?: { errorCode: number; message: string }; row: { tag?: number | null; status?: number | null } | null; noQueryAvailable: boolean }> {
    if (tagType === 'appDisplay') {
        const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameDisplayTags(PlatformGameDisplayTagSearch.create({}), 0, 0));
        if (r.failed) return { failedResult: r, row: null, noQueryAvailable: false };
        return { row: (r.data?.tags ?? []).find((row) => row.tag === tag) ?? null, noQueryAvailable: false };
    }
    if (tagType === 'rebate') {
        const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameRebateTags(0, 0));
        if (r.failed) return { failedResult: r, row: null, noQueryAvailable: false };
        return { row: (r.data?.tags ?? []).find((row) => row.tag === tag) ?? null, noQueryAvailable: false };
    }
    if (tagType === 'frontendGroup') {
        const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameFrontendGroupTags(GameFrontendGroupTagSearch.create({}), 0, 0));
        if (r.failed) return { failedResult: r, row: null, noQueryAvailable: false };
        return { row: (r.data?.tags ?? []).find((row) => row.tag === tag) ?? null, noQueryAvailable: false };
    }
    // vendorFee：無對應查詢 RPC
    return { row: null, noQueryAvailable: true };
}

export function registerUpdateGameTagStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_update_game_tag_status',
        {
            title: 'Update a game tag\'s status by tagType+tag composite key',
            description:
                '切換單一遊戲標籤的啟用/停用狀態（rajah: GameVendorPlatform.UpdateGameTagStatus，需要權限節點 ' +
                'GameVendor.GameSetting.DisplayTag），用 tagType+tag 這組複合鍵定位，不是內部流水號 id。' +
                'tagType 合法值：vendorFee(廠商殺數分類)/appDisplay(前端顯示分類)/rebate(返水分類)/' +
                'frontendGroup(前台自訂標籤)。' +
                '本工具會依 tagType 呼叫對應的底層查詢 RPC 做預讀（供同值短路）與寫入後讀回驗證：' +
                'appDisplay 用 ListAllGameDisplayTags（也可另外呼叫 ' +
                'aladdin_platform_game_vendor_platform_list_all_game_display_tags 查完整清單）、rebate 用 ' +
                'ListAllGameRebateTags、frontendGroup 用 ListAllGameFrontendGroupTags——**唯獨 vendorFee 沒有' +
                '對應的查詢 RPC**，這個類型無法預讀/短路/讀回驗證，readBack 固定回 null 並附註原因，寫入本身' +
                '仍會照常執行、依賴後端自身的 platform 範圍過濾與 affectedRows 檢查防呆。' +
                'tag+tagType 組合不存在（或存在但不屬於當前平台）時回明確錯誤，不是靜默成功。' +
                'newStatus 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般啟用/' +
                '停用用 enabled/disabled。目標狀態與現值相同時（僅限有查詢 RPC 的 3 種 tagType 才能判斷）' +
                '仍會照常呼叫後端（不像其他工具會短路），因為經 dev 實測確認同值呼叫本來就會成功，短路純屬' +
                '選配優化，這裡優先保持四種 tagType 呼叫路徑一致，不個別分岔。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**2026-08-25 已通過 dev 實測**（真正 MCP stdio Client 打 tools/call，用 appDisplay 既有標籤' +
                '測試，涵蓋不存在 tag、合法邊界值 status=unknown(0)、同值呼叫、round-trip 切換 + 復原 + ' +
                '讀回驗證，測完確認無殘留髒資料）。',
            inputSchema: {
                tagType: z.enum(TAG_TYPE_KEYS).describe('標籤類型：vendorFee/appDisplay/rebate/frontendGroup'),
                tag: z.number().int().describe('標籤編號；appDisplay/rebate/frontendGroup 可透過對應查詢 RPC 取得合法值（appDisplay 見 aladdin_platform_game_vendor_platform_list_all_game_display_tags），vendorFee 目前無對應查詢工具'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ tagType, tag, status, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            const before = await findTagStatus(tagType, tag);
            if (before.failedResult) return asErrorResult(before.failedResult);

            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateGameTagStatus(TAG_TYPE_MAP[ tagType ], tag, targetStatus));
            if (r.failed) return asErrorResult(r);

            if (before.noQueryAvailable) {
                return asTextResult({
                    success: true,
                    message: '更新成功',
                    readBack: null,
                    note: 'tagType=vendorFee 沒有對應的查詢 RPC，無法讀回驗證，僅能確認底層 RPC 回傳成功',
                });
            }

            const after = await findTagStatus(tagType, tag);
            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: after.row ?? { note: '讀回清單中沒找到這個 tag，非預期，請人工確認' },
            });
        },
    );
}
