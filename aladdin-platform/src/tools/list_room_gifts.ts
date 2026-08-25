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
 * 禮物下拉選單用）。icon/name 是多語系陣列（LocalizationString[]），exchangeAmount 是
 * CurrencyLink[]（多幣別價格，{code, value}[]，value 已是後端計算好的顯示值，非額外
 * stored 整數，本工具原樣透傳）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。無密鑰/PII 欄位，不需遮罩。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListRoomGiftsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_list_room_gifts',
        {
            title: 'List live-streaming room gift products',
            description:
                '列出本平台直播間送禮的禮物商品清單（rajah: RoomGiftPlatform.ListRoomGifts，無參數）。' +
                'icon/name 是多語系陣列（[{code, value}]）；exchangeAmount 是多幣別價格陣列' +
                '（CurrencyLink[]，[{code, value}]，value 是後端已算好的顯示值，本工具不做額外換算）。' +
                'id 可用於 aladdin_platform_room_gift_platform_list_records 的 productIds 篩選條件。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.roomBackOffice.roomGiftPlatform.ListRoomGifts());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
