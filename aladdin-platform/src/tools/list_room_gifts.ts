/**
 * tools/list_room_gifts.ts — aladdin_platform_room_gift_platform_list_room_gifts
 *
 * rajah: RoomGiftPlatform.ListRoomGifts() (rows [RoomGiftProduct] 1)
 * （rajah/services/room_gift_back_office.rajah:253，service 定義於同檔 245-263 行，
 * @LoginRequired + @Module "Room.RoomGift"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah
 * 對應 Service（agrabah/src/servers/room_back_office/services/room_gift_platform.ts，
 * methodListRoomGifts）確認有真實實作（呼叫 RoomGiftManager.getRoomGiftProducts），非
 * base class 的 notImplemented。分類：第 1 節簡化版（無參數、小型列舉規模，全撈安全）。
 *
 * 業務語意：直播間送禮商品清單（後台「送禮管理 > 禮物列表」頁面、以及送禮紀錄搜尋條件的
 * 禮物下拉選單用）。icon/name 是多語系陣列（LocalizationString[]）。
 *
 * **2026-08-25 review 發現並修正的錯誤描述——exchangeAmount 是 stored 值，不是顯示值**：
 * `getRoomGiftProducts`（room_gift_manager.ts:277-292）透過內部 RPC
 * `GetCategoryModuleProducts` 取得 `MallProduct`，該 model 的金額欄位（含 exchangeAmount）
 * 依 agrabah 各 server 底下 services/inventory_back_office_internal.ts:41 檔頭註解明文
 * 「MallProduct 內金額（amount/exchangeAmount/wageringMultiplier）皆為 stored value」，
 * 本工具原本誤寫成「已算好的顯示值」，已更正。rajah model 對應欄位標 `@Type "Currency"`
 * （依 obsidian/Rules/Currency @Type 標註規範.md，語意就是 wire 上為 stored 值），換算成
 * 顯示值需依該筆 code（幣別代碼）的 decimalPlaces 用 `Exchange.storedToNormalByCurrency`
 * （常見 ÷10000，但不同幣別 decimalPlaces 不同時係數不同），本工具不做這個換算（沒有額外
 * RPC 可查每個 code 的 decimalPlaces），呼叫端需自行依 code 換算。
 *
 * i64 欄位處理：`id` 是 i32（非 i64，不需 toPlainNumber）；`exchangeAmount` 是
 * `CurrencyLink[]`，其中 `value` 是 i64，經 protobufjs decode 可能是 Long 物件，已用
 * `toPlainCurrencyLinks()` 轉換（2026-08-25 review 發現原本漏轉，已修正）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainCurrencyLinks } from '../const.ts';

export function registerListRoomGiftsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_list_room_gifts',
        {
            title: 'List live-streaming room gift products',
            description:
                '列出本平台直播間送禮的禮物商品清單（rajah: RoomGiftPlatform.ListRoomGifts，無參數）。' +
                'icon/name 是多語系陣列（[{code, value}]）；exchangeAmount 是多幣別價格陣列（CurrencyLink[]，' +
                '[{code, value}]）——**value 是 stored 值，不是人類可讀金額**（依 code 幣別的精度縮放，' +
                '常見 ÷10000，但不同幣別可能不同），本工具不做換算，呼叫端需自行依 code 換算成顯示金額。' +
                'id 可用於 aladdin_platform_room_gift_platform_list_records 的 productIds 篩選條件。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomGiftPlatform.ListRoomGifts());
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                exchangeAmount: toPlainCurrencyLinks(row.exchangeAmount),
            }));

            return asTextResult({ success: true, rows });
        },
    );
}
