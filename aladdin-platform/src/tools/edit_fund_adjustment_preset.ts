/**
 * tools/edit_fund_adjustment_preset.ts — aladdin_platform_fund_adjustment_platform_edit_fund_adjustment_preset
 *
 * rajah: FundAdjustmentPlatform.EditFundAdjustmentPreset(id i32 1, preset FundAdjustmentPresetEdit 2)（無回傳值）
 * （fund_adjustment_back_office.rajah:523；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.Preset.Ops.Edit"（522）——後台
 * 「帳務管理 > 資金調整 > 快捷設置」的編輯。非 @NoPublic、非 Placeholder、**無 @Totp**。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:811-860 methodEditFundAdjustmentPreset，
 * 確認有真實 override（驗證 → 讀 before 快照 → 單一交易內 UPDATE + 覆寫多幣別金額 → 寫 audit log），
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 4 節「寫入 — Upsert / CreateOrUpdate」的精神
 * （method 名雖是 Edit、不是 CreateOrUpdate，但它吃的正是同一個 `FundAdjustmentPresetEdit` model，
 * 面對的是完全相同的「未帶欄位會怎樣」風險，所以套用該節的操作性要求）。
 *
 * ⚠️ **這支是真正的整包覆蓋，後端完全沒有 pre-load 合併**（第 4 節列的三種模式中最危險的第 3 種）。
 * 這不是推測，是逐行讀出來的：`UPDATE ... SET name = ?, category = ?, wagering_multiplier = ?,
 * remark = ? WHERE id = ? AND platform_id = ?`（:825-834）——**四個欄位無條件全部覆蓋**，
 * 呼叫端沒帶到的欄位不會保留原值，會被寫成你這次傳的值（zod 有預設值的話就是預設值）。
 * amounts 則走 `updateAmountsById(...)`（:840）整組覆寫。
 * 因此第 4 節的第 1 條要求——「包這類 method 前必須先呼叫對應的 GetXxxForEdit 取得完整現值，
 * 只覆寫呼叫端明確要改的欄位，其餘原樣帶回。沒有先讀現值就直接建構 payload 呼叫，視為不合格實作」
 * ——在這裡是**硬性必要**而不只是保險。
 * ⚠️ 但本模組**沒有 GetXxxForEdit 這支 sibling method**（rajah:515-532 的 preset 區塊只有
 * List / Create / Edit / SetStatus / Delete / GetByCategory 六支），且 ListFundAdjustmentPresetSearch
 * （rajah:398-403）**不支援用 id 搜尋**。所以「讀現值」只能靠對 ListFundAdjustmentPreset 逐頁掃描
 * 比對 id——即第 5 節「若確實沒有直接查詢介面，只能靠分頁掃描比對業務鍵定位：比照第 2 節 B 級
 * 要求逐頁掃到底、設上限與逾時保護」的情形。實作在 create_fund_adjustment_preset.ts 的
 * findPresetById（與同 server create_or_update_item.ts:204-217 的 findItemById 同構，
 * 上限 20 頁 × 200 筆，觸頂時明確回報 hitScanCap 而不謊稱「已掃描全部」）。
 *
 * 本 tool 的做法（滿足第 4 節三條要求）：
 * 1. 先用 findPresetById 讀出現值；讀不到就直接擋下、**不送出 RPC**（避免用一堆預設值覆蓋掉真實資料）。
 * 2. 把呼叫端明確帶到的欄位覆蓋上去，**沒帶到的一律用讀回的現值補齊**再送出。
 *    所有可編輯欄位在 zod 都是 optional，就是為了能分辨「沒帶」與「帶了空值」。
 * 3. 寫入後再讀一次，逐欄比對：要改的欄位是否真的變了、**沒要求變更的欄位是否仍等於呼叫前的值**
 *    （尤其 amounts 這類陣列與 wageringMultiplier 這類數字欄位——第 4 節特別點名數字欄位為 0 時
 *    容易被誤判成有效值而覆蓋）。比對結果放在回傳的 roundTrip / unchangedFieldsPreserved。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **status 不在 UPDATE 的欄位清單裡，編輯不會動到啟用/停用狀態**（:827 只有 name / category /
 *   wagering_multiplier / remark）。要改狀態請用
 *   aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status。
 *
 * - **id 不存在時回 objectNotFound、不會靜默成功**：`#loadPresetSnapshot(context, id)` 回 null
 *   就 `return GenieResult.error(ErrorCode.objectNotFound)`（:818-821）。
 *   ⚠️ 但注意這個存在性檢查是**在驗證通過之後**才做的（:812-816 先 #validatePresetEdit），
 *   所以對一個不存在的 id 送出格式錯誤的資料，你會先收到 invalidData 而不是 objectNotFound。
 *
 * - **UPDATE 帶 `AND platform_id = ?`（:829），跨平台改不到別人的資料**；平台由登入態決定。
 *
 * - **後端沒有檢查 UPDATE 的影響列數**：:835-838 只看 `updateResult.failed`，
 *   不像 SetFundAdjustmentPresetStatus 有 `updateResult.data === 0` 的判斷（:891-893）。
 *   不過前面已經用 #loadPresetSnapshot 確認過存在，實務上影響有限。
 *
 * - **⚠️ 名稱可以被改成與其他 preset 重複**：#validatePresetEdit（:1128-1173）只檢查名稱非空，
 *   沒有唯一性檢查，DB 也沒有 unique 索引。本 tool 在改名時會先查重並在回傳中警示
 *   （但不擋下——改名本身是合法操作，只是之後只能靠 id 分辨）。
 *
 * - **amounts 必須涵蓋平台全部啟用幣別**（:1166-1170，缺一個回
 *   `invalidData: currency XXX is required`）。因為本 tool 沒帶 amounts 時是用現值補齊，
 *   通常自然滿足；但若呼叫端明確傳了一組不齊的 amounts，本 tool 會在呼叫前就擋下並列出缺漏幣別。
 *
 * - **寫入是單一交易**（:824-841），UPDATE 與金額覆寫任一失敗整批 rollback。
 *
 * - **會寫 audit log（含 before/after 快照）**：
 *   `PlatformActionIdEnum.fundAdjustmentPresetEdit, AuditData.createUpdate(before, after)`（:858）。
 *   ⚠️ audit 快照裡的金額是**已換算成 normal 的**，與本 tool 讀寫的 stored value 數字不同。
 *
 * - **金額與倍數換算基數不同、本 tool 一律不換算**：amounts 的 value 是幣別 stored value
 *   （normal = stored / 10^(decimalPlaces + 2)，jafar/src/exchange.ts:32-38）；
 *   wageringMultiplier 是 Rate stored、基數固定 10000（jafar/src/rate_helper.ts:18）。
 *
 * - PII（第 8 節）：純設定資料，**不含任何會員個資或財務紀錄**，不涉及密鑰/token/密碼。
 *
 * ⚠️ **這是寫入操作**，但只是金額範本設定、**不會動到任何會員的錢**，且可用同一支 tool 改回去。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 測試對象：本輪由 create tool 自建的 preset id=9（name=`mcp-cb-test-144406`、
 * category=manualAddOther、CNY:[10000,20000] / USD:[30000] / USDT:[40000]、
 * wageringMultiplier=10000、remark="mcp tool 驗證用，測完會刪"），測完已刪除、dev 無殘留。
 * 1. **「只帶想改的欄位、其餘自動沿用現值」實測（第 4 節第 1 條）**：只傳 `{id:9, remark:"改過的備註"}` →
 *    success、stage=`edited`。roundTripAllMatched=**true**；
 *    unchangedFieldsPreserved = `{name:true, category:true, wageringMultiplier:true, amounts:true, status:true}`、
 *    unchangedFieldsAllPreserved=**true**。讀回的 amounts 仍是完整三幣別
 *    `[{CNY:[10000,20000]}, {USD:[30000]}, {USDT:[40000]}]`——證實在「後端整包覆蓋、沒有 pre-load」的
 *    前提下，本 tool 的讀-改-寫真的保住了沒帶到的欄位（若直接送空 payload，這些欄位會被清掉）。
 * 2. **數字欄位 0 的陷阱實測（第 4 節第 2 條特別點名）**：只傳 `{id:9, wageringMultiplier:0}` →
 *    讀回 wageringMultiplier=**0**（證實 0 被當成「明確要設成 0」而非「沒帶」），
 *    同時 remark 仍是上一步改成的「改過的備註」、amounts 三幣別完好、status 未變。
 *    這一組同時驗證了兩個方向：帶 0 有效、沒帶的欄位不受影響。
 * 3. **amounts 未涵蓋全部啟用幣別被前置檢查擋下**：`{id:9, amounts:[{code:"CNY",...}]}` →
 *    success=false、stage=`pre-check-missing-currency`，明列缺少 USD、USDT，**未送出任何寫入**。
 * 4. **id 不存在時擋下、不送出**：`{id:987654, remark:"x"}` → success=false、
 *    stage=`pre-read-not-found`，scannedPages=1、hitScanCap=**false**
 *    （代表是真的掃完整份清單才確定找不到，不是掃描觸頂提前放棄——這個區分很重要，
 *    觸頂時本 tool 會在 hint 明講「不代表已掃完全部資料」）。
 *    此時**完全沒有送出寫入**，不會用一堆預設值覆蓋掉真實資料。
 * 5. 「status 不在後端 UPDATE 欄位清單裡」在第 1、2 點的 unchangedFieldsPreserved.status=true
 *    得到驗證（編輯前後 status 皆維持 enabled）。
 * 6. **改名重複警示**未在 dev 上實際觸發（本輪沒有製造重名資料），該行為來自源碼
 *    （#validatePresetEdit 無唯一性檢查）與 create tool 的查重實測，如實標記為未實測分支。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { FundAdjustmentPresetEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { I32_MAX, MANUAL_ADD_CATEGORY_KEYS, manualAddCategoryKeyToNumber } from '../const.ts';
import {
    findPresetById,
    findPresetsByName,
    formatPresetRow,
    amountsDeepEqual,
    listEnabledCurrencyCodes,
    type PresetRow,
} from './create_fund_adjustment_preset.ts';

type AmountLink = { code: string; value: number[] };

/** 把讀回的 amounts（可能含 Long 已被 deepFixLongs 轉過）正規化成送出用的形狀。 */
function toAmountLinks(raw: unknown): AmountLink[] {
    if (!Array.isArray(raw)) return [];
    return raw
        .filter((link): link is { code?: string; value?: unknown } => Boolean(link))
        .map((link) => ({
            code: String(link.code ?? ''),
            value: (Array.isArray(link.value) ? link.value : []).map(Number),
        }))
        .filter((link) => link.code !== '');
}

export function registerEditFundAdjustmentPresetTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_edit_fund_adjustment_preset',
        {
            title: 'Edit an existing fund adjustment preset (read-modify-write) — write operation',
            description:
                '編輯一筆既有的「資金預設快捷」（rajah: FundAdjustmentPlatform.EditFundAdjustmentPreset）。' +
                '對應後台「帳務管理 > 資金調整 > 快捷設置」的編輯。' +
                '**這是寫入操作**，但只是金額範本設定、**不會動到任何會員的錢**，改錯了可以再改回來。' +
                '⚠️ **後端是整包覆蓋、完全沒有把舊值合併回來**（`UPDATE ... SET name=?, category=?, ' +
                'wagering_multiplier=?, remark=?` 四個欄位無條件全寫）。所以本 tool 一律先讀出現值、' +
                '把你沒帶到的欄位用現值補齊之後才送出——**你只需要傳想改的欄位**，其餘不用帶。' +
                '⚠️ 這個模組**沒有「用 id 查單筆」的後端 method**，所以讀現值是靠對列表逐頁掃描比對 id ' +
                '（上限 20 頁 × 200 筆；preset 是小表，實務上一頁就掃完）。若掃不到這個 id，' +
                '本 tool 會**直接擋下、不送出任何寫入**，避免用預設值覆蓋掉真實資料。' +
                '⚠️ **編輯不會改動啟用/停用狀態**（status 不在後端的 UPDATE 欄位清單裡）。要改狀態請用 ' +
                'aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status。' +
                '⚠️ **名稱可以被改成與其他 preset 重複**（後端與 DB 都沒有唯一性限制）。本 tool 在你改名時' +
                '會先查重並在回傳裡警示，但不會擋下——重名之後只能靠 id 分辨。' +
                '⚠️ **amounts 是整組覆寫，不是逐幣別合併**：一旦你傳了 amounts，就必須涵蓋平台全部啟用中的幣別' +
                '（少一個後端整筆拒絕，本 tool 會在送出前先擋下並列出缺漏）。不想動金額就整個不要帶。' +
                '⚠️ **金額與稽核倍數的 stored 表示不同、本 tool 一律不換算**：amounts 的 value 是幣別 stored value' +
                '（normal × 10^(decimalPlaces + 2)）；wageringMultiplier 是 Rate stored、基數固定 10000' +
                '（1 倍 = 10000）。請自行換算好再傳。' +
                'id 請用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 查出。' +
                '寫入後本 tool 會再讀一次並逐欄比對：你要改的欄位是否真的變了、' +
                '**沒要求變更的欄位是否仍等於呼叫前的值**（結果在 roundTrip 與 unchangedFieldsPreserved）。' +
                '此操作會寫入後台稽核紀錄（含變更前後快照）。',
            inputSchema: {
                id: z
                    .number()
                    .int()
                    .min(1)
                    .max(I32_MAX)
                    .describe(
                        '要編輯的 preset id（rajah 型別 i32），來自 ' +
                        'aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset。' +
                        `⚠️ 必須落在 i32 範圍（1 ~ ${ I32_MAX }）：超過會被 protobuf 無聲截斷成另一個合法 id，` +
                        '結果會**改到別筆資料**，故本 tool 直接擋下。',
                    ),
                name: z.string().min(1).optional().describe('新的快捷名稱。**不帶＝維持原值**。⚠️ 後端不做重名檢查。'),
                category: z
                    .enum(MANUAL_ADD_CATEGORY_KEYS)
                    .optional()
                    .describe('新的上分類型（10 個手動上分類型之一）。**不帶＝維持原值**。'),
                amounts: z
                    .array(
                        z.object({
                            code: z.string().min(1).describe('幣別代碼，例如 "CNY"'),
                            value: z
                                .array(z.number().int().min(0))
                                .min(1)
                                .describe('該幣別的候選金額陣列（stored value，未換算）。後端要求非空、每個值為非負整數。'),
                        }),
                    )
                    .min(1)
                    .optional()
                    .describe(
                        '新的多幣別金額（rajah [CurrencyAmountLink]，value 本身是陣列）。**不帶＝維持原值**。' +
                        '⚠️ 一旦帶了就是**整組覆寫**，必須涵蓋平台全部啟用中的幣別，少一個後端整筆拒絕。',
                    ),
                wageringMultiplier: z
                    .number()
                    .int()
                    .min(0)
                    .optional()
                    .describe(
                        '新的稽核倍數，**Rate stored、基數 10000**（10000 = 1 倍、0 = 不需稽核）。**不帶＝維持原值**。' +
                        '⚠️ 帶 0 是「明確設成不需稽核」，與不帶（維持原值）意義不同。',
                    ),
                remark: z
                    .string()
                    .optional()
                    .describe('新的備註。**不帶＝維持原值**；要清空請明確傳空字串 ""。'),
            },
        },
        async ({ id, name, category, amounts, wageringMultiplier, remark }) => {
            // --- 步驟 1：先讀現值（第 4 節硬性要求；本模組沒有 GetXxxForEdit，只能逐頁掃描）---
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
                        ? '⚠️ 掃描已觸及上限（20 頁 × 200 筆）而提前停止，**不代表已掃完全部資料**——這個 id 可能存在於更後面。請縮小範圍後再試，或改用後台頁面。'
                        : '已掃描完整個清單仍找不到這個 id。請先用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 確認正確的 id。',
                });
            }
            const before: PresetRow = found.matchedRow;
            const beforeAmounts = toAmountLinks(before.amounts);

            // --- 步驟 2：只覆蓋明確帶到的欄位，其餘用現值補齊 ---
            const nextName = name ?? String(before.name ?? '');
            const nextCategory = category !== undefined ? manualAddCategoryKeyToNumber(category) : Number(before.category ?? 0);
            const nextAmounts: AmountLink[] = amounts ?? beforeAmounts;
            const nextWageringMultiplier = wageringMultiplier ?? Number(before.wageringMultiplier ?? 0);
            const nextRemark = remark ?? String(before.remark ?? '');

            // 呼叫端明確帶了 amounts 時，先自行檢查是否涵蓋全部啟用幣別（後端只回籠統的 invalidData）。
            if (amounts) {
                const currencies = await listEnabledCurrencyCodes();
                if (currencies.r) return asErrorResult(currencies.r);
                const providedCodes = new Set(amounts.map((link) => link.code.toUpperCase()));
                const missing = (currencies.codes ?? []).filter((code) => !providedCodes.has(code.toUpperCase()));
                if (missing.length > 0) {
                    return asTextResult({
                        success: false,
                        stage: 'pre-check-missing-currency',
                        message: `amounts 缺少平台啟用幣別：${ missing.join(', ') }。後端會整筆拒絕（invalidData: currency XXX is required），已中止，未送出任何寫入。`,
                        hint: 'amounts 是整組覆寫，必須涵蓋全部啟用幣別。不想改金額的話，整個不要帶 amounts 即可（本 tool 會沿用現值）。',
                        enabledCurrencyCodes: currencies.codes,
                        providedCurrencyCodes: [ ...providedCodes ],
                        currentAmounts: beforeAmounts,
                    });
                }
            }

            // 改名時查重（不擋下，只警示）。
            let renameCollidesWith: unknown[] = [];
            if (name && name !== before.name) {
                const dup = await findPresetsByName(name);
                if (!dup.listR && dup.rows) {
                    renameCollidesWith = dup.rows.filter((row) => row.id !== id).map(formatPresetRow);
                }
            }

            // --- 步驟 3：送出 ---
            const preset = FundAdjustmentPresetEdit.create({
                name: nextName,
                category: nextCategory,
                amounts: nextAmounts.map((link) => ({ code: link.code, value: link.value })),
                wageringMultiplier: nextWageringMultiplier,
                remark: nextRemark,
            });

            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.EditFundAdjustmentPreset(id, preset),
            );
            if (r.failed) {
                return asTextResult({
                    success: false,
                    stage: 'edit',
                    errorCode: r.errorCode,
                    message: r.message,
                    hint:
                        '寫入是單一交易，失敗即整批 rollback，資料應維持原樣。' +
                        '可用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 覆核。',
                    attemptedPayload: { name: nextName, category: nextCategory, wageringMultiplier: nextWageringMultiplier, remark: nextRemark, amounts: nextAmounts },
                    beforeRow: formatPresetRow(before),
                });
            }

            // --- 步驟 4：round-trip，逐欄比對（含「沒要求變更的欄位是否被保留」）---
            const readBack = await findPresetById(id);
            if (readBack.listR || !readBack.matchedRow) {
                return asTextResult({
                    success: true,
                    stage: 'edited-but-readback-failed',
                    message: 'RPC 回報編輯成功，但回讀驗證失敗，無法確認實際內容。',
                    readBackErrorCode: readBack.listR?.errorCode,
                    hint: '請自行用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 確認。',
                });
            }
            const after: PresetRow = readBack.matchedRow;

            const roundTrip = {
                name: after.name === nextName,
                category: Number(after.category) === nextCategory,
                wageringMultiplier: Number(after.wageringMultiplier) === nextWageringMultiplier,
                remark: String(after.remark ?? '') === nextRemark,
                amountsDeepEqual: amountsDeepEqual(nextAmounts, after.amounts),
            };
            // 第 4 節第 2 條：逐欄比對「沒有要求變更的欄位」是否仍等於呼叫前的值。
            const unchangedFieldsPreserved: Record<string, boolean> = {};
            if (name === undefined) unchangedFieldsPreserved.name = after.name === before.name;
            if (category === undefined) unchangedFieldsPreserved.category = Number(after.category) === Number(before.category);
            if (wageringMultiplier === undefined) unchangedFieldsPreserved.wageringMultiplier = Number(after.wageringMultiplier) === Number(before.wageringMultiplier);
            if (remark === undefined) unchangedFieldsPreserved.remark = String(after.remark ?? '') === String(before.remark ?? '');
            if (amounts === undefined) unchangedFieldsPreserved.amounts = amountsDeepEqual(beforeAmounts, after.amounts);
            // status 從來不在後端的 UPDATE 欄位清單裡，一併驗證它真的沒被動到。
            unchangedFieldsPreserved.status = after.status === before.status;

            const allMatched = Object.values(roundTrip).every(Boolean);
            const allPreserved = Object.values(unchangedFieldsPreserved).every(Boolean);

            return asTextResult({
                success: true,
                stage: 'edited',
                id,
                roundTrip,
                roundTripAllMatched: allMatched,
                unchangedFieldsPreserved,
                unchangedFieldsAllPreserved: allPreserved,
                note:
                    allMatched && allPreserved
                        ? '送出值與讀回值逐欄一致，且未指定變更的欄位（含 status 與 amounts）都保持原值。'
                        : '⚠️ 有欄位比對不符，請檢視 roundTrip / unchangedFieldsPreserved 明細與下方前後內容。',
                renameCollidesWith,
                renameWarning: renameCollidesWith.length > 0
                    ? '⚠️ 改名後與其他 preset 同名（後端與 DB 都不做唯一性限制），之後只能靠 id 分辨。'
                    : undefined,
                amountsAreStoredValue: true,
                wageringMultiplierRateBase: 10000,
                beforeRow: formatPresetRow(before),
                afterRow: formatPresetRow(after),
            });
        },
    );
}
