/**
 * tools/get_merchant_setting.ts — aladdin_platform_external_stream_platform_get_merchant_setting
 *
 * rajah: ExternalStreamPlatform.GetMerchantSetting(id i32 1) (setting MerchantSettingEdit 1)
 * （rajah/services/external_stream_back_office.rajah:75；`MerchantSettingEdit` 定義於同檔 28-35 行；
 * 需要權限節點 `Room.ExternalStream.MerchantList.GetSetting`；client 路徑
 * remote.externalStreamBackOffice.externalStreamPlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（同 service 尾端的
 * `placeholderRoomExternalStream()` 是第 0 節點名的小寫 p 陷阱，與本 method 無關）、
 * service 無 `@NoPublic`、agrabah 對應實作為真實 override
 * （agrabah/src/servers/external_stream_back_office/services/external_stream_platform.ts:162-175，
 * methodGetMerchantSetting）。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆（by id，回傳單一 model）」。逐條：
 * - **id 不存在的實際行為**：後端 `loadObject(DbMerchantSetting, 'platform_id = ? AND merchant_id = ?')`
 *   查無資料時**顯式**回 `objectNotFound`（:171-173），不是空 struct、也不是靜默成功。
 *   後端 doc comment 另註明：查不到通常代表「新增商戶時 merchant_settings 記錄建立失敗」，
 *   也就是商戶本身可能存在但設定列缺失——所以拿到 objectNotFound 不等於「這個商戶不存在」，
 *   要用 `aladdin_platform_external_stream_platform_get_merchant_list` 交叉確認。
 * - **跨租戶風險**：查詢條件同時帶 `platform_id`（來自 context、呼叫端無法指定）與 `merchant_id`，
 *   別的平台的商戶 id 撈不到，符合第 1 節對「id 沒搭配 platformId 一起驗證」的擔憂之反面。
 * - **`Get` 前綴確實是唯讀**：實作只有一次 `loadObject`，沒有任何寫入或 claim 語意。
 * - **回傳欄位審視**：`MerchantSettingEdit` 只有 `appUserCreatable`、`defaultCharacterId` 兩個欄位，
 *   **不含任何密鑰或個資**（`secret` 在 `merchant` 主表、且有獨立的 `GetMerchantSecret` 方法與
 *   獨立權限節點）。DB 上的 `DbMerchantSetting` 其實還有 `defaultLevelId`／`defaultTagId`
 *   （agrabah/src/database_types/external_stream.ts:24-29），但 rajah model 沒有宣告，
 *   所以不會被回傳、也無法透過本 service 修改。
 * - 第 8 節（敏感資料）不適用，理由同上。
 *
 * ⚠️ `appUserCreatable` 的型別是 `StatusEnum`（`@Type "Toggle"`，後台以開關呈現）：
 * 1=enabled 代表「允許這個商戶透過 externalStream 的 CreateAnchor 建立用戶帳號」，2=disabled 代表不允許。
 * ⚠️ `defaultCharacterId` 是「建立用戶帳號時套用的預設身分 id」。它在 rajah 上是裸 `i32`、
 * **沒有 `@Type "Select:xxx"` 標記**，所以從 schema 看不出合法值來源；實際來源是後台「用戶身分」
 * 設定（`PlatformAppUser.ListCharacters`，rajah/services/user_back_office.rajah:1901，service 定義於同檔 1877 行），
 * 那支目前**沒有**被包成 MCP tool，因此本 server 內查不到合法 id 清單——要改這個值請先從後台
 * 頁面確認 id，或先讀本工具拿到現值。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetMerchantSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_external_stream_platform_get_merchant_setting',
        {
            title: 'Get one external-stream merchant\'s settings',
            description:
                '查詢單一第三方直播商戶的設定（rajah: ExternalStreamPlatform.GetMerchantSetting，' +
                '需要權限節點 Room.ExternalStream.MerchantList.GetSetting）。' +
                'id 是商戶 id，從 aladdin_platform_external_stream_platform_get_merchant_list 取得。' +
                '回傳 setting 含兩個欄位：appUserCreatable（StatusEnum，1=enabled 代表允許這個商戶' +
                '透過 externalStream 的 CreateAnchor 建立用戶帳號，2=disabled 代表不允許）、' +
                'defaultCharacterId（建立用戶帳號時套用的預設身分 id）。' +
                '⚠️ defaultCharacterId 的合法值來自後台「用戶身分」設定，該查詢方法目前沒有被包成 ' +
                'MCP tool，本 server 內查不到可用 id 清單；要改這個值請先從後台頁面確認 id。' +
                '⚠️ 查不到時回 errorCode=14（objectNotFound），但這**不等於商戶不存在**——後端註明' +
                '設定列缺失通常代表當初新增商戶時 merchant_settings 沒建成功，請用 ' +
                'aladdin_platform_external_stream_platform_get_merchant_list 交叉確認商戶本身是否存在。' +
                '（errorCode 是 genie 框架層錯誤碼，回應裡的 errorName 會顯示「(未知錯誤碼)」，' +
                '請直接看 errorCode 數字。）' +
                '本設定不含商戶密鑰，密鑰另有獨立方法與權限節點、且沒有被包成 MCP tool。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                id: z.number().int().min(1).describe(
                    '商戶 id，來自 aladdin_platform_external_stream_platform_get_merchant_list',
                ),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(
                () => remote.externalStreamBackOffice.externalStreamPlatform.GetMerchantSetting(id),
            );
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, merchantId: id, setting: r.data?.setting ?? null });
        },
    );
}
