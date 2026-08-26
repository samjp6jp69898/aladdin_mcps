/**
 * tools/list_all_brands.ts — aladdin_platform_game_vendor_platform_list_all_brands
 *
 * rajah: GameVendorPlatform.ListAllBrands(page i32 1, search PlatformGameBrandEssentialSearch 4, pageSize i32 5)
 * （game_back_office.rajah:1095）——查詢本平台的遊戲品牌清單（廠商底下再細分的品牌分類，
 * 例如同一家廠商旗下的不同子廠牌），依 gameVendorId/tag/title 篩選、支援分頁。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:1186-1230，
 * methodListAllBrands）：
 * - **這支 method 沒有 `@Permission`**（rajah 原始碼裡該行是 `# @Permission "GameVendor"`，
 *   整行被註解掉，不是遺漏——`GetBrandForEdit`/`CreateOrUpdateBrands`/`UpdateBrandStatus` 這幾支
 *   姊妹方法都掛著正常的 `@Permission`，只有這支查詢方法沒掛，判斷是刻意設計成任何已登入使用者
 *   皆可查詢），因此本工具的呼叫前提只需要一般登入態，不需要額外核對特定權限節點。
 * - 查詢固定加上 `pgb.platform_id = ? AND gv.status = enabled` 兩個條件——只回傳當前平台、且母表
 *   廠商狀態為 enabled 的品牌，母表廠商已停用時其底下品牌不會出現在清單裡（即使品牌本身狀態是
 *   enabled）。
 * - `search.tag`：**-1 是「全部」的哨兵值，0 是合法的實際分類值**（程式碼原文即有此提醒，`tag !== -1`
 *   才加篩選條件），不可用一般的 truthy/falsy 判斷語意，本工具的 zod schema 預設值與說明都需明確
 *   呼應這點。
 * - `search.gameVendorId`：有值（非 0）才加篩選；`search.title`：trim 後有內容才加篩選，走
 *   `DbIdLocalization` 的 `LIKE %value%` 模糊比對多語系標題，不是精確比對，也不保證能唯一鎖定
 *   單一品牌——比照 method-category-checklist.md 第 2 節，這個 search 沒有 id/ids/code 這類能
 *   保證鎖定單一目標的欄位，屬於清單查詢工具，不是「用業務鍵查特定一筆」的定位工具，本工具維持
 *   原始分頁語意直接暴露給呼叫端，不做內部自動掃描到底（跟 `list_vendor_games.ts` 的既有慣例一致）。
 * - `pageSize` 是裸 `i32`（非 `PageSizeEnum`），未帶或帶 0 時後端 fallback 成 `DefaultPageSize=100`，
 *   沒有伺服器端強制上限——本平台品牌數量預期是小型列舉規模（廠商底下細分品牌，遠小於遊戲數量），
 *   但呼叫端仍應自行控制 pageSize、不要假設一次拿得到全部。
 * - 回傳 `PlatformGameBrandEssential`（rajah:649-668）含 `code`（品牌代碼，供之後呼叫
 *   `GetBrandForEdit`/`CreateOrUpdateBrands` 等姊妹方法時核對用，本身不是查詢鍵）、`title`/
 *   `squareImage`/`rectangleImage`/`bannerImage` 皆為多語系陣列、`status`（品牌自身的啟用狀態，
 *   跟前面提到的母表廠商 enabled 過濾條件是兩回事）。
 *
 * **2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 用真正的 MCP stdio Client 打
 * tools/call，涵蓋 zod schema 驗證與 registerTool handler 本身）：無篩選條件查全部、依 gameVendorId
 * 篩選、依 tag=-1（全部）與帶入實際 tag 值篩選、依 title 模糊比對，皆回傳符合條件的資料；空篩選
 * 條件（title 打一個必定不存在的字串）正確回傳 0 筆而非報錯。純查詢，無寫入，不需要 round-trip 或
 * prod confirm 機制。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameBrandEssentialSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListAllBrandsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_list_all_brands',
        {
            title: "List this platform's game brands",
            description:
                '查詢本平台的遊戲品牌清單（rajah: GameVendorPlatform.ListAllBrands，這支 method 沒有掛 ' +
                '@Permission，任何已登入使用者皆可查詢）。品牌是廠商底下再細分的子分類（例如同一家廠商旗下的' +
                '不同子廠牌），不是廠商本身——廠商清單請用 aladdin_platform_game_vendor_platform_list_game_vendors。' +
                '固定只回傳當前平台、且所屬廠商（母表）狀態為 enabled 的品牌；廠商母表已停用時其底下品牌不會出現，' +
                '即使品牌自身的 status 是 enabled。' +
                'gameVendorId 篩選：不帶或帶 0 視為不篩選（查全部廠商的品牌）。' +
                'tag 篩選：-1（預設）表示不篩選（查全部分類）；0 是合法的實際分類值，不是「未設定」，若要查詢 ' +
                'tag=0 的品牌請明確帶 0，不要因為它是假值就省略。' +
                'title 篩選：對多語系標題做 LIKE 模糊比對，不是精確比對，也不保證能唯一鎖定單一品牌——本工具' +
                '直接暴露原始分頁結果，不做自動掃描定位，找不到就是空陣列，不是報錯。' +
                'pageSize 不帶或帶 0 時後端預設 100，沒有伺服器端強制上限，但仍建議自行控制頁面大小，不要假設' +
                '一次能拿到全部資料。' +
                '純查詢工具，不會寫入任何資料，不需要 prod 二次確認。' +
                '**2026-08-25 已通過 dev 實測**（真正 MCP stdio Client 打 tools/call，涵蓋無篩選、' +
                'gameVendorId 篩選、tag 篩選（含 -1 與實際值）、title 模糊比對、空結果情境）。',
            inputSchema: {
                gameVendorId: z.number().int().optional().describe('依廠商 id 篩選（來自 aladdin_platform_game_vendor_platform_list_game_vendors），不帶或帶 0 表不篩選'),
                tag: z.number().int().optional().describe('依分類 id 篩選（PlatformGameDisplayTag 的 tag），-1 或不帶表示查全部；0 是合法的實際分類值，需要查它時要明確帶 0'),
                title: z.string().optional().describe('依品牌標題模糊比對（LIKE %value%，多語系），不帶則不篩選'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，不帶或帶 0 時後端預設 100'),
            },
        },
        async ({ gameVendorId, tag, title, page, pageSize }) => {
            const search = PlatformGameBrandEssentialSearch.create({
                gameVendorId: gameVendorId ?? 0,
                tag: tag ?? -1,
                title: title ?? '',
            });
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllBrands(page ?? 1, search, pageSize ?? 0));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
