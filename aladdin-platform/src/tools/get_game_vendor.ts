/**
 * tools/get_game_vendor.ts — aladdin_platform_game_vendor_platform_get_game_vendor_for_edit
 *
 * rajah: GameVendorPlatform.GetGameVendorForEdit(id i32 1) (gameVendor PlatformGameVendorEdit 1)
 * （game_back_office.rajah:1074，@Permission "GameVendor"，service 定義於
 * game_back_office.rajah:1050）——讀取「本 platform 視角」下單一三方場館的編輯用資料
 * （名稱多語系、圖示、排序），不是 aladdin-admin 那支同名 GetGameVendorForEdit
 * （game_back_office.rajah:318，回傳 GameVendorEdit，含 adapter/apiKey 等技術欄位）——
 * 兩支同名 method 分屬不同 service、回傳完全不同的 model，不能假設行為一致。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（大小寫正確，非
 * `Placeholder` 開頭）、非 @NoPublic；agrabah 對應 Service 是否真的 override 已用
 * 2026-08-24 dev 實測直接證實（回傳真實場館資料，非 base class 的 notImplemented）。
 * 分類：第 1 節「讀取單筆（Get by id，回傳單一 model）」。
 *
 * *ForEdit 與顯示版（PlatformGameVendorEssential，見
 * aladdin_platform_game_vendor_platform_list_game_vendors）的欄位差異：Edit 版多出
 * localizedName（多語系名稱）與 squareImageWeb（Web 端圖示，Essential 只有
 * squareImageMobile），但**沒有** status/maintenanceStatus（那兩個狀態欄位只在
 * Essential/list 版本才有，本 tool 不回傳）。逐欄核對過，Edit 版沒有任何 admin 端
 * 技術欄位（adapter/apiKey 之類）外洩的疑慮。
 *
 * id 不存在時的實測行為（2026-08-24 dev 實測，id=999999999 與 id=0）：兩者皆回
 * errorCode=14、message=''、data=null。14 是 genie 底層通用碼
 * ErrorCode.objectNotFound（不在 AgrabahErrorCodeEnum 業務碼範圍內），asErrorResult()
 * 反查不到會顯示 errorName="(未知錯誤碼)"，這是正常現象、不是遇到真正未知例外。
 *
 * 跨租戶風險（2026-08-24 dev 實測，範圍有限，如實說明）：本 platform（pk-platform）
 * 目前清單僅 5 家場館，用一個明顯不在清單內的整數 id 測試同樣回 errorCode=14——但
 * 這只證明「隨機/超出範圍的 id 查不到」，**沒有**用另一個真正屬於別的 platform、
 * 但已存在於全平台母表的合法 gameVendorId 做嚴格的跨租戶驗證（本次測試環境只有單一
 * platform 帳號可用，無法取得這樣的對照 id）。呼叫端不應把「查不到」直接等同於
 * 「後端有做嚴格 platform 範圍檢查」，只能確認查不到隨機/超範圍 id。
 *
 * 這是純讀取查詢，不會修改任何資料，可安全重複呼叫；無密鑰/PII 欄位，不需遮罩。
 *
 * --- dev 驗證原始輸出（2026-08-24，實際執行 abu/platform/_test_tmp_GetGameVendorForEdit.ts，
 * 跑完已刪除暫存腳本，全程唯讀，未動任何 dev 現有資料）---
 * === login ok ===
 * ListGameVendors errorCode 0 rows 5 totalPage 5
 * seedId = 1 name = Jili (廠商)
 * === GetGameVendorForEdit(存在的 id) ===
 * errorCode 0 message ""
 * data keys ["localizedName","squareImageWeb","squareImageMobile","id","name","sortOrder"]
 * full data {"gameVendor":{"id":1,"name":"Jili (廠商)","localizedName":[{"code":"en-US","value":"Jili"},
 *   {"code":"zh-CN","value":"Jili電子"},{"code":"zh-TW","value":"Jili"}],"sortOrder":1000}}
 * === GetGameVendorForEdit(不存在的 id=999999999) ===
 * errorCode 14 message "" data null
 * === GetGameVendorForEdit(id=0) ===
 * errorCode 14 message "" data null
 * === GetGameVendorForEdit(疑似不在本 platform 清單的 id) === 123462
 * errorCode 14 message "" data null
 *
 * 附註：上面 "full data" 沒有印出 squareImageWeb/squareImageMobile 這兩個 key（即使
 * "data keys" 的 Object.keys() 列出它們存在），推測是這筆資料兩個欄位皆為空陣列，
 * protobufjs 的 toJSON() 對預設值（空陣列）做了省略——不是欄位遺失，呼叫端讀不到這
 * 兩個 key 時應視為「空陣列」而非「不存在」。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetGameVendorTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_get_game_vendor_for_edit',
        {
            title: 'Get one game vendor\'s platform-facing edit detail by id',
            description:
                '用場館 id 讀取「本 platform 視角」下單一三方場館的編輯用資料（rajah: ' +
                'GameVendorPlatform.GetGameVendorForEdit）——名稱多語系（localizedName）、' +
                'Web/行動端圖示（squareImageWeb/squareImageMobile）、排序（sortOrder），' +
                '沒有 status/maintenanceStatus（那兩個狀態欄位只在 ' +
                'aladdin_platform_game_vendor_platform_list_game_vendors 回傳的清單版本才有）。' +
                '注意：這不是 aladdin-admin server 那支同名 GetGameVendorForEdit——admin 版回傳' +
                '含 adapter/apiKey 等技術欄位的 GameVendorEdit，本 tool 回傳的是純顯示設定用的' +
                'PlatformGameVendorEdit，兩者是不同 service、不同 model，欄位不能互相假設。' +
                'id 必須是既有場館的內部流水號，可用 ' +
                'aladdin_platform_game_vendor_platform_list_game_vendors 取得合法值。' +
                'id 不存在（含 id=0）時，2026-08-24 dev 實測回傳 errorCode=14（genie 通用碼 ' +
                'objectNotFound，不在 Agrabah 業務錯誤碼範圍內，errorName 會顯示' +
                '"(未知錯誤碼)"，這是正常現象、不是真的未知例外）、data 為 null，不是拋例外。' +
                '跨租戶注意：2026-08-24 僅用「明顯超出本 platform 清單範圍的 id」測試（回 ' +
                'errorCode=14），沒有用另一個真正屬於別的 platform 的合法 gameVendorId 做過嚴格' +
                '驗證——查不到不保證後端一定有做嚴格 platform 範圍檢查，只能確認隨機/超範圍 id ' +
                '查不到。這是純讀取查詢，不會修改任何資料，可安全重複呼叫。',
            inputSchema: {
                id: z.number().int().describe('場館的內部流水號 id，來自 aladdin_platform_game_vendor_platform_list_game_vendors 的回傳 id 欄位；不是 adapter 代碼或 gameVendor 名稱'),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetGameVendorForEdit(id));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, gameVendor: r.data?.gameVendor ?? null });
        },
    );
}
