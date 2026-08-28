/**
 * tools/set_fund_adjustment_preset_status.ts —
 * aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status
 *
 * rajah: FundAdjustmentPlatform.SetFundAdjustmentPresetStatus(id i32 1, status ActiveStatusEnum 2)（無回傳值）
 * （fund_adjustment_back_office.rajah:526；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.Preset.Status.Switch"（525）——後台
 * 「帳務管理 > 資金調整 > 快捷設置」的啟用/停用開關。非 @NoPublic、非 Placeholder、**無 @Totp**。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:865-902 methodSetFundAdjustmentPresetStatus，
 * 確認有真實 override（驗 status → 讀 before → UPDATE → 檢查影響列數 → 寫 audit log），
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 6 節「寫入 — 狀態轉換」。該節要求的處理如下：
 * - **「`Toggle*` 系列實際上都是『設定為指定狀態』（帶明確目標狀態參數），不要在包裝層自作聰明
 *   先查現況再反轉」**：本 method 確實吃明確的目標 status（rajah:526），本 tool 也**不做**任何
 *   反轉推導——呼叫端要傳 'enabled' 或 'disabled'。
 * - **「檢查同 service/模組附近是否有對應 *StatusInvalid/already* 錯誤碼，若有要提示不冪等」**：
 *   查證結果是**沒有**這類錯誤碼。後端只做兩件檢查：status 必須是 enabled 或 disabled
 *   （:866-868，其他值回 invalidData——例如 ActiveStatusEnum 若還有別的成員也不接受），
 *   以及該 id 存在（:870-880，不存在回 objectNotFound）。**把已停用的再停用一次不會回業務錯誤**，
 *   詳見下面「影響列數」那條的分析與 dev 實測。
 * - **「對只回單一 success bool 或無回傳的批量狀態轉換不能宣稱全部成功」**：本 method 是單筆、
 *   不是批量，不適用。
 * - **「Approve* / Reject* 常伴生 remark，建議設為必填」**：本 method 沒有 remark 參數，不適用。
 *
 * ⚠️ **影響列數檢查：一個源碼上看起來很危險、但實測證明本部署不會發生的陷阱**。
 * 後端在 UPDATE 之後有一段：`if (updateResult.data === 0) return
 * GenieResult.error(ErrorCode.objectNotFound)`（:891-893）。`updateResult.data` 是 MySQL 回報的
 * 影響列數。MySQL 在**未**開啟 CLIENT_FOUND_ROWS 時，對「WHERE 命中但欄位值沒有實際改變」的
 * UPDATE 會回報 0——若本專案的連線是那個模式，把已停用的 preset 再設成停用一次就會收到
 * objectNotFound，訊息與事實完全相反（資料明明存在）。
 * **這是「靠連線旗標才成立」的行為，純讀源碼無法斷定，必須實打。**
 * 2026-08-28 dev 實測結果：**不會發生**——用 forceEvenIfUnchanged=true 對一筆已是 disabled 的
 * preset 再送一次 disabled，後端回傳成功（見下方驗證段第 5 點）。
 * ⚠️ **請只把它當成觀測結果，不要當成機制結論**：本輪**沒有**核對連線字串有沒有帶
 * `flags=FOUND_ROWS`（連線設定是加密的 env，repo 內查不到），所以「這條連線回報的是 matched rows
 * 而非 changed rows」只是從一次觀測反推的可能解釋、未經查證。可靠的結論只有
 * 「本站實測不會回 objectNotFound」。上面那段源碼推測**已被實測推翻**，此處據實保留原推理與反證，
 * 提醒後續維護者不要只憑 `data === 0` 這行就斷言行為。
 * 本 tool 仍保留「目標狀態與現況相同時直接回 no-op、不送出 RPC」的守門，但理由改為：
 * (a) 避免為一次沒有實際變更的操作留下誤導性的稽核紀錄（後端無條件寫 audit，:895-900）；
 * (b) 讓這個操作對呼叫端而言是冪等的。
 * 不是因為會踩到 objectNotFound。要強制送出可用 forceEvenIfUnchanged=true。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **UPDATE 只改 status 一個欄位**：`UPDATE ... SET status = ? WHERE id = ? AND platform_id = ?`
 *   （:885），name / category / amounts / wageringMultiplier / remark 都不會被動到。
 *   本 tool 仍會 round-trip 驗證這一點。
 *
 * - **帶 `AND platform_id = ?`（:885 的同一條 SQL），跨平台改不到別人的資料**；平台由登入態決定。
 *
 * - **存在性檢查在 UPDATE 之前**：`loadObject(DbFundAdjustmentPreset, 'id = ? AND platform_id = ?')`
 *   查不到就回 objectNotFound（:870-880）。
 *
 * - **會寫 audit log（含前後狀態）**：`PlatformActionIdEnum.fundAdjustmentPresetSetStatus,
 *   AuditData.createUpdate({ id, name, status: beforeStatus }, { id, name, status })`（:895-900）。
 *
 * - **停用的實際效果**：停用後這筆 preset 仍會出現在
 *   aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset（該 method 的 WHERE
 *   沒有 status 條件，:738-748），但**不會**出現在
 *   aladdin_platform_fund_adjustment_platform_get_fund_adjustment_presets_by_category
 *   （該 method 的 WHERE 固定帶 `status = ActiveStatusEnum.enabled`，:953-955）——
 *   也就是加款彈窗挑不到它。這正是「停用」的業務意義。
 *
 * - PII（第 8 節）：純設定資料的狀態切換，**不含任何會員個資或財務紀錄**。
 *
 * ⚠️ **這是寫入操作**，但只是切換一個金額範本的啟用狀態、**不會動到任何會員的錢**，
 * 且完全可逆（用同一支 tool 設回去）。
 *
 *
 * ⚠️ **關於「dev 無殘留」的精確說法（本輪 review 指出原本是過度宣稱）**：
 * **業務資料**確實已完全還原——preset 表回到原本的 4 筆（id 8/4/3/1），三輪測試建立的
 * id 9 / 10 / 12 全部刪除、無殘留。但整輪驗證共產生 **13 筆後台稽核紀錄**
 * （3 次 create、4 次 edit、3 次 setStatus、3 次 delete；後端對這四種操作都是無條件寫 audit），
 * **稽核紀錄本身沒有刪除介面、也不該刪**。所以正確的說法是「業務資料已還原、另留有 13 筆
 * fundAdjustmentPreset* 稽核紀錄」，而不是「dev 完全無痕跡」。
 *
 *
 * ⚠️ **多頁掃描路徑本輪未實測**（checklist 第 2/5 節要求的「目標記錄不在第一頁」情境）：
 * findPresetById 的跨頁邏輯在 dev 上完全沒被走到——該站 preset 只有 4 筆，一頁就掃完。
 * 檔頭上面寫的「實務上一頁就掃完」是事實，但不等於跨頁路徑已驗證。
 * （同模組的 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 已用
 * pageSize=1 構造多頁並實測翻頁有效，可作為間接佐證，但那走的是 tool 自己的分頁參數、
 * 不是 findPresetById 的內部迴圈。）
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 測試對象：本輪由 create tool 自建的 preset id=9（name=`mcp-cb-test-144406`、
 * category=manualAddOther），測完已刪除、dev 無殘留。
 * 1. **停用**：`{id:9, status:"disabled"}` → success、stage=`status-set`，
 *    previousStatusKey=`enabled` → currentStatusKey=`disabled`，
 *    otherFieldsAllPreserved=**true**（name / category / wageringMultiplier / remark / amounts
 *    全部未被動到），證實後端 UPDATE 真的只改 status 一欄。
 * 2. **停用後仍出現在 list**：aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset
 *    以名稱查 → rowCount=1、statusKey=`disabled`。
 *    ✅ 這一筆同時補證了 list_fund_adjustment_preset 檔頭「啟用與停用的 preset 都會列出」那條
 *    （該 tool 自己驗證時 dev 上剛好沒有停用中的資料，只能從 SQL 條件推得）。
 * 3. **停用後不再出現在 byCategory**：
 *    aladdin_platform_fund_adjustment_platform_get_fund_adjustment_presets_by_category
 *    (category=manualAddOther, currencyCode=CNY) → rowCount=**0**。
 *    ✅ 這一筆同時補證了 get_fund_adjustment_presets_by_category 檔頭「只回啟用中」那條，
 *    也證實了「停用」的業務意義就是加款彈窗挑不到它。
 * 4. **no-op 守門**：對已是 disabled 的 id=9 再送一次 disabled（不帶 forceEvenIfUnchanged）→
 *    success、stage=`no-op`、訊息「id=9 目前已經是 disabled，未送出任何寫入」。
 * 5. **⚠️ 源碼推測被實測推翻**：帶 forceEvenIfUnchanged=true 對已是 disabled 的 id=9 強制再送一次
 *    disabled → **success=true、stage=`status-set`、沒有任何錯誤碼**。
 *    也就是說檔頭上方提到的「MySQL 未開 CLIENT_FOUND_ROWS 時，值沒變的 UPDATE 影響列數為 0，
 *    會讓後端 `data === 0` 誤判成 objectNotFound」這個風險，**在本站的連線設定下不會發生**
 *    （回報的是 matched rows 而非 changed rows）。這正是 checklist 要求「必須實打、不能只憑源碼
 *    斷言」的實例；本 tool 據此把 no-op 守門的理由改成「避免留下無變更的稽核紀錄 + 讓操作冪等」，
 *    而不再宣稱是為了避開錯誤碼。
 * 6. **改回啟用**：`{id:9, status:"enabled"}` → success，previousStatusKey=`disabled` →
 *    currentStatusKey=`enabled`，完成雙向切換驗證與資料還原。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { I32_MAX, ACTIVE_STATUS_MAP } from '../const.ts';
import { findPresetById, formatPresetRow, amountsDeepEqual, type PresetRow } from './create_fund_adjustment_preset.ts';

export function registerSetFundAdjustmentPresetStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status',
        {
            title: 'Enable or disable a fund adjustment preset — write operation',
            description:
                '啟用或停用一筆「資金預設快捷」（rajah: FundAdjustmentPlatform.SetFundAdjustmentPresetStatus）。' +
                '對應後台「帳務管理 > 資金調整 > 快捷設置」的狀態開關。' +
                '**這是寫入操作**，但只是切換金額範本的啟用狀態、**不會動到任何會員的錢**，且完全可逆。' +
                '⚠️ **要傳明確的目標狀態（enabled / disabled），不是切換（toggle）**——後端就是「設為指定狀態」的語意。' +
                '**停用的實際效果**：停用後這筆仍會出現在 ' +
                'aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset（該清單不篩狀態），' +
                '但**不會**出現在 aladdin_platform_fund_adjustment_platform_get_fund_adjustment_presets_by_category' +
                '（該查詢只回啟用中的），也就是加款彈窗挑不到它。' +
                '本 tool 會先讀現況：**目標狀態與現況相同時直接回報 no-op、不送出 RPC**，讓這個操作對你而言是冪等的，' +
                '也避免為一次沒有實際變更的操作留下誤導性的稽核紀錄（後端是無條件寫稽核的）。' +
                '（已 dev 實測：強制重送相同狀態後端仍回成功，不會出現「找不到資料」的誤導性錯誤。）' +
                '確定要強制送出請帶 forceEvenIfUnchanged=true。' +
                '⚠️ 這個模組沒有「用 id 查單筆」的後端 method，所以讀現況是靠對列表逐頁掃描比對 id ' +
                '（上限 20 頁 × 200 筆；preset 是小表，實務上一頁就掃完）。掃不到這個 id 會直接擋下、不送出寫入。' +
                'id 請用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 查出。' +
                '後端只改 status 一個欄位，其餘欄位不受影響；本 tool 會 round-trip 驗證這一點。' +
                '此操作會寫入後台稽核紀錄（含變更前後狀態）。',
            inputSchema: {
                id: z
                    .number()
                    .int()
                    .min(1)
                    .max(I32_MAX)
                    .describe(
                        '要變更狀態的 preset id（rajah 型別 i32），來自 ' +
                        'aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset。' +
                        `⚠️ 必須落在 i32 範圍（1 ~ ${ I32_MAX }）：超過會被 protobuf 無聲截斷成另一個合法 id，` +
                        '結果會**改到別筆資料**，故本 tool 直接擋下。',
                    ),
                status: z
                    .enum([ 'enabled', 'disabled' ])
                    .describe(
                        '要設定成的目標狀態（rajah ActiveStatusEnum：enabled=1 / disabled=2）。' +
                        '⚠️ 是「設為這個狀態」不是「切換」——後端不接受這兩個以外的值（會回 invalidData）。',
                    ),
                forceEvenIfUnchanged: z
                    .boolean()
                    .default(false)
                    .describe(
                        '預設 false：當目標狀態與現況相同時本 tool 直接回報 no-op、不送出 RPC' +
                        '（讓操作冪等，並避免為沒有實際變更的操作留下稽核紀錄）。設為 true 才會照樣送出。',
                    ),
            },
        },
        async ({ id, status, forceEvenIfUnchanged }) => {
            const targetStatus = ACTIVE_STATUS_MAP[ status ];

            // --- 先讀現況：判斷是否為 no-op，並留下 before 快照供 round-trip 比對 ---
            const found = await findPresetById(id);
            if (found.listR) return asErrorResult(found.listR);
            if (!found.matchedRow) {
                return asTextResult({
                    success: false,
                    stage: 'pre-read-not-found',
                    message: `在資金預設快捷清單中找不到 id=${ id }，已中止，未送出任何寫入。`,
                    scannedPages: found.scannedPages,
                    scannedRows: found.scannedRows,
                    hitScanCap: found.hitScanCap ?? false,
                    hint: found.hitScanCap
                        ? '⚠️ 掃描已觸及上限（20 頁 × 200 筆）而提前停止，**不代表已掃完全部資料**——這個 id 可能存在於更後面。'
                        : '已掃描完整個清單仍找不到這個 id。請先用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 確認正確的 id。',
                });
            }
            const before: PresetRow = found.matchedRow;

            if (before.status === targetStatus && !forceEvenIfUnchanged) {
                return asTextResult({
                    success: true,
                    stage: 'no-op',
                    id,
                    message: `id=${ id } 目前已經是 ${ status }，未送出任何寫入。`,
                    hint:
                        '跳過的理由有兩個：(a) 後端是無條件寫稽核紀錄的，送一次沒有實際變更的更新只會留下' +
                        '一筆誤導性的 audit；(b) 讓這個操作對呼叫端而言是冪等的。' +
                        '（不是為了避開錯誤碼——本站已實測強制重送相同狀態會正常回成功。）' +
                        '要強制送出請帶 forceEvenIfUnchanged=true。',
                    currentRow: formatPresetRow(before),
                });
            }

            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.SetFundAdjustmentPresetStatus(id, targetStatus),
            );
            if (r.failed) {
                return asTextResult({
                    success: false,
                    stage: 'set-status',
                    id,
                    requestedStatus: status,
                    errorCode: r.errorCode,
                    message: r.message,
                    hint:
                        '⚠️ 若這裡出現「找不到資料」類的錯誤但你確定 id 存在：後端有一段「UPDATE 影響列數為 0 → ' +
                        '回 objectNotFound」的判斷，理論上可能在「值沒有實際改變」時誤報' +
                        '（本站 2026-08-28 實測不會，但不同環境的連線設定可能不同）。' +
                        '請用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 覆核實際狀態。',
                    beforeRow: formatPresetRow(before),
                });
            }

            // --- round-trip：確認狀態真的變了，且其他欄位沒被動到 ---
            const readBack = await findPresetById(id);
            if (readBack.listR || !readBack.matchedRow) {
                return asTextResult({
                    success: true,
                    stage: 'set-but-readback-failed',
                    id,
                    message: 'RPC 回報成功，但回讀驗證失敗，無法確認實際狀態。',
                    readBackErrorCode: readBack.listR?.errorCode,
                    hint: '請自行用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 確認。',
                });
            }
            const after: PresetRow = readBack.matchedRow;

            const otherFieldsPreserved = {
                name: after.name === before.name,
                category: Number(after.category) === Number(before.category),
                wageringMultiplier: Number(after.wageringMultiplier) === Number(before.wageringMultiplier),
                remark: String(after.remark ?? '') === String(before.remark ?? ''),
                // 用順序無關的深比對，不用 JSON.stringify（本 server 對後者踩過順序敏感的坑）。
                amounts: amountsDeepEqual(
                    (Array.isArray(before.amounts) ? before.amounts : []).map((link: { code?: string; value?: unknown }) => ({
                        code: String(link?.code ?? ''),
                        value: (Array.isArray(link?.value) ? link.value : []).map(Number),
                    })),
                    after.amounts,
                ),
            };
            const statusChanged = after.status === targetStatus;
            const allPreserved = Object.values(otherFieldsPreserved).every(Boolean);

            return asTextResult({
                success: true,
                stage: 'status-set',
                id,
                requestedStatus: status,
                statusChangedToTarget: statusChanged,
                previousStatusKey: formatPresetRow(before).statusKey,
                currentStatusKey: formatPresetRow(after).statusKey,
                otherFieldsPreserved,
                otherFieldsAllPreserved: allPreserved,
                note:
                    statusChanged && allPreserved
                        ? '狀態已確實變更為目標值，且其餘欄位（名稱/類型/金額/倍數/備註）全部保持原樣。'
                        : '⚠️ 回讀結果與預期不符，請檢視明細與下方前後內容。',
                visibilityNote:
                    status === 'disabled'
                        ? '已停用：這筆仍會出現在 list_fund_adjustment_preset，但不會再出現在 get_fund_adjustment_presets_by_category（加款彈窗挑不到）。'
                        : '已啟用：這筆會重新出現在 get_fund_adjustment_presets_by_category。',
                beforeRow: formatPresetRow(before),
                afterRow: formatPresetRow(after),
            });
        },
    );
}
