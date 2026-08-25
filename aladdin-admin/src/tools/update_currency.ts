/**
 * tools/update_currency.ts — aladdin_admin_currency_admin_update_currency
 *
 * rajah: CurrencyAdmin.UpdateCurrency(id i32 1, name string 2, symbol string 4,
 * displayDigits i32 5) (rajah/services/core.rajah:9-15，需要權限節點
 * AdminManagement.Setting.Currency.Ops.Edit)。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic（service
 * CurrencyAdmin 本身沒有 @NoPublic，只有另一支 service Currency 才是）；agrabah 對應實作
 * agrabah/src/servers/core_back_office/services/currency_admin.ts:87-117（methodUpdateCurrency）
 * 確認有真實實作，非 base class 的 notImplemented。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate 的局部更新」——雖然
 * method 名字不是 CreateOrUpdate，但行為同樣是「只想改 name/symbol/displayDigits 其中幾個
 * 欄位」，RPC 簽名本身就不接受 code/type/decimalPlaces（rajah model Currency 這三欄位標
 * @NoEdit，common.rajah:1182-1196），因此不存在「誤把未帶欄位覆蓋成 0」的地雷，但仍套用
 * 「先讀現值、只覆蓋要改欄位」：因為 RPC 要求 name/symbol/displayDigits 三個欄位都要帶完整值
 * （後端 currency_admin.ts:103-105 是無條件覆蓋、非部分更新語意的 protobuf 稀疏編碼），若呼叫端
 * 只想改其中一欄，本工具會先用 GetCurrencies 撈現值把其餘欄位原樣帶回，避免呼叫端漏帶的欄位被清空。
 *
 * 2026-08-25 讀源碼查證 + 兩輪獨立 review（PASS 前修正兩輪 FAIL 意見）：
 * - CurrencyAdmin 沒有單筆 Get by id 的方法，只有 GetCurrencies(enabledOnly) 全撈；幣別是
 *   全域小型列舉表（不是會持續成長的業務表），比對 method-category-checklist.md 第 2 節
 *   「完全不分頁的全撈：語意上是小型列舉表可放心用」，本工具內部用 GetCurrencies(false) 撈
 *   全部（含停用）再用 id 過濾，取得現值與 round-trip 驗證都走這支；id 供本工具使用的標準
 *   查詢入口是 aladdin_admin_currency_admin_get_currencies（2026-08-25 review 後新增，補上
 *   原本缺的公開查詢 tool）。
 * - displayDigits 的合法範圍是 [0, decimalPlaces]，decimalPlaces 建立後不可變（@NoEdit），
 *   本工具用 GetCurrencies 讀到的現值 decimalPlaces 做上限檢查，不合法時不送出 RPC
 *   （agrabah 端 currency_admin.ts:99-101 也有同樣檢查，本工具屬於提前擋、非取代後端驗證）。
 * - **重要副作用**：寫入成功後後端會 publish ReloadCurrency message（platformId=0，
 *   agrabah/src/servers/core_back_office/services/currency_admin.ts:114），是全平台廣播、
 *   影響所有平台讀取到的幣別顯示（name/symbol/displayDigits），不是只影響某一個平台。
 *   displayDigits 變更會直接改變全平台金額顯示的小數位數，請勿在未確認影響範圍前隨意呼叫。
 * - **讀回可能短暫看到舊值，合併現值時也可能吃到同一個過期快取**（review 對抗性檢驗發現）：
 *   `GetCurrencies` 底層是 core server 的 in-memory 快取（agrabah/src/servers/core/services/currency.ts），
 *   靠 ReloadCurrency message 失效，而 publish 是 fire-and-forget（`.then()`，非 await），經 Redis
 *   pub/sub 非同步送達。除了寫入後的讀回驗證可能查到舊值，本工具開頭用來當「合併基底」的那次
 *   GetCurrencies 呼叫也走同一個快取——若對同一顆幣別連續呼叫本工具（例如第一次只改 name、緊接著
 *   第二次只改 symbol），第二次呼叫若搶在快取失效前讀到，合併基底的 name 會是舊值，被原樣送出並
 *   真的寫回 DB，靜默覆蓋掉第一次的變更。窗口極小（Redis pub/sub 通常毫秒級，遠快於兩次工具呼叫
 *   的間隔），互動式使用幾乎不會命中，但背靠背的批次呼叫要注意；**建議連續更新同一幣別時，每次都
 *   明確帶上你在意的欄位值，不要依賴省略保留現值**。讀回結果與預期不符不代表寫入失敗（RPC 本身已
 *   回成功才會走到讀回這步）。本工具會在偵測到不符時明確標示這個可能性，不自動重試、不用等待掩蓋
 *   （依專案規則禁止用 sleep 解決正確性問題），由呼叫端自行判斷是否要之後再查一次確認。
 * - id 不存在時後端回 ErrorCode.idNotExists，非靜默成功（2026-08-25 dev 實測 errorCode=11）；
 *   displayDigits 超出範圍後端回 invalidData（dev 實測 errorCode=9）。
 * - name/symbol 若呼叫端明確傳空字串 `''`，會被當成「明確要求清空」原樣送出（後端對這兩欄位
 *   零驗證，currency_admin.ts:103-104），不等同「省略、保留現值」——`''` 與 `undefined` 語意不同。
 *   本工具用 zod `.min(1)` 擋掉空字串輸入，避免誤清空全平台可見的幣別名稱/符號。
 * - **DB 欄位長度限制**（2026-08-25 dev 實測撞到，非文件推論）：`currencies` 表 `symbol VARCHAR(10)`、
 *   `name VARCHAR(20)`（agrabah/migrations/core/202410221422_create_currencies.sql:4-6），RPC/rajah
 *   本身不驗證長度，超長時後端回泛用的 `unknownDatabaseError`（dev 實測 errorCode=12，訊息不含
 *   「太長」等可讀線索）。本工具用 zod `.max()` 比照這兩個欄位的 DB 上限提前擋下，避免呼叫端拿到
 *   難以理解的泛用錯誤碼。
 * - **完全沒有實際變更時，後端不是回成功**：`context.relationalDatabase.updateObject` 在送出的新值
 *   與 DB 現值完全相同（無 dirty 欄位）時回 `ErrorCode.nothingChanged`（genie/src/common/error_code.ts:12，
 *   數值 10；2026-08-25 dev 實測驗證），不是本工具自己的邏輯判斷。本工具會辨識這個特定 errorCode，
 *   回傳「未實際變更」的訊息而非泛用錯誤格式，避免呼叫端誤以為是失敗而重試。
 * - 不可修改 code/type/decimalPlaces——這三欄位不在 RPC 參數裡，RPC 層面就不支援，本工具
 *   不提供對應輸入欄位。
 *
 * prod 執行前確認（H36，比照本 server 既有寫入 tool 慣例）：當這個 server 是正式環境時，執行本
 * 工具前必須先用 AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，
 * 取得明確同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）
 * 不需要、也會忽略 confirm 欄位。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ErrorCode } from '/Users/user/aladdin/genie/src/common/index.ts';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerUpdateCurrencyTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_currency_admin_update_currency',
        {
            title: 'Update a global currency\'s name / symbol / display digits',
            description:
                '更新既有全域幣別的 name/symbol/displayDigits（rajah: CurrencyAdmin.UpdateCurrency，' +
                '需要權限節點 AdminManagement.Setting.Currency.Ops.Edit）。code/type/decimalPlaces 建立後' +
                '不可修改，RPC 本身不接受這三個欄位，本工具也不提供。' +
                'id 從 aladdin_admin_currency_admin_get_currencies 取得；沒有單筆查詢 method，本工具內部' +
                '一律用 GetCurrencies(enabledOnly=false) 全撈（幣別是小型列舉表，非持續成長的業務表，全撈' +
                '安全）再依 id 過濾，取得現值後只覆蓋你有帶的欄位，其餘欄位照原值送出（因為 RPC 要求三個' +
                '欄位都要帶完整值，不是部分更新語意，沒讀現值就送等於把未帶欄位清空）。' +
                'name/symbol 若要變更必須是非空字串（本工具拒絕空字串輸入）——傳空字串會被後端當成' +
                '「明確要求清空」而不是「保留現值」，後端對這兩欄位沒有驗證，清空後會直接影響全平台顯示。' +
                'name 最長 20 字元、symbol 最長 10 字元（比照 DB 欄位 VARCHAR 上限，本工具提前擋下；超長' +
                '若不擋，後端只會回一個看不出原因的泛用資料庫錯誤）。' +
                'displayDigits 合法範圍是 [0, 該幣別的 decimalPlaces]（decimalPlaces 不可變，只能參考現值），' +
                '超出範圍本工具會直接拒絕、不送出 RPC。若送出的 name/symbol/displayDigits 三個值合併現值後' +
                '與資料庫現況完全相同（沒有實際變更），後端會回 nothingChanged（非成功、非一般錯誤），本工具' +
                '會識別這個情況並用專屬訊息回報，不當成失敗處理。' +
                '⚠️ 重要副作用：寫入成功會觸發全平台廣播（後端 publish ReloadCurrency，platformId=0），' +
                '立即影響全部平台讀取到的幣別顯示，displayDigits 變更會直接改變全平台金額顯示小數位數，' +
                '請先確認影響範圍再執行。id 不存在時回業務錯誤，不會靜默成功或誤建新資料。' +
                '寫入後本工具會重新呼叫 GetCurrencies 讀回並逐欄比對；若比對不符，可能是後端讀取快取' +
                '尚未因非同步的 ReloadCurrency 廣播而失效（RPC 本身已回成功才會走到這步，不代表寫入失敗），' +
                '本工具會如實標示這個可能性，不會自動重試或等待掩蓋，由呼叫端自行決定是否稍後再查一次確認。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不' +
                '需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('幣別內部 id，來自 aladdin_admin_currency_admin_get_currencies 的回傳結果'),
                name: z.string().min(1).max(20).optional().describe('幣別名稱，最長 20 字元（DB 欄位 VARCHAR(20) 上限）；省略代表保留現值。不接受空字串（會被當成清空，本工具拒絕）'),
                symbol: z.string().min(1).max(10).optional().describe('幣別符號，最長 10 字元（DB 欄位 VARCHAR(10) 上限）；省略代表保留現值。不接受空字串（會被當成清空，本工具拒絕）'),
                displayDigits: z.number().int().min(0).optional().describe('前端顯示小數位數，需 <= 該幣別的 decimalPlaces；省略代表保留現值'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, name, symbol, displayDigits, confirm }) => {
            assertProdConfirmed(confirm);

            const currentR = await withAutoRelogin(() => remote.coreBackOffice.currencyAdmin.GetCurrencies(false));
            if (currentR.failed) return asErrorResult(currentR);

            const current = currentR.data?.currencies?.find((c) => c.id === id);
            if (!current) {
                return asTextResult({ success: false, message: `找不到 id=${ id } 的幣別，未送出更新請求`, currencies: currentR.data?.currencies });
            }

            const nextName = name ?? current.name ?? '';
            const nextSymbol = symbol ?? current.symbol ?? '';
            const nextDisplayDigits = displayDigits ?? current.displayDigits ?? 0;
            if (nextDisplayDigits > (current.decimalPlaces ?? 0)) {
                return asTextResult({
                    success: false,
                    message: `displayDigits=${ nextDisplayDigits } 超過該幣別的 decimalPlaces=${ current.decimalPlaces }，未送出更新請求`,
                    current,
                });
            }

            const r = await withAutoRelogin(() => remote.coreBackOffice.currencyAdmin.UpdateCurrency(id, nextName, nextSymbol, nextDisplayDigits));
            if (r.failed) {
                // genie ErrorCode.nothingChanged（非 AgrabahErrorCodeEnum，asErrorResult 查不到名稱會顯示「未知錯誤碼」，
                // 這裡提前特判給明確訊息）：合併後的新值與 DB 現值完全相同，沒有實際變更，不是失敗。
                if (r.errorCode === ErrorCode.nothingChanged) {
                    return asTextResult({
                        success: true,
                        noChange: true,
                        message: '未產生實際變更：合併後的 name/symbol/displayDigits 與現值完全相同（後端回 nothingChanged），未寫入任何欄位',
                        before: current,
                    });
                }
                return asErrorResult(r);
            }

            const afterR = await withAutoRelogin(() => remote.coreBackOffice.currencyAdmin.GetCurrencies(false));
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    message: '寫入 RPC 已成功，但讀回驗證這一步失敗（不代表寫入失敗）',
                    before: current,
                    readBackError: { errorCode: afterR.errorCode, message: afterR.message },
                });
            }

            const after = afterR.data?.currencies?.find((c) => c.id === id);
            if (!after) {
                return asTextResult({
                    success: true,
                    message: '寫入 RPC 已成功，但讀回時清單中找不到此 id（非預期，不代表寫入失敗）',
                    before: current,
                    currencies: afterR.data?.currencies,
                });
            }

            const fieldChecks = {
                name: { expected: nextName, actual: after.name, matches: after.name === nextName },
                symbol: { expected: nextSymbol, actual: after.symbol, matches: after.symbol === nextSymbol },
                displayDigits: { expected: nextDisplayDigits, actual: after.displayDigits, matches: after.displayDigits === nextDisplayDigits },
                code: { expected: current.code, actual: after.code, matches: after.code === current.code },
                type: { expected: current.type, actual: after.type, matches: after.type === current.type },
                decimalPlaces: { expected: current.decimalPlaces, actual: after.decimalPlaces, matches: after.decimalPlaces === current.decimalPlaces },
                status: { expected: current.status, actual: after.status, matches: after.status === current.status },
            };
            const allMatch = Object.values(fieldChecks).every((c) => c.matches);

            return asTextResult({
                success: true,
                message: allMatch
                    ? '更新成功，讀回逐欄比對相符；此操作已觸發全平台幣別顯示刷新（ReloadCurrency, platformId=0）'
                    : '寫入 RPC 已成功，但讀回逐欄比對有不符欄位——可能是後端讀取快取尚未因非同步 ReloadCurrency 廣播而失效，' +
                      '不代表寫入失敗，見 fieldChecks 明細；可稍後再用 aladdin_admin_currency_admin_get_currencies 查一次確認',
                before: current,
                readBack: after,
                fieldChecks,
            });
        },
    );
}
