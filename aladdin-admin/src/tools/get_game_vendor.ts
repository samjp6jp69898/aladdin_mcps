/**
 * tools/get_game_vendor.ts — aladdin_admin_game_vendor_admin_get_game_vendor_for_edit
 *
 * rajah: GameVendorAdmin.GetGameVendorForEdit(id i32 1) (gameVendor GameVendorEdit 1)
 * （game_back_office.rajah:318，@Permission "GameVendor.Vendor.Ops.Edit"，service 定義於
 * game_back_office.rajah:306）——讀取單筆三方場館母表的完整「編輯用」資料，欄位比
 * aladdin_admin_game_vendor_admin_list_game_vendors 回傳的 GameVendorEssential 多（額外含
 * userPrefix/decryptedKey/decryptedToken/apiUrl/decimalPlaces/defaultLanguage/payload/
 * timezone/transferLimit），沒有 status/maintenance 欄位（那些只在 GameVendorEssential）。
 *
 * **已知 gen drift（2026-08-24 dev 實測發現，不是猜測）**：rajah 的 GameVendorEdit model
 * （game_back_office.rajah:209-213）多定義了 betFetchEndBufferSeconds/betFetchWindowSeconds
 * 兩個欄位，但實際呼叫 dev 站回傳的 gameVendor 物件完全沒有這兩個 key（不是空值/0，是整個
 * key 不存在）；進一步核對 abu/admin/src/generated/types.gen.js 也完全查不到這兩個欄位名稱，
 * 證實不是「這筆測試資料剛好沒設值」，而是 abu/admin 這份生成程式碼落後於 rajah 定義（尚未
 * 重新 generate）。本 tool 的回傳不主動宣稱含有這兩個欄位，避免呼叫端誤以為一定拿得到。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（大小寫正確，非
 * `Placeholder` 開頭）、非 @NoPublic；agrabah 對應 Service 是否真的 override 已用 dev
 * 實測直接證實——2026-08-24 實際呼叫 dev 站回傳真實場館資料（非 base class 的
 * notImplemented 錯誤），見檔尾附的終端機原始輸出。分類：第 1 節「讀取單筆（Get by id，
 * 回傳單一 model）」。
 *
 * 敏感資料處理（第 8 節，橫切分類）：decryptedKey/decryptedToken 是廠商 wallet API 用
 * 的金鑰明文（rajah 標 @Type "Secret"），性質等同 checklist 8 舉例的 GetMerchantSecret，
 * 預設遮罩顯示，只有明確帶 revealSecrets=true 才回傳明文，且呼叫端不應把明文值寫入任何
 * 持久化 log 或長期保存的對話紀錄。
 *
 * id 不存在時的實測行為（2026-08-24 dev 實測，id=999999999）：errorCode=14、message=''、
 * data=null。14 是 genie 底層通用碼 ErrorCode.objectNotFound（genie/src/common/error_code.ts:16），
 * 不在 AgrabahErrorCodeEnum（101 起）範圍內，所以 asErrorResult() 組出的 errorName 會顯示
 * "(未知錯誤碼)"——這是正常現象，不代表遇到真正未知的例外，errorCode=14 本身就是明確的
 * 「找不到該筆資料」語意。id=0 實測行為相同（同樣回 errorCode=14），未額外特殊處理。
 *
 * 母表層級操作、無 platformId/agentId 範圍鍵：GameVendorAdmin 管理的是全平台共用母表，
 * 這支 method 沒有跨租戶資料越權的疑慮（不像 platform 端資料需要 platformId 綁定驗證）。
 *
 * --- dev 驗證原始輸出（2026-08-24，實際執行 abu/admin/_test_tmp_GetGameVendorForEdit.ts，
 * 跑完已刪除暫存腳本，未動任何 dev 現有資料——本次只有讀取，無寫入）---
 * === login ok ===
 * ListGameVendors errorCode 0 rows 5 totalPage 10
 * seedId = 1050 name = ZZZ_TEST_IMG_VENDOR
 * === GetGameVendorForEdit(存在的 id) ===
 * errorCode 0 message ""
 * data keys [ "id","adapter","name","userPrefix","decryptedKey","decryptedToken","walletType",
 *   "apiUrl","currencyCode","exchangeRate","decimalPlaces","defaultLanguage","payload",
 *   "timezone","transferLimit" ]
 * full data {"gameVendor":{"id":1050,"adapter":"jili","name":"ZZZ_TEST_IMG_VENDOR","userPrefix":"",
 *   "decryptedKey":"","decryptedToken":"","walletType":1,"apiUrl":"","currencyCode":"USD",
 *   "exchangeRate":10000,"decimalPlaces":0,"defaultLanguage":"en-US","payload":"","timezone":0,
 *   "transferLimit":"1000000"}}
 * === GetGameVendorForEdit(不存在的 id=999999999) ===
 * errorCode 14 message "" data null
 * === GetGameVendorForEdit(id=0) ===
 * errorCode 14 message "" data null
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

function maskSecret(value: string | undefined | null): string {
    if (!value) return '(未設定)';
    if (value.length <= 4) return '***';
    return `***${ value.slice(-4) }`;
}

export function registerGetGameVendorTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_get_game_vendor_for_edit',
        {
            title: 'Get one game vendor\'s full edit detail by id',
            description:
                '用場館 id 讀取單一三方場館的完整「編輯用」資料（rajah: GameVendorAdmin.GetGameVendorForEdit）——' +
                '全平台共用母表，欄位比 aladdin_admin_game_vendor_admin_list_game_vendors 多（額外含 userPrefix/' +
                'decryptedKey/decryptedToken/apiUrl/decimalPlaces/defaultLanguage/payload/timezone/transferLimit），' +
                '但沒有 status/maintenance 欄位（那些只在 list 工具回傳的 essential 版本裡）。' +
                '已知落差：rajah model 另定義了 betFetchEndBufferSeconds/betFetchWindowSeconds 兩個欄位，但' +
                '2026-08-24 dev 實測回傳完全沒有這兩個 key（前端生成程式碼疑似落後於 rajah 定義，非本筆資料未設值），' +
                '不保證拿得到，呼叫端不要假設一定存在。' +
                'id 必須是既有場館的內部流水號，可用 aladdin_admin_game_vendor_admin_list_game_vendors 取得合法值。' +
                'id 不存在（含 id=0）時，2026-08-24 dev 實測回傳 errorCode=14（genie 通用碼 objectNotFound，' +
                '不在 Agrabah 業務錯誤碼範圍內，errorName 會顯示"(未知錯誤碼)"，這是正常現象、不是真的未知例外）、' +
                'data 為 null，不是拋例外或回傳空 struct。' +
                '敏感資料：decryptedKey/decryptedToken 是這個場館串接三方 wallet API 用的金鑰明文，' +
                '預設一律遮罩（只顯示尾 4 碼，全空則顯示"(未設定)"），除非明確帶 revealSecrets=true 才回傳完整明文——' +
                '帶 true 前應先確認操作者真的需要明文（例如要拿去手動比對或交接），且拿到明文後不要把它寫進任何' +
                '持久化 log 或長期保存的紀錄。' +
                'exchangeRate 是匯率 × 10000 的整數（後端實際儲存值，不是顯示用小數）；transferLimit 是單筆轉帳' +
                '限額（0 表示不限制）；walletType 是 WalletTypeEnum 數值：normal=1 / agent=2 / commission=3。' +
                '這是純讀取查詢，不會修改任何資料，可安全重複呼叫。',
            inputSchema: {
                id: z.number().int().describe('場館的內部流水號 id（不是 adapter 代碼），來自 aladdin_admin_game_vendor_admin_list_game_vendors 的回傳 id 欄位'),
                revealSecrets: z.boolean().optional().describe(
                    '預設 false（遮罩 decryptedKey/decryptedToken，只顯示尾 4 碼或"(未設定)"）。' +
                    '帶 true 才會回傳這兩個欄位的完整明文——僅在操作者明確需要明文時才帶 true，' +
                    '且取得的明文不應寫入任何持久化 log 或長期保存的對話紀錄。',
                ),
            },
        },
        async ({ id, revealSecrets }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.GetGameVendorForEdit(id));
            if (r.failed) return asErrorResult(r);

            const gv = r.data?.gameVendor;
            if (!gv) return asTextResult({ success: true, gameVendor: null });

            return asTextResult({
                success: true,
                gameVendor: {
                    ...gv,
                    decryptedKey: revealSecrets ? gv.decryptedKey : maskSecret(gv.decryptedKey),
                    decryptedToken: revealSecrets ? gv.decryptedToken : maskSecret(gv.decryptedToken),
                },
                secretsRevealed: !!revealSecrets,
            });
        },
    );
}
