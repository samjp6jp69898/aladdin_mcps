/**
 * tools/delete_fund_adjustment_preset.ts —
 * aladdin_platform_fund_adjustment_platform_delete_fund_adjustment_preset
 *
 * rajah: FundAdjustmentPlatform.DeleteFundAdjustmentPreset(id i32 1)（無回傳值）
 * （fund_adjustment_back_office.rajah:529；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.Preset.Ops.Delete"（528）——後台
 * 「帳務管理 > 資金調整 > 快捷設置」的刪除。非 @NoPublic、非 Placeholder、**無 @Totp**。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:907-941 methodDeleteFundAdjustmentPreset，
 * 確認有真實 override（讀 before 快照 → 單一交易內刪主檔 + 刪多幣別金額 → 寫 audit log），
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 7 節「寫入 — 刪除」。該節要求的處理如下：
 * - **「tool 描述必須標示是軟刪除還是硬刪除——這點無法只憑簽名判斷，需另查後端實作」**：
 *   查證結果是 **硬刪除（HARD DELETE）**，而且是兩張表各一次真正的 DELETE：
 *   `DELETE FROM ${DbFundAdjustmentPreset.tableName} WHERE id = ? AND platform_id = ?`（:917-918）
 *   與 `DELETE FROM ${DbIdCurrencyAmountLinkLite.tableName} WHERE platform_id = ? AND service_id = ?
 *   AND target_id = ?`（:925-926，清掉這筆 preset 的多幣別金額）。
 *   **不是** `deleted = 1` 的軟刪除，資料列真的消失，**本 MCP 沒有任何復原能力**。
 *   （對照同 server 的 delete_rebate_config 是軟刪除——兩者不要類推。）
 * - **「冪等性（同一 id 刪兩次會不會噴錯）必須實測，不能假設」**：源碼上第二次刪除會在
 *   `#loadPresetSnapshot` 就查不到而回 ErrorCode.objectNotFound（:909-912），也就是**不冪等**。
 *   已 dev 實測，結果見下方驗證段。
 * - **「批量刪除要驗證是全有全無還是部分成功」**：本 method 是單筆刪除，不適用。
 * - **「建議刪除前先 round-trip 讀一次確認記錄仍存在，避免對已刪除/不存在 id 誤報成功」**：
 *   本 tool 一定會先讀（也順便把完整內容留在回傳裡當作刪除前的備份），讀不到就直接擋下、不送出。
 *
 * ⚠️ **刪除前的內容會完整回報在 deletedRow 欄位**——因為這是硬刪除且本 MCP 無復原 tool，
 * 這份快照是誤刪之後唯一能用來手動重建的依據（可餵回
 * aladdin_platform_fund_adjustment_platform_create_fund_adjustment_preset 重建一筆內容相同的，
 * 但 id 會是新的）。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **⚠️ 後端沒有任何「使用中」保護**：整個 methodDeleteFundAdjustmentPreset（:907-941）除了
 *   「這筆存不存在」以外**沒有做任何前置檢查**——不檢查有沒有進行中的調整單引用它、
 *   也沒有像同 server delete_rebate_config 那樣的 rebateVipUsed / rebateConfigUsed 使用中檢查。
 *   不過 preset 的性質是「填表時的金額範本」：加款彈窗挑了 preset 之後只是把金額帶進表單，
 *   實際建立的調整單存的是金額數值本身、不存 preset id
 *   （DbUserFundAdjustments 沒有 preset 外鍵，見 methodListUserFundAdjustment 的 SELECT 欄位清單
 *   :617-636 完全沒有 preset 相關欄位）。所以**刪除 preset 不會影響任何已建立的調整單**，
 *   只是之後填表時少一個快捷選項。
 *
 * - **兩張表的刪除包在單一交易內**（:915-933），任一失敗整批 rollback，
 *   不會留下「主檔刪了但金額連結還在」的孤兒資料。
 *
 * - **帶 `AND platform_id = ?`（:918），跨平台刪不到別人的資料**；平台由登入態決定。
 *
 * - **後端沒有檢查 DELETE 的影響列數**：:919-922 只看 `deleteResult.failed`。
 *   但前面已用 #loadPresetSnapshot 確認存在（:909-912），實務上影響有限。
 *
 * - **會寫 audit log（含被刪內容的快照）**：`PlatformActionIdEnum.fundAdjustmentPresetDelete,
 *   AuditData.createDelete(before)`（:939）。⚠️ audit 快照裡的金額是**已換算成 normal 的**，
 *   與本 tool 回報的 stored value 數字不同。要從稽核紀錄重建資料時記得換算回去。
 *
 * - PII（第 8 節）：純設定資料，**不含任何會員個資或財務紀錄**。
 *
 * ⚠️ **這是不可逆的刪除操作**（硬刪除、無復原 tool）。但它刪的只是一個金額範本設定，
 * **不會動到任何會員的錢、也不影響任何已建立的調整單**——所以它不屬於本 domain 那些被標記為
 * needs_clarification 的金流寫入（ApplyAdd / AdjustmentReview 等）。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 測試對象：本輪由 create tool 自建的 preset id=9（name=`mcp-cb-test-144406`）——
 * **刻意只對自建的測試資料做刪除驗證，沒有碰 dev 上原有的 4 筆（id 8/4/3/1）**。
 * 1. **confirmName 防呆守門**：`{id:9, confirmName:"錯的名字"}` → success=false、
 *    stage=`pre-check-name-mismatch`，訊息明確指出「id=9 的實際名稱是「mcp-cb-test-144406」，
 *    與你提供的 confirmName「錯的名字」不符。已中止，未送出任何刪除。」**未送出 RPC**。
 * 2. **正式刪除**：`{id:9, confirmName:"mcp-cb-test-144406"}` → success、stage=`deleted`、
 *    deleteType=`hard-delete`、**verifiedGone=true**，verifyNote「回讀已確認這筆資料不存在於清單中，
 *    硬刪除生效」。deletedRow 完整保留刪除前內容（欄位：amounts / category / categoryKey /
 *    createdAtTimestamp / id / name / remark / status / statusKey / updatedAtTimestamp /
 *    wageringMultiplier），可用於手動重建。
 * 3. **不冪等實測（第 7 節強制要求）**：同一個 id 再刪一次 → success=false、
 *    stage=`pre-read-not-found`（本 tool 的前置讀取就攔下了，scannedPages=1、未送出 RPC）。
 *    ⚠️ 注意這是**本 tool 的守門**先擋下的；若繞過本 tool 直打後端，第二次會是
 *    #loadPresetSnapshot 查不到而回 objectNotFound（源碼 :909-912）——兩者都不是「安靜成功」，
 *    「不冪等」這個結論成立。
 * 4. **硬刪除確認 + 清理確認**：刪除後用
 *    aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset(pageSize=200) 覆核，
 *    rowCount 回到 **4**、ids=[8, 4, 3, 1]，且沒有任何名稱含 `mcp-cb-test` 的殘留——
 *    證實資料列真的消失（硬刪除）**且 dev 環境已完全還原、沒有留下任何測試髒資料**。
 * 5. 「刪除不影響已建立的調整單」「後端沒有使用中保護」兩條來自源碼結構
 *    （DbUserFundAdjustments 沒有 preset 外鍵；method 內無任何前置使用中檢查），
 *    本輪**沒有**製造「有調整單引用中的 preset」情境去實測，如實標記為源碼推得。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { I32_MAX } from '../const.ts';
import { findPresetById, formatPresetRow, type PresetRow } from './create_fund_adjustment_preset.ts';

export function registerDeleteFundAdjustmentPresetTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_delete_fund_adjustment_preset',
        {
            title: 'Permanently delete a fund adjustment preset (HARD delete) — irreversible write',
            description:
                '刪除一筆「資金預設快捷」（rajah: FundAdjustmentPlatform.DeleteFundAdjustmentPreset）。' +
                '對應後台「帳務管理 > 資金調整 > 快捷設置」的刪除。' +
                '⚠️ **這是硬刪除（真正的 DELETE FROM），不是軟刪除**——資料列從資料庫消失，' +
                '連同它的多幣別金額設定一起刪（兩張表在同一個交易內刪除）。' +
                '**本工具集沒有任何復原能力**。（注意：同 server 的 ' +
                'aladdin_platform_rebate_platform_delete_rebate_config 是軟刪除，兩者不要類推。）' +
                '為此本 tool 一定會先把整筆內容讀出來，並原樣放在回傳的 deletedRow 欄位——' +
                '誤刪之後那是唯一能用來手動重建的依據（可把內容餵給 ' +
                'aladdin_platform_fund_adjustment_platform_create_fund_adjustment_preset 建一筆內容相同的，但 id 會是新的）。' +
                '**刪除的影響範圍很小**：preset 只是加款彈窗的金額範本，調整單存的是金額數值本身、不存 preset id，' +
                '所以**刪除不會影響任何已建立的調整單、也不會動到任何會員的錢**，只是之後填表時少一個快捷選項。' +
                '⚠️ **後端完全沒有「使用中」保護**——不檢查有沒有人正在用它，說刪就刪。' +
                '⚠️ **不冪等**：同一個 id 刪第二次會回錯誤（objectNotFound），不是安靜成功。' +
                '若只是想讓它暫時不能被選用，**請改用 ' +
                'aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status 設為 disabled**' +
                '（可逆，效果是加款彈窗挑不到它），不要直接刪。' +
                '⚠️ 這個模組沒有「用 id 查單筆」的後端 method，所以讀取現值是靠對列表逐頁掃描比對 id ' +
                '（上限 20 頁 × 200 筆；preset 是小表，實務上一頁就掃完）。掃不到這個 id 會直接擋下、不送出刪除。' +
                'id 請用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 查出。' +
                '刪除後本 tool 會再讀一次確認資料真的不見了（結果在 verifiedGone 欄位）。' +
                '此操作會寫入後台稽核紀錄（含被刪內容的快照，但稽核紀錄裡的金額是已換算的 normal 值，' +
                '與本 tool 回報的 stored value 數字不同）。',
            inputSchema: {
                id: z
                    .number()
                    .int()
                    .min(1)
                    .max(I32_MAX)
                    .describe(
                        '要刪除的 preset id（rajah 型別 i32），來自 ' +
                        'aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset。' +
                        `⚠️ 必須落在 i32 範圍（1 ~ ${ I32_MAX }）：超過會被 protobuf 無聲截斷成另一個合法 id，` +
                        '結果會**刪掉別筆資料**且無法復原，故本 tool 直接擋下。',
                    ),
                confirmName: z
                    .string()
                    .min(1)
                    .describe(
                        '⚠️ 防呆必填：請填入你認為這個 id 對應的 preset **名稱**。本 tool 會先讀出實際資料，' +
                        '名稱對不上就直接中止、不送出刪除。這是為了避免拿錯 id 誤刪——因為刪除不可逆、且本工具集無法復原。' +
                        '名稱可從 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 取得。',
                    ),
            },
        },
        async ({ id, confirmName }) => {
            // --- 刪除前一定先讀：確認存在、留下快照、並比對防呆名稱 ---
            const found = await findPresetById(id);
            if (found.listR) return asErrorResult(found.listR);
            if (!found.matchedRow) {
                return asTextResult({
                    success: false,
                    stage: 'pre-read-not-found',
                    message: `在資金預設快捷清單中找不到 id=${ id }，已中止，未送出任何刪除。`,
                    scannedPages: found.scannedPages,
                    scannedRows: found.scannedRows,
                    hitScanCap: found.hitScanCap ?? false,
                    hint: found.hitScanCap
                        ? '⚠️ 掃描已觸及上限（20 頁 × 200 筆）而提前停止，**不代表已掃完全部資料**——這個 id 可能存在於更後面。在確認之前不要嘗試強制刪除。'
                        : '已掃描完整個清單仍找不到這個 id（可能早已被刪除）。請先用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 確認。',
                });
            }
            const before: PresetRow = found.matchedRow;

            if (String(before.name ?? '') !== confirmName) {
                return asTextResult({
                    success: false,
                    stage: 'pre-check-name-mismatch',
                    message: `防呆檢查未通過：id=${ id } 的實際名稱是「${ String(before.name ?? '') }」，與你提供的 confirmName「${ confirmName }」不符。已中止，未送出任何刪除。`,
                    hint: '請確認你要刪的是哪一筆。刪除是硬刪除且不可復原，本工具集沒有還原能力。',
                    actualRow: formatPresetRow(before),
                });
            }

            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.DeleteFundAdjustmentPreset(id),
            );
            if (r.failed) {
                return asTextResult({
                    success: false,
                    stage: 'delete',
                    id,
                    errorCode: r.errorCode,
                    message: r.message,
                    hint: '刪除是單一交易，失敗即整批 rollback，資料應維持原樣。可用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 覆核。',
                    // 即使失敗也把讀到的內容附上，方便操作者判斷。
                    row: formatPresetRow(before),
                });
            }

            // --- 回讀確認真的不見了（三態判定：確認已刪 / 仍在 / 回讀本身失敗）---
            const readBack = await findPresetById(id);
            let verifiedGone: boolean | null;
            let verifyNote: string;
            if (readBack.listR) {
                verifiedGone = null;
                verifyNote = `回讀查詢本身失敗（errorCode=${ readBack.listR.errorCode }），無法確認刪除結果——不把它當成刪除成功的證據。請自行覆核。`;
            } else if (readBack.matchedRow) {
                verifiedGone = false;
                verifyNote = '⚠️ RPC 回報刪除成功，但回讀時這筆資料仍然存在。請人工確認後端狀態。';
            } else {
                verifiedGone = true;
                verifyNote = '回讀已確認這筆資料不存在於清單中，硬刪除生效。';
            }

            return asTextResult({
                success: true,
                stage: 'deleted',
                id,
                deleteType: 'hard-delete',
                verifiedGone,
                verifyNote,
                irreversible: true,
                recoveryNote:
                    '本工具集沒有復原能力。若需重建，可把下方 deletedRow 的 name / category / amounts / ' +
                    'wageringMultiplier / remark 餵給 aladdin_platform_fund_adjustment_platform_create_fund_adjustment_preset' +
                    '（金額與倍數都是 stored value，可原樣使用），但新建的 id 會與原本不同。',
                amountsAreStoredValue: true,
                wageringMultiplierRateBase: 10000,
                // 刪除前的完整快照——硬刪除之後這是唯一的重建依據。
                deletedRow: formatPresetRow(before),
            });
        },
    );
}
