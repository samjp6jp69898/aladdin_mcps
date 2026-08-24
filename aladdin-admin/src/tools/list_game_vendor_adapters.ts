/**
 * tools/list_game_vendor_adapters.ts — aladdin_admin_game_vendor_admin_list_adapters
 *
 * rajah: GameVendorAdmin.ListAdapters（game_back_office.rajah:309，無參數，
 * 回傳 `adapters [string] 1`）——實測與命名符合、非 Placeholder，agrabah 端
 * 有真實 override（agrabah/src/servers/game_back_office/services/game_vendor_admin.ts
 * :247 `methodListAdapters`，回傳 `Array.from(GameVendorAdapters.keys())`）。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」的「完全不分頁的全撈」子情境）：
 * 無 page/pageSize、無 search 參數，回傳單一字串陣列。底層不是 DB 表，是
 * agrabah/src/servers/game/game_vendor_adapters/index.ts 裡靜態註冊的 adapter class
 * 清單（目前 37 個，逐一 import 寫死在原始碼），只會隨部署新增，不會隨營運資料成長，
 * 不適用 B 級（範圍鍵+分頁無法鎖定目標）的逐頁掃描強制要求，可安全一次全撈。
 *
 * 前提依賴 / 用途：這是 rajah `model GameVendorEdit` 的 `adapter string 2`
 * （game_back_office.rajah:180-181，帶 `@Type "Select:GameVendorAdapter"` +
 * `@Rules "Required"`）欄位的合法值來源——也就是本 server
 * aladdin_admin_game_vendor_admin_create_or_update_game_vendor（create_game_vendor.ts）
 * 與 aladdin_admin_game_vendor_admin_list_game_vendors（list_game_vendors.ts）兩支既有
 * tool 目前只能引用 const.ts 的 KNOWN_ADAPTERS 靜態快照（檔頭註明「2026-08-18 實測、
 * 可能隨時間增加，非窮舉」）。本工具改成即時查詢後端真正的清單，呼叫前若不確定
 * adapter 合法值，應優先呼叫本工具取得當下實際清單，而不是依賴 KNOWN_ADAPTERS 這份
 * 可能過時的快照。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListGameVendorAdaptersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_list_adapters',
        {
            title: 'List valid game vendor adapter codes',
            description:
                '列出後端目前已註冊的三方遊戲廠商 adapter 代碼清單（rajah: GameVendorAdmin.ListAdapters，' +
                'game_back_office.rajah:309）。無任何輸入參數，一次回傳全部；底層不是 DB 表，是原始碼裡靜態註冊的 ' +
                'adapter 清單，只會隨部署變動，不需要分頁。' +
                '用途：建立/更新三方場館時（aladdin_admin_game_vendor_admin_create_or_update_game_vendor 的 adapter 欄位、' +
                'aladdin_admin_game_vendor_admin_list_game_vendors 的 adapter 篩選條件）必須填入這裡回傳的其中一個值，' +
                '填入清單外的字串會被後端拒絕。這份清單是即時查詢，比那兩支 tool description 裡引用的 KNOWN_ADAPTERS ' +
                '常數快照（2026-08-18 實測記錄，可能已過時）更可靠，呼叫前不確定合法值時應優先用本工具。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListAdapters());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, adapters: r.data?.adapters ?? [] });
        },
    );
}
