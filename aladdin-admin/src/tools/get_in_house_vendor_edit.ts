/**
 * tools/get_in_house_vendor_edit.ts — aladdin_admin_in_house_game_back_office_get_vendor_edit
 *
 * rajah: InHouseGameBackOffice.GetVendorEdit（in_house_game_back_office.rajah:278）：
 * `method GetVendorEdit(vendorId i32 1) (vendorEdit InHouseGameVendorEdit 1)`。service 標頭只有
 * `@LoginRequired`、method 本身無 `@Permission`（同 in_house_game_back_office.rajah:266-268 註解；
 * agrabah 原始碼註解雖寫「權限節點設計規範：InHouseGame.Vendor.View」，但那只是設計文件備註，
 * .rajah 原始碼裡這支 method 實際沒有掛 `@Permission`，兩者不衝突——文件描述的是意圖，rajah 才是
 * 生效的定義）。
 * `InHouseGameVendorEdit`（in_house_game_back_office.rajah:64-92）欄位：`id`(@Readonly)/`gameId`(@NoEdit)/
 * `name`/`remark`/`currencyCode` + 7 個多語富文本說明欄位（investmentExplanation/hotColdExplanation/
 * missingExplanation/hotColdMissingFeatureExplanation/dragonTigerInvestmentExplanation/
 * funInvestmentExplanation/sumInvestmentExplanation，皆 `[LocalizationString]` + `@Type "RichText:InHouseGame"`），
 * 全部欄位皆無 `@Hide`，無敏感資料（都是前台會顯示給玩家看的分析文案，不是內部設定）。
 *
 * 前端實際用法確認只在 Admin：`abu/admin/src/pages/game/two_eight/GameVendorEditPopup.vue:61`
 * `api.remote.inHouseGameBackOffice.main.GetVendorEdit(vendorId)`；另一處
 * `platform_management/dialogs/PlatformRoleGroupEditPopup.vue:59` 是**註解掉的死碼**
 * （`// const result = await api.remote.inHouseGameBackOffice.main.GetVendorEdit(vendorId);`），
 * 不算真實呼叫點。全庫搜尋 `abu/platform/src/pages` 找不到任何呼叫，故本 tool 只放 aladdin-admin。
 *
 * agrabah 後端實作（agrabah/src/servers/in_house_game_back_office/services/in_house_game_back_office.ts:412-430
 * methodGetVendorEdit）：`loadObject(DbInHouseGameVendor, 'id = ?', [vendorId])`，**找不到時明確回
 * `ErrorCode.objectNotFound`**（同 GetGameEdit 的模式），已用 dev 實測驗證（見下方）。多語富文本欄位
 * 由 `assignVendorExplanations()`（同檔 1389-1397）額外查詢填入，底層是共用的 `id_long_localizations`
 * 長文本 i18n 表（`localization_manager.ts` `queryLongByIdWithoutError`，platform_id=0 固定 + 7 個
 * `LocalizationServiceIdEnum.inHouseGame*Explanation` 專屬 service id 圈定範圍，結構上不可能撈到其他
 * 用途的資料）——**注意 `WithoutError` 設計**：找不到對應語系資料回空陣列是正常情況，但底層查詢真的
 * 失敗（DB 層級錯誤，非查無資料）時也同樣吞掉回空陣列、不上拋，這是後端既有設計（前台頁面走同一條
 * 路），效果是該富文本欄位「靜默缺席」而非報錯，呼叫端不應把「7 個富文本欄位皆為空陣列」誤判成
 * 「這個廠商真的沒有任何說明文案」。
 *
 * === method-category-checklist.md 分類判定 ===
 * 屬第 1 節「讀取單筆（Get by id，回傳單一 model）」。無 `@Optional` 標記，id 不存在的行為必須實測
 * （已測，回 `objectNotFound` errorCode=14）。無跨租戶風險——`in_house_game_vendors` 表繼承
 * `WithTimestamp`（非 `WithPlatformAndTimestamp`），不綁 platformId/agentId，全域可見的企劃設定資料。
 * `*ForEdit`/`*Edit` 系列命名，已逐欄核對回傳欄位皆非內部隱藏欄位——7 個富文本欄位是前台會直接顯示
 * 給玩家看的公開分析文案（如「冷熱分析」「遺漏分析」說明），不是後台內部設定，敏感性判定：無風險。
 *
 * === 2026-08-25 dev 實測（admin.alddev.com，帳號 landon001，VPN 已恢復）===
 * 掛進 index.ts 後，用 SDK Client + StdioClientTransport 透過 stdio 實際呼叫已註冊的
 * `aladdin_admin_in_house_game_back_office_get_vendor_edit` tool：
 *   - `vendorId=1`（get_in_house_vendor_list 實測的「東昇-加拿大28」）：成功回傳 vendorEdit，
 *     id/gameId/name/currencyCode 與 GetVendorList 的回傳一致，7 個富文本欄位皆有值，內容確認是
 *     `zh-CN` 語系的 HTML 說明文案（如「玩法說明」「冷熱說明」「遺漏說明」「龍虎」「趣味」「和值」），
 *     全部是公開展示文案，未見任何憑證/內部設定/個資，敏感性判定「無風險」屬實。
 *   - `vendorId=999999999`（不存在）：回傳 `errorCode=14`（objectNotFound），非靜默空物件。
 * 純讀取、無副作用，符合分類判定。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetInHouseVendorEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_in_house_game_back_office_get_vendor_edit',
        {
            title: 'Get in-house (自研) game vendor edit detail by id',
            description:
                '取得單一自研（in-house）遊戲廠商的完整可編輯詳情（rajah: InHouseGameBackOffice.GetVendorEdit），' +
                '含 id/gameId/name/remark/currencyCode，以及 7 個多語富文本說明欄位（investmentExplanation/' +
                'hotColdExplanation/missingExplanation/hotColdMissingFeatureExplanation/' +
                'dragonTigerInvestmentExplanation/funInvestmentExplanation/sumInvestmentExplanation，' +
                '皆為 LocalizationString 陣列，是前台會顯示給玩家看的公開分析文案，非內部敏感設定）。' +
                'vendorId 找不到時回傳 errorCode=14（objectNotFound），不是靜默空物件。這是全平台共用的' +
                '企劃設定資料（不綁 platformId），任何已登入本後台的使用者皆可查詢。id 來源：' +
                'aladdin_admin_in_house_game_back_office_get_vendor_list 的回傳結果。純讀取、無副作用。',
            inputSchema: {
                vendorId: z.number().int().describe('自研遊戲廠商 id，來自 aladdin_admin_in_house_game_back_office_get_vendor_list 的回傳結果'),
            },
        },
        async ({ vendorId }) => {
            const r = await withAutoRelogin(() => remote.inHouseGameBackOffice.main.GetVendorEdit(vendorId));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, vendorEdit: r.data?.vendorEdit ?? null });
        },
    );
}
