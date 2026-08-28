/**
 * tools/edit_merchant_setting.ts — aladdin_platform_external_stream_platform_edit_merchant_setting
 *
 * rajah: ExternalStreamPlatform.EditMerchantSetting(id i32 1, setting MerchantSettingEdit 2) ()（無回傳值）
 * （rajah/services/external_stream_back_office.rajah:78；`MerchantSettingEdit` 定義於同檔 27-35 行；
 * 需要權限節點 `Room.ExternalStream.MerchantList.EditSetting`；client 路徑
 * remote.externalStreamBackOffice.externalStreamPlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（同 service 尾端的
 * `placeholderRoomExternalStream()` 是第 0 節點名的小寫 p 陷阱，與本 method 無關）、
 * service 無 `@NoPublic`、agrabah 對應實作為真實 override
 * （agrabah/src/servers/external_stream_back_office/services/external_stream_platform.ts:190-211，
 * methodEditMerchantSetting）。
 *
 * 分類：method-category-checklist.md 第 4 節（Upsert / 局部更新）。這支**不是** `CreateOrUpdate`
 * 命名，但吃一個 `XxxEdit` model、語意是局部更新，所以套第 4 節的檢查項。三件關鍵的後端事實
 * （2026-08-28 讀 source 查證）：
 *
 * 1. **後端這次真的有做局部合併，而且是用 truthy 判斷**（:198-203）：
 *    ```
 *    if (setting.appUserCreatable) { updateObject.appUserCreatable = setting.appUserCreatable; }
 *    if (setting.defaultCharacterId) { updateObject.defaultCharacterId = setting.defaultCharacterId; }
 *    ```
 *    所以沒帶到的欄位確實不會被覆蓋（不同於 `CreateOrUpdateLiveCategory` 那支的 `assignKey`
 *    歸零地雷）。但反面是：**任何「值為 0」的設定都寫不進去**——`appUserCreatable=0`（unknown）
 *    與 `defaultCharacterId=0` 都會被這個 truthy 判斷吃掉、靜默不生效。本工具因此把
 *    `appUserCreatable` 限制成 enabled/disabled（皆非 0）、`defaultCharacterId` 限制成 >= 1，
 *    不讓呼叫端送出一個「送得出去但不會生效」的請求。
 *
 * 2. **`updateObject(updateObject, true)`（:204）的 `notModifiedIsError` 是 `true`**
 *    （對照 `ToggleMerchantStatus` 用的是 `false`）——`updateObject`
 *    （agrabah/src/engines/relational_database/mysql/mysql_relational_database_engine.ts:206-236）
 *    是在 **JS 層**把要寫的物件跟剛讀出來的原值逐欄比對算出 `keys`，`keys.length === 0` 時
 *    直接回 `nothingChanged`（genie/src/common/error_code.ts:12，數值 10）。
 *    注意這條與 DB 連線的 affectedRows 語意無關（不像 `updateStatus` 那條），是純 JS 比較，
 *    所以「送出與現值完全相同的設定會拿到 errorCode=10」是可以從 source 確定的。
 *    本工具會**先讀現值比對**，發現這次呼叫不會造成任何實際變更時直接回報 `changed: false`、
 *    不送出 RPC，避免呼叫端收到一個看起來像失敗的 `nothingChanged`。
 *
 * 3. **目標不存在時**：後端先 `ensureObject(DbMerchantSetting, 'platform_id = ? AND merchant_id = ?')`
 *    （:191），查無資料回 `objectNotFound`(14)。本工具因為要先讀現值，會先用
 *    `GetMerchantSetting` 打到同一條件，所以不存在的 id 根本不會送出寫入請求。
 *
 * **併發覆蓋窗口**：本工具先讀現值再寫入，中間沒有樂觀鎖（後端沒有版本欄位也沒有 CAS，
 * 呼叫端做不出真正的樂觀鎖；「送出前再讀一次」只會把窗口變窄而非消滅，故不做）。不過因為後端
 * 本身就是逐欄 truthy 合併，本工具**只送呼叫端指定的欄位**、未指定的完全不進 payload，
 * 由後端沿用它自己剛讀到的值——所以這支**兩個欄位都沒有覆蓋窗口**。先讀現值在這裡只用於
 * 存在性檢查與「是否真的有變更」的判斷，不參與 payload 組裝。
 *
 * 第 4 節其餘要求：要求 2（round-trip 逐欄比對）本工具寫入後會再讀一次回傳給呼叫端；
 * 要求 3（id=0 新增／id>0 更新的分流）不適用——本 method 只能更新既有設定，沒有新增分支
 * （設定列是 `AddMerchant` 建商戶時一起建的）；要求 4/5（permissionIds 差異運算、批次陣列
 * upsert）都不適用。
 *
 * ⚠️ `defaultCharacterId` 在 rajah 上是裸 `i32`、沒有 `@Type "Select:xxx"`，合法值來自後台
 * 「用戶身分」設定（`PlatformAppUser.ListCharacters`，rajah/services/user_back_office.rajah:1901），
 * 那支沒有被包成 MCP tool，**本 server 查不到合法 id 清單，也無法在寫入前驗證你給的 id 是否存在**
 * ——後端同樣不驗（只有 truthy 判斷），填錯會寫進 DB 並影響該商戶之後建立的用戶帳號身分。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MerchantSettingEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerEditMerchantSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_external_stream_platform_edit_merchant_setting',
        {
            title: 'Edit one external-stream merchant\'s settings',
            description:
                '修改單一第三方直播商戶的設定（rajah: ExternalStreamPlatform.EditMerchantSetting，' +
                '需要權限節點 Room.ExternalStream.MerchantList.EditSetting）。' +
                'id 是商戶 id，從 aladdin_platform_external_stream_platform_get_merchant_list 取得。' +
                '本工具會先呼叫 GetMerchantSetting 讀現值，只送出你有帶到的欄位，其餘不動' +
                '（後端本身也是逐欄 truthy 判斷、沒帶到就不覆蓋）；寫入後再讀回一次供你核對。' +
                '⚠️ **值為 0 的設定寫不進去**：後端用 `if (setting.xxx)` 判斷，所以 appUserCreatable=0' +
                '（unknown）與 defaultCharacterId=0 都會被靜默忽略。本工具因此只接受 ' +
                'appUserCreatable=enabled/disabled、defaultCharacterId>=1。' +
                '⚠️ **送出與現值完全相同的設定，後端會回 errorCode=10（nothingChanged）**' +
                '（updateObject 的 notModifiedIsError=true）。本工具會先比對，發現沒有實際變更時' +
                '直接回 changed=false、不送出 RPC，不會讓你收到看起來像失敗的錯誤。' +
                '⚠️ defaultCharacterId 的合法值來自後台「用戶身分」設定，該查詢方法沒有被包成 MCP ' +
                'tool，**本工具與後端都無法驗證你給的 id 是否真的存在**，填錯會直接寫進 DB 並影響' +
                '這個商戶之後建立的用戶帳號身分——請先從後台頁面確認 id。' +
                'id 不存在（或該商戶沒有設定列）時回 errorCode=14（objectNotFound）；errorCode 都是 ' +
                'genie 框架層錯誤碼，回應裡的 errorName 會顯示「(未知錯誤碼)」，請看數字。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）向使用者明確詢問是否要在正式環境執行，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會' +
                '忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(1).describe(
                    '商戶 id，來自 aladdin_platform_external_stream_platform_get_merchant_list',
                ),
                appUserCreatable: z.enum([ 'enabled', 'disabled' ]).optional().describe(
                    '是否允許這個商戶透過 externalStream 的 CreateAnchor 建立用戶帳號；省略則不改動',
                ),
                defaultCharacterId: z.number().int().min(1).optional().describe(
                    '建立用戶帳號時套用的預設身分 id（>=1；0 寫不進去，見 description）；省略則不改動。'
                    + '合法值來自後台「用戶身分」設定，本工具無法代為驗證',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, appUserCreatable, defaultCharacterId, confirm }) => {
            assertProdConfirmed(confirm);

            if (appUserCreatable === undefined && defaultCharacterId === undefined) {
                return asTextResult({
                    success: false,
                    message: 'appUserCreatable 與 defaultCharacterId 至少要帶一個，否則這次呼叫不會有任何效果',
                });
            }

            // 先讀現值：同時完成「目標存在性檢查」與「是否真的有變更」的判斷。
            const beforeR = await withAutoRelogin(
                () => remote.externalStreamBackOffice.externalStreamPlatform.GetMerchantSetting(id),
            );
            if (beforeR.failed) {
                return asErrorResult(beforeR, {
                    hint: 'errorCode=14 代表這個商戶沒有設定列（可能商戶本身不存在，也可能是當初新增商戶時 '
                        + 'merchant_settings 沒建成功）。請先用 '
                        + 'aladdin_platform_external_stream_platform_get_merchant_list 確認商戶是否存在。',
                });
            }
            const current = beforeR.data?.setting ?? null;

            const nextAppUserCreatable = appUserCreatable !== undefined
                ? ACTIVE_STATUS_MAP[ appUserCreatable ]
                : current?.appUserCreatable;
            const nextDefaultCharacterId = defaultCharacterId !== undefined
                ? defaultCharacterId
                : current?.defaultCharacterId;

            // 見檔頭第 2 點：後端 updateObject 的 notModifiedIsError=true，完全沒變更會回
            // nothingChanged(10)。先擋下來，回一個語意正確的「沒有變更」而不是看起來像失敗的錯誤。
            if (nextAppUserCreatable === current?.appUserCreatable
                && nextDefaultCharacterId === current?.defaultCharacterId) {
                return asTextResult({
                    success: true,
                    changed: false,
                    message: '這次要求的設定與現值完全相同，未送出寫入請求（後端對無變更的更新會回 '
                        + 'errorCode=10 nothingChanged，本工具先擋下以免被誤判成失敗）',
                    setting: current,
                });
            }

            // 只送呼叫端指定的欄位，不把未指定欄位的現值一起送回去。後端本身就是逐欄 truthy
            // 合併（見檔頭第 1 點），未出現在 payload 的欄位會沿用它**自己剛讀到的**值，
            // 所以最終狀態一致，但少了「把別人同時間的改動蓋回讀取當下值」的窗口。
            const payload = MerchantSettingEdit.create({
                ...(appUserCreatable !== undefined ? { appUserCreatable: ACTIVE_STATUS_MAP[ appUserCreatable ] } : {}),
                ...(defaultCharacterId !== undefined ? { defaultCharacterId } : {}),
            });

            const writeR = await withAutoRelogin(
                () => remote.externalStreamBackOffice.externalStreamPlatform.EditMerchantSetting(id, payload),
            );
            if (writeR.failed) return asErrorResult(writeR);

            const afterR = await withAutoRelogin(
                () => remote.externalStreamBackOffice.externalStreamPlatform.GetMerchantSetting(id),
            );
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    changed: true,
                    message: '寫入 RPC 回報成功，但寫入後讀回驗證失敗，無法確認實際結果，請自行用 '
                        + 'aladdin_platform_external_stream_platform_get_merchant_setting 確認',
                    verifyError: { errorCode: afterR.errorCode, message: afterR.message },
                });
            }

            return asTextResult({
                success: true,
                changed: true,
                message: '設定已更新，請比對 setting 與 before 確認只有你指定的欄位改變',
                before: current,
                setting: afterR.data?.setting ?? null,
            });
        },
    );
}
