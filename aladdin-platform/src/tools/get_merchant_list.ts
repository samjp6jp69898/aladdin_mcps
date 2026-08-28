/**
 * tools/get_merchant_list.ts — aladdin_platform_external_stream_platform_get_merchant_list
 *
 * rajah: ExternalStreamPlatform.GetMerchantList() (row [MerchantData] 1)
 * （rajah/services/external_stream_back_office.rajah:62；`MerchantData` 定義於同檔 2-12 行（service 本體 59-92 行）；
 * service 需要 `@Permission "Room.ExternalStream.MerchantList"`，service 級節點是
 * `Room.ExternalStream`；client 路徑 remote.externalStreamBackOffice.externalStreamPlatform）。
 *
 * ⚠️ **回傳欄位叫 `row` 不是 `rows`**（rajah:62 就是這樣寫的，單數），本 server 其他清單類 tool
 * 幾乎都是 `rows`，照抄會拿到 undefined。本工具在回傳給呼叫端時統一改用 `merchants` 這個名字，
 * 避免呼叫端要記這個單複數例外。
 *
 * method-category-checklist.md 第 0 節排除規則已過：
 * - 非 Placeholder。（**注意同檔尾端的 `placeholderRoomExternalStream()` 是小寫 p**，就是
 *   method-category-checklist.md 第 0 節「反向陷阱」點名的那個真實案例——jasmine 不會跳過它、
 *   會生成可路由的 stub，但後端沒有 override、呼叫必回 notImplemented。本工具與它無關，
 *   這裡記一筆是因為同一個 service 內就有這顆地雷。）
 * - service 沒有 `@NoPublic`。
 * - agrabah 對應實作確認為真實 override：agrabah/src/servers/external_stream_back_office/
 *   services/external_stream_platform.ts:50-61（methodGetMerchantList），實作是
 *   `loadObjects(DbMerchant, 'platform_id = ?', [context.platformId], '', '')`。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——回傳陣列、**完全不分頁**（where 只有
 * platformId，order 與 limit 參數都是空字串）。後端 doc comment 自己也註明「此方法不使用分頁，
 * 直接回傳全部商戶；若未來商戶數量增長，可能需要改為分頁查詢」。判定為可安全全撈的理由：
 * `merchant` 是後台人工新增的合作廠商主檔（唯一寫入路徑是同 service 的 `AddMerchant`），
 * 不是會隨流量成長的歷史/log 表；2026-08-28 dev（PK）實測筆數見下方 README 記錄。
 *
 * ⚠️ **本方法刻意不回傳 `secret`**（`MerchantData` model 只有 id/name/code/status 四個欄位，
 * 沒有 secret 欄位），密鑰要另外呼叫 `GetMerchantSecret`——那支屬
 * method-category-checklist.md 第 8 節「回傳值本身是密鑰」的類別，**沒有**被包成 MCP tool，
 * 詳見該任務的 needs_clarification 記錄。所以用這支拿不到、也不該拿到密鑰。
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetMerchantListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_external_stream_platform_get_merchant_list',
        {
            title: 'List this platform\'s external-stream merchants',
            description:
                '查詢當前平台的第三方直播商戶（external stream merchant）清單' +
                '（rajah: ExternalStreamPlatform.GetMerchantList，需要權限節點 ' +
                'Room.ExternalStream.MerchantList），對應後台「房間管理 > 外部串流商戶管理」。' +
                '不帶任何參數，一次回傳全部、不分頁（商戶主檔是後台人工新增的合作廠商清單，' +
                '不是會隨流量成長的歷史類資料）。' +
                '回傳的 merchants 每筆含：id（供 ' +
                'aladdin_platform_external_stream_platform_toggle_merchant_status 啟停、' +
                'aladdin_platform_external_stream_platform_get_merchant_setting 與 ' +
                'aladdin_platform_external_stream_platform_edit_merchant_setting 讀寫設定時定位用）、' +
                'name（商戶名稱）、code（商戶代碼，廠商端 raw API 請求要帶的 clientCode）、' +
                'status（StatusEnum，1=enabled／2=disabled；商戶被停用後 externalStream 側的 raw ' +
                'endpoint 會拒絕該商戶的所有請求）。' +
                '⚠️ 本清單**不含商戶密鑰**（後端 MerchantData model 根本沒有 secret 欄位），' +
                '密鑰屬敏感資訊、有獨立權限節點，也沒有被包成 MCP tool。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(
                () => remote.externalStreamBackOffice.externalStreamPlatform.GetMerchantList(),
            );
            if (r.failed) return asErrorResult(r);

            // rajah 的回傳欄位是單數 `row`（見檔頭），這裡統一改名成 merchants 回給呼叫端。
            return asTextResult({ success: true, merchants: r.data?.row ?? [] });
        },
    );
}
