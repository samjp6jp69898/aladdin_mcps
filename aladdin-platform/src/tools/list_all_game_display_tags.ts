/**
 * tools/list_all_game_display_tags.ts — aladdin_platform_game_vendor_platform_list_all_game_display_tags
 *
 * rajah: GameVendorPlatform.ListAllGameDisplayTags(search PlatformGameDisplayTagSearch 1, page i32 2, pageSize i32 3)
 * （game_back_office.rajah:1107）——查詢本平台的前端遊戲分類標籤（appDisplay 類型的 game tag），
 * 依 status/name 篩選、支援分頁。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:1413-1455，
 * methodListAllGameDisplayTags）：
 * - **這支 method 沒有 `@Permission`**（緊接在它前面沒有任何 `@Permission` 標註，緊接在它後面的
 *   `UpdateGameTagStatus` 才有 `@Permission "GameVendor.GameSetting.DisplayTag"`），任何已登入
 *   使用者皆可查詢。
 * - 底層先用 `gameTagManager.listGameTags(platformId, GameTagTypeEnum.appDisplay, search.status)`
 *   （`agrabah/src/managers/gameTagManager.ts:306-326`）查該平台 appDisplay 類型的標籤——**status
 *   篩選是在這支 manager 方法內組進 SQL `WHERE status = ?` 做的**，不是應用層；只有 `name` 才是撈出
 *   資料後在應用層（記憶體內）用 `.filter()` + `.toLowerCase().includes()` 做模糊比對。分頁則不論
 *   status 有沒有篩選，都是應用層 `.slice()`，不是 SQL LIMIT/OFFSET。
 * - **`page <= 0`（或不帶 page）時後端會回傳全部、不分頁**（原始碼註解明寫「page <= 0（或未帶）視為
 *   不分頁，回傳全部」），這是官方支援的明確行為，不是繞過限制的取巧用法；page > 0 時才會真的用
 *   `pageSize`（未帶或 0 時 fallback `DefaultPageSize=100`）做 slice 分頁。
 * - `search.status` 型別是 `ActiveStatusEnum`（僅 enabled/disabled 兩態，不是完整 StatusEnum），
 *   對應本 server 既有的 `ACTIVE_STATUS_MAP`（`const.ts`），直接重用不另建新表。
 * - `search.name` 為多語名稱模糊比對（`.toLowerCase().includes()`），非精確查找。
 * - 標籤是遊戲前台分類（如「熱門」「新遊戲」），業務性質上是小型列舉分類表，非會持續大量成長的清單，
 *   後端本身就是整包撈出來再切頁，本工具直接暴露 page/pageSize 給呼叫端（預設 page=0 回傳全部），
 *   不需要額外套用 method-category-checklist.md 第 2 節 B 級的逐頁掃描規則。
 *
 * 純查詢，無寫入，不需要 round-trip 或 prod confirm 機制。
 *
 * **2026-08-25 已通過 dev 實測**（tool 掛進 tools/index.ts 之後，對 pk-platform.alddev.com 用真正
 * 的 MCP stdio Client 打 tools/call，涵蓋 zod schema 驗證與 registerTool handler 本身）：
 * 不帶 page（回傳全部 30 筆，totalPage=1）、依 status 篩選（enabled 剩 21 筆）、依 name 模糊比對
 * （"默認" 命中 1 筆）、page=1+pageSize=1 真分頁（回傳 1 筆、totalPage=30，證實有真的切頁）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameDisplayTagSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerListAllGameDisplayTagsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_list_all_game_display_tags',
        {
            title: "List this platform's front-end game display tags",
            description:
                '查詢本平台的前端遊戲分類標籤（rajah: GameVendorPlatform.ListAllGameDisplayTags，這支 method ' +
                '沒有掛 @Permission，任何已登入使用者皆可查詢）。這是遊戲前台顯示用的分類（如「熱門」「新遊戲」），' +
                '不是 aladdin_platform_game_vendor_platform_list_all_brands 的品牌分類，兩者是不同概念。' +
                '不帶 page（或帶 0）時後端回傳全部標籤、不分頁（後端原始碼明確支援此行為，不是取巧用法）；' +
                'page 帶正整數時才會真的分頁，pageSize 不帶或帶 0 時後端預設 100。' +
                'status 篩選只有 enabled/disabled 兩態（ActiveStatusEnum，不含 frozen/deleted）。' +
                'name 篩選為多語名稱模糊比對，非精確查找。' +
                '純查詢工具，不會寫入任何資料，不需要 prod 二次確認。' +
                '**2026-08-25 已通過 dev 實測**（真正 MCP stdio Client 打 tools/call，涵蓋不分頁全撈、' +
                'status 篩選、name 模糊比對、page>0 真分頁）。',
            inputSchema: {
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('依啟用/停用狀態篩選，不帶則不篩選'),
                name: z.string().optional().describe('依標籤名稱模糊比對（多語系），不帶則不篩選'),
                page: z.number().int().optional().describe('頁碼，從 1 開始；不帶或帶 0（預設）表示不分頁、回傳全部'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，只在 page>0 時生效，不帶或帶 0 時後端預設 100'),
            },
        },
        async ({ status, name, page, pageSize }) => {
            const search = PlatformGameDisplayTagSearch.create({
                status: status ? ACTIVE_STATUS_MAP[ status ] : undefined,
                name: name ?? '',
            });
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListAllGameDisplayTags(search, page ?? 0, pageSize ?? 0));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, tags: r.data?.tags ?? [], totalPage: r.data?.totalPage });
        },
    );
}
