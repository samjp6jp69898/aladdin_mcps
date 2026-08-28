/**
 * tools/delete_rebate_config.ts — aladdin_platform_rebate_platform_delete_rebate_config
 *
 * rajah: RebatePlatform.DeleteRebateConfig(id i32 1)（無回傳值）
 * （rebate_back_office.rajah:276，@Permission "BonusCenter.Rebate.RebateConfig.Ops.Delete"（275）；
 * service RebatePlatform 定義於同檔 268 行、@Module "Rebate"（267）；非 @NoPublic、非 Placeholder；
 * rajah 註解寫「返水配置 - 刪除 (只能刪沒有會員的返水配置)」）
 * ——後台「優惠中心 > 返水管理 > 返水配置」列表的刪除操作。
 *
 * agrabah 對應實作：rebate_platform.ts:418-462 methodDeleteRebateConfig，確認有真實 override，
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 7 節「刪除」。逐條處理：
 * - **軟刪除還是硬刪除（第 7 節第 1 條，明文要求查證、不能憑簽名假設）**：**軟刪除**。
 *   實作是 `rebateConfig.deleted = 1` 後 `updateObject`（rebate_platform.ts:447-448），
 *   資料列仍留在 `rebate_configs` 表。可觀察的後果：
 *   刪除後 aladdin_platform_rebate_platform_get_rebate_configs（條件 `deleted = 0`）查不到，
 *   但 aladdin_platform_rebate_platform_get_rebate_config_name_list（沒有 deleted 條件）**還查得到**。
 *   ⚠️ 更重要的是：`CreateOrUpdateRebateConfig` 每次寫入都會把 `deleted` 設回 0
 *   （rebate_platform.ts:314），所以直接對已刪除的 id 打那支 RPC 會把它**復活**——不過本 MCP 的
 *   aladdin_platform_rebate_platform_create_or_update_rebate_config 讀現值時用的
 *   GetRebateConfigById 條件含 `deleted = 0`，會在讀現值那步就失敗，不會意外復活。
 * - **冪等性（第 7 節第 2 條，必須實測）**：**不冪等**。後端刪除前的存在性檢查條件是
 *   `id = ? AND platform_id = ? AND deleted = 0`（:422），已刪除的 id 撈不到 →
 *   回 `ErrorCode.idNotExists`（11）（:426-427），不是 no-op。
 *   ⚠️ 但**透過本 tool 刪第二次時，看到的錯誤碼不是 11 而是 1**：本 tool 為了留下刪除前快照，
 *   會先呼叫 GetRebateConfigById，而那支對已刪除的 id 會先拋例外變成 errorCode=1（unknown、
 *   message 空，見 get_rebate_config_by_id.ts 檔頭的成因鏈），流程在那一步就中止、
 *   根本沒送出第二次刪除。所以「後端會回 11」是直打 RPC 才觀察得到的行為；
 *   本 tool 的實際回應是 stage="read-before-delete" + errorCode=1。已 dev 實測（見驗證第 3 點）。
 * - **批量刪除（第 7 節第 3 條）**：不適用，本 method 一次只吃單一 id。
 * - **刪除前先確認記錄存在（第 7 節第 4 條建議）**：後端自己就先 loadObject 確認存在
 *   （:422-428），本 tool 另外在刪除前先呼叫 GetRebateConfigById 讀一次，把即將被刪除的配置
 *   內容（名稱/備註/金額設定）一併回報給呼叫端留底——這是軟刪除後唯一還原得回來的資訊來源，
 *   因為本 MCP 沒有提供「復原」的 tool。
 *
 * **後端的兩道使用中檢查（回傳專用錯誤碼，不是通用錯誤）**：
 * - `rebateVipUsed`（AgrabahErrorCodeEnum = 2501，remote.gen.ts:21233）：有**啟用中的 VIP 等級設定**
 *   把 rebate_id 指向這個配置（查 vip 庫 `vip_level_settings`，條件含 `status = enabled`，:430-436）。
 *   注意只擋啟用中的 VIP 設定——已停用的 VIP 設定指向它不會擋。
 * - `rebateConfigUsed`（AgrabahErrorCodeEnum = 2508，remote.gen.ts:21240）：有**會員被個人指定**
 *   歸屬到這個配置（查 `rebate_user_configs`，:438-444，**沒有**狀態條件，任何一筆都會擋）。
 * 兩道檢查都在寫入之前，任一不通過就完全不會刪除。這也是 rajah 註解「只能刪沒有會員的返水配置」
 * 的實際意思——它擋的是「VIP 等級歸屬」與「個人指定歸屬」，不是「歷史上有沒有產生過返水紀錄」：
 * 已產生的返水紀錄（rebate_records）不在檢查範圍內，刪除配置**不會**清掉任何歷史返水紀錄。
 * 順帶釐清一個容易誤會的點：那些歷史紀錄在返水紀錄查詢裡的 `configName` **不會**因為配置被刪除
 * 而回退成 `{id: 數字}`——名稱 map 的載入條件只有 `platform_id = ?`、**不濾 deleted**
 * （rebate_platform.ts:1021），軟刪除後的資料列仍在表內，名稱照樣解得出來。
 * `{id: 數字}` 那種回退只發生在「連資料列都不存在」的情況（rebate_platform.ts:1133）。
 *
 * 其他：成功後寫一筆平台稽核 log（PlatformActionIdEnum.rebateConfigDelete，:453-460），
 * 但**沒有**發清快取的 Message（對照 CreateOrUpdateRebateConfig 的更新分支有發
 * OnRebateConfigChangedMessage，:336-339）——這是後端既有的不對稱，如實記錄。
 *
 * 影響範圍：軟刪除一筆返水配置。因為後端有上述兩道檢查，能刪掉的一定是「沒有任何會員歸屬」的
 * 配置，不會直接影響任何會員當下的返水；也不動任何已產生的返水紀錄或會員餘額。屬可控的寫入操作，
 * 但本 MCP 沒有提供復原 tool，description 已要求呼叫端先確認。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 測試對象刻意不用任何既有資料：先用
 * aladdin_platform_rebate_platform_create_or_update_rebate_config 建立一筆專用的測試配置
 * （id=1064、名稱「MCP測試勿用_20260828」），再用本 tool 刪除它。
 * 1. **正常刪除**（id=1064）：success=true、softDeleteVerified=true，回傳的
 *    configSnapshotBeforeDelete 完整帶出刪除前內容（rebateName「MCP測試勿用_20260828」等）。
 * 2. **軟刪除的可觀察後果實證**（獨立於本 tool 的回報，另外呼叫兩支查詢 tool 比對）：
 *    刪除後 get_rebate_config_name_list 共 26 筆、**仍包含 id=1064**（名稱照樣是
 *    「MCP測試勿用_20260828」）；而 get_rebate_configs（pageSize=size200）13 筆、
 *    **不含 1064**。兩者合起來證實了「軟刪除、資料列還在、只有 deleted=0 的查詢會排除它」。
 * 3. **不冪等實測**：對同一個 id=1064 再刪一次 → 停在 stage="read-before-delete"、
 *    errorCode=1、message 空，未送出第二次刪除（與上方冪等性那條的說明一致）。
 * 4. **使用中檢查實測**（真的踩到後端的擋門）：對 id=15（dev 上真實在用的「TEST返水1」）呼叫 →
 *    stage="delete"、**errorCode=2501、errorName="rebateVipUsed"**，
 *    代表有啟用中的 VIP 等級設定指向它，後端在寫入前擋下、**沒有刪除任何東西**
 *    （回傳同時附上該配置的刪除前快照供覆核）。這條同時驗證了 errorName 反查有效
 *    （2501 在 AgrabahErrorCodeEnum 內，不像 genie 框架層代碼會顯示「(未知錯誤碼)」）。
 *    另一個錯誤碼 rebateConfigUsed(2508) 需要「有會員被個人指定歸屬」的資料才觸發得到，
 *    dev 上沒有可安全製造的樣本，未實測，只有源碼依據（:438-444）。
 * 5. **三態回讀判定的回歸測試（2026-08-28 第二輪 review 後）**：把「讀不到就算刪除成功」
 *    改成三態判定（回讀成功但無 config／回讀失敗但錯誤形狀正是查無資料／其餘一律未能驗證）
 *    之後，另建一筆測試配置（id=1065、名稱「MCP測試勿用_20260828_b」）重跑：
 *    刪除 → success=true、softDeleteVerified=true、
 *    readback={ failed: true, errorCode: 1, message: "", stillReadable: false }
 *    （落在「錯誤形狀正是查無資料」那一態，並把回讀的原始錯誤碼一併呈現，不再靜默丟棄）；
 *    再刪一次 → 一樣停在 stage="read-before-delete"，未送出第二次刪除。
 * ⚠️ **測試殘留（已知、無法清除）**：後端只有軟刪除、沒有硬刪除 API，所以兩筆測試配置
 *    （id=1064「MCP測試勿用_20260828」與回歸測試用的 id=1065「MCP測試勿用_20260828_b」）
 *    會以 deleted=1 的資料列永久留在 dev 的 rebate_configs 表，並持續出現在
 *    aladdin_platform_rebate_platform_get_rebate_config_name_list 的回傳裡。
 *    它們不會出現在返水配置列表、不綁任何會員、不影響任何返水計算。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

const DELETE_BLOCKED_HINT =
    'errorCode=2501（rebateVipUsed）代表有「啟用中」的 VIP 等級設定把返水層級指向這個配置；'
    + 'errorCode=2508（rebateConfigUsed）代表有會員被個人指定歸屬到這個配置。'
    + '兩種情況後端都在寫入前擋下，沒有任何資料被刪除——要刪除必須先把這些歸屬改掉。'
    + 'errorCode=11（idNotExists）代表這個 id 不存在、不屬於本平台，或**已經被刪除過**'
    + '（本 method 不冪等，刪第二次會拿到這個錯誤）。';

export function registerDeleteRebateConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_delete_rebate_config',
        {
            title: 'Soft-delete a rebate config',
            description:
                '刪除本平台的一筆返水配置（rajah: RebatePlatform.DeleteRebateConfig），' +
                '對應後台「優惠中心 > 返水管理 > 返水配置」的刪除。' +
                '⚠️ 這是**軟刪除**（後端把 deleted 設為 1，資料列仍留著）：刪除後 ' +
                'aladdin_platform_rebate_platform_get_rebate_configs 查不到，但 ' +
                'aladdin_platform_rebate_platform_get_rebate_config_name_list 仍然查得到（它不濾 deleted）；' +
                'aladdin_platform_rebate_platform_get_rebate_config_by_id 也查不到（條件含 deleted = 0）。' +
                '本 MCP **沒有提供復原 tool**，所以本 tool 會在刪除前先把該配置的完整內容讀出來、' +
                '連同結果一起回報給你留底。呼叫前請先確認使用者真的要刪。' +
                '⚠️ **不冪等**：同一個 id 刪第二次不會靜默成功。透過本 tool 會停在 ' +
                'stage="read-before-delete" 並回 errorCode=1（因為本 tool 為了留快照會先讀一次，' +
                '而讀取對已刪除的 id 就會失敗），根本不會送出第二次刪除；' +
                '直打後端 RPC 則會拿到 errorCode=11（idNotExists）。' +
                '⚠️ 後端有兩道「使用中」檢查，任一不過就完全不會刪除：' +
                '有**啟用中**的 VIP 等級設定指向這個配置 → errorCode=2501（rebateVipUsed）；' +
                '有會員被個人指定歸屬到這個配置 → errorCode=2508（rebateConfigUsed）。' +
                '（已停用的 VIP 設定指向它不會擋。）' +
                '刪除**不會**影響任何已產生的返水紀錄或會員餘額，也不會清掉歷史資料。' +
                '成功後後端會寫一筆平台稽核 log；但注意它**沒有**發清快取 Message' +
                '（新增/編輯那支有發），這是後端既有的不對稱行為。' +
                'RPC 沒有回傳值，所以本 tool 會在刪除後再讀一次做驗證：' +
                '預期 aladdin_platform_rebate_platform_get_rebate_config_by_id 讀不到（代表軟刪除生效），若仍讀得到會如實回報異常。',
            inputSchema: {
                id: z.number().int().min(1).describe('要刪除的返水配置 id，來自 aladdin_platform_rebate_platform_get_rebate_configs'),
            },
        },
        async ({ id }) => {
            const before = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigById(id));
            if (before.failed) {
                return asErrorResult(before, {
                    stage: 'read-before-delete',
                    requestedId: id,
                    hint: '刪除前讀取失敗，**沒有送出刪除**。errorCode=1（unknown、message 空）代表這個 id 不存在或已被軟刪除（GetRebateConfigById 條件含 deleted = 0），兩者無法區分。',
                });
            }

            const snapshot = deepFixLongs(before.data?.config);

            const w = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.DeleteRebateConfig(id));
            if (w.failed) {
                return asErrorResult(w, {
                    stage: 'delete',
                    requestedId: id,
                    hint: DELETE_BLOCKED_HINT,
                    configSnapshotBeforeDelete: snapshot,
                });
            }

            // ⚠️ 回讀判定必須分三態，不能用「讀不到 = 刪除成功」：errorCode=1 是後端最外層的
            // catch-all（成因鏈見 get_rebate_config_by_id.ts 檔頭），任何未捕捉例外——含網路/
            // 登入態/其他後端錯誤——都會回同一個碼。把那些情況當成「已確認刪除」是沒有憑據的宣稱。
            // 只有「回讀成功但沒有 config」，或「回讀失敗且錯誤形狀正是查無資料那一種
            // （errorCode=1 且 message 空）」才算驗證通過；其餘一律誠實回報「未能驗證」。
            const after = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigById(id));
            const stillReadable = !after.failed && !!after.data?.config;
            const readbackLooksLikeNotFound = after.failed && after.errorCode === 1 && (after.message ?? '') === '';
            const verified = !stillReadable && (!after.failed || readbackLooksLikeNotFound);

            return asTextResult({
                success: !stillReadable,
                deletedId: id,
                softDeleteVerified: verified,
                readback: {
                    failed: after.failed,
                    errorCode: after.failed ? after.errorCode : undefined,
                    message: after.failed ? after.message : undefined,
                    stillReadable,
                },
                configSnapshotBeforeDelete: snapshot,
                note: stillReadable
                    ? '⚠️ 刪除的 RPC 回成功，但回讀時仍讀得到這筆配置——與預期（軟刪除後 GetRebateConfigById 因 deleted = 0 條件而讀不到）不符，請人工覆核。'
                    : verified
                        ? '刪除成功並已回讀驗證（aladdin_platform_rebate_platform_get_rebate_config_by_id 已讀不到）。這是軟刪除：資料列仍在 rebate_configs 表，'
                            + 'aladdin_platform_rebate_platform_get_rebate_config_name_list 仍會列出這個 id。'
                            + '上方 configSnapshotBeforeDelete 是刪除前的完整內容，本 MCP 沒有復原 tool，'
                            + '需要還原請保留這份快照並走後台 UI。'
                        : '⚠️ 刪除的 RPC 已回成功，但回讀本身失敗、且錯誤形狀不是「查無資料」那一種（見 readback 欄位）——'
                            + '無法確認刪除是否真的生效，請自行用 aladdin_platform_rebate_platform_get_rebate_configs 覆核。',
            });
        },
    );
}
