/**
 * tools/toggle_merchant_status.ts — aladdin_platform_external_stream_platform_toggle_merchant_status
 *
 * rajah: ExternalStreamPlatform.ToggleMerchantStatus(id i32 1, status StatusEnum 2) ()（無回傳值）
 * （rajah/services/external_stream_back_office.rajah:65；需要權限節點
 * `Room.ExternalStream.MerchantList.ToggleStatus`；client 路徑
 * remote.externalStreamBackOffice.externalStreamPlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder（同 service 尾端的
 * `placeholderRoomExternalStream()` 是第 0 節點名的小寫 p 陷阱，與本 method 無關）、
 * service 無 `@NoPublic`、agrabah 對應實作為真實 override
 * （agrabah/src/servers/external_stream_back_office/services/external_stream_platform.ts:78-93，
 * methodToggleMerchantStatus）。
 *
 * 分類：method-category-checklist.md 第 6 節「狀態轉換」。逐條：
 * - **名字叫 Toggle 但不是 bit-flip**：簽名帶明確的 `status` 目標狀態參數，正是第 6 節說的
 *   「`Toggle*` 系列實際上都是設定為指定狀態」。本工具照規則**不**做「先查現況再反轉」。
 * - **這支的驗證位置與 live 那兩支不同，別套同一套結論**：`update_live_tab_status` 系列走
 *   `database_helper.updateStatus`（自己驗列舉、自己判 affectedRows）；本 method 的後端實作
 *   完全沒有驗證，是 **jasmine 生成的 handler 在進 method 之前**擋：
 *   `if (!(request.status === 0 || StatusEnum.hasOwnProperty(request.status))) return invalidData`
 *   （agrabah/src/generated/services.gen.ts:35056）。
 *   兩個後果：
 *   （a）不在 `StatusEnum` 內的值回 `invalidData`(9)，不會被寫進 DB；
 *   （b）但 `status === 0`（unknown）**被顯式放行**，而 method 本體
 *        （`updateObject.status = status`，:86）不做任何檢查，所以 0 會真的寫進 `merchant.status`。
 *   本工具因此把可選值收斂成 enabled／disabled 兩個（對應後台「開關」的實際語意），
 *   不開放 unknown/frozen/deleted——不是後端擋得住，是本工具刻意不提供這條路。
 * - **不存在的 id**：後端先 `ensureObject(DbMerchant, 'platform_id = ? AND id = ?')`
 *   （:80），查無資料回 `objectNotFound`(14)（database_helper.ts:239-241）。跨平台也被同一條
 *   條件擋住。
 * - **冪等**：更新走 `updateObject(obj, false)`（:87，`notModifiedIsError=false`），
 *   所以設成與現值相同的狀態是安全的 no-op、不會回 nothingChanged。
 * - 批量／部分失敗條款不適用（一次一筆、無 `failed [T]` 回傳）。
 *
 * ⚠️ **這個狀態不是顯示開關，是對外 API 的閘門**：後端 doc comment 明講「商戶被停用後，
 * externalStream 側的 raw endpoint 會拒絕該商戶的所有請求（建立主播、建立房間等）」，
 * 而且「狀態切換不會刪除商戶的主播或房間資料，僅影響後續 API 請求的驗證」。停用等於把該廠商
 * 的串接切斷，請確認影響範圍後再操作。
 *
 * ⚠️ 失敗碼是 genie 框架層 `ErrorCode`（objectNotFound=14／invalidData=9），
 * `asErrorResult` 反查用的 `AgrabahErrorCodeEnum` 從 101 起，所以 `errorName` 會顯示
 * 「(未知錯誤碼)」，看 `errorCode` 數字即可（全 server 共通現象）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerToggleMerchantStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_external_stream_platform_toggle_merchant_status',
        {
            title: 'Enable or disable an external-stream merchant',
            description:
                '啟用或停用一個第三方直播商戶（rajah: ExternalStreamPlatform.ToggleMerchantStatus，' +
                '需要權限節點 Room.ExternalStream.MerchantList.ToggleStatus）。' +
                'id 從 aladdin_platform_external_stream_platform_get_merchant_list 取得。' +
                '⚠️ 名字雖然叫 Toggle，實際上是**設定為指定狀態**、不是反轉：status 必填，' +
                '由你明確指定 enabled 或 disabled。' +
                '⚠️ **這不是顯示開關，是對外 API 的閘門**：商戶被停用後，externalStream 側的 raw ' +
                'endpoint 會拒絕該商戶的所有請求（建立主播、建立房間等），等於把該廠商的串接切斷；' +
                '停用不會刪除已有的主播或房間資料，只影響後續請求的驗證。操作前請確認影響範圍。' +
                'id 不存在或屬於別平台回 errorCode=14（objectNotFound）；設成與現值相同的狀態是' +
                '安全的 no-op（後端 updateObject 的 notModifiedIsError=false），不會報錯。' +
                '⚠️ errorCode 是 genie 框架層錯誤碼，回應裡的 errorName 會顯示「(未知錯誤碼)」，' +
                '請直接看 errorCode 數字。' +
                '本工具在寫入後會自動重讀商戶清單，回傳該筆商戶供你核對實際結果。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）向使用者明確詢問是否要在正式環境執行，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會' +
                '忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(1).describe(
                    '商戶 id，來自 aladdin_platform_external_stream_platform_get_merchant_list',
                ),
                status: z.enum([ 'enabled', 'disabled' ]).describe(
                    '目標狀態（明確指定，非反轉）。後端在 handler 層只擋掉不在 StatusEnum 內的值、' +
                    '並且會放行 0(unknown)，但本工具刻意只提供 enabled/disabled 這兩個對應後台開關語意的值',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);

            const r = await withAutoRelogin(
                () => remote.externalStreamBackOffice.externalStreamPlatform.ToggleMerchantStatus(id, ACTIVE_STATUS_MAP[ status ]),
            );
            if (r.failed) return asErrorResult(r);

            const afterR = await withAutoRelogin(
                () => remote.externalStreamBackOffice.externalStreamPlatform.GetMerchantList(),
            );
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    message: '狀態已更新，但寫入後讀回驗證失敗，無法確認實際結果，請自行用 '
                        + 'aladdin_platform_external_stream_platform_get_merchant_list 確認',
                    verifyError: { errorCode: afterR.errorCode, message: afterR.message },
                });
            }

            const after = (afterR.data?.row ?? []).find((m) => m.id === id);
            return asTextResult({
                success: true,
                message: after
                    ? '狀態已更新'
                    : '狀態已更新，但讀回時比對不到這個 id，請自行用 get_merchant_list 確認目前狀態',
                merchant: after ?? null,
            });
        },
    );
}
