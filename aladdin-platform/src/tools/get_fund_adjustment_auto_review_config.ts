/**
 * tools/get_fund_adjustment_auto_review_config.ts —
 * aladdin_platform_fund_adjustment_platform_get_fund_adjustment_auto_review_config
 *
 * rajah: FundAdjustmentPlatform.GetFundAdjustmentAutoReviewConfig() (config FundAdjustmentAutoReviewConfig 1)
 * （fund_adjustment_back_office.rajah:539；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.List.AutoReviewConfig"（538）——後台
 * 「帳務管理 > 資金調整 > 調整列表 > 自動審核配置」（rajah:534 的區塊註解就是這個路徑）。
 * 非 @NoPublic、非 Placeholder、無 @Totp。無參數。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:970-984 methodGetFundAdjustmentAutoReviewConfig，
 * 確認有真實 override（並行查四個 currency link serviceId），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」——無參數、回傳單一 model。
 * 該節的 id/複合 key 檢查項在此不適用（沒有 id）；「跨租戶風險」由 context.platformId（:971）
 * 結構性擋住；「Get 前綴不保證唯讀」已逐行確認：只有四個 queryByIdWithoutError 讀取
 * （currency_link_manager.ts:98）與一次 fromObject，**沒有任何寫入**，是真的唯讀。
 *
 * 這個配置是什麼：資金調整單建立後的**自動審核閘門**。上分/下分各有一組「開關 + 金額門檻」，
 * 而且是**逐幣別**設定的。開關啟用且金額未超過門檻時，單子會被系統自動核准（審核結果會反映在
 * 調整單的 autoReviewResult 欄位，例如超過門檻是 rejectedExceedAmount）。
 * ⚠️ 對應的寫入 method（CreateOrUpdateFundAdjustmentAutoReviewConfig，rajah:542）**本 MCP 刻意
 * 沒有實作**——它等同調整金流風控閘門，已標記為 needs_clarification 待使用者裁示。本 tool 只讀。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **四個欄位都是 [CurrencyLink] 多幣別陣列，不是單一數值**：addStatus / addLimit /
 *   deductStatus / deductLimit（rajah:458-467），元素形狀是 `{ code, value }`
 *   （common.rajah:1179-1182，value 是 i64）。
 *   ⚠️ 注意這裡是 **CurrencyLink（value 為單一 i64）**，與同 domain 的 preset amounts 用的
 *   **CurrencyAmountLink（value 為 i64 陣列）**（common.rajah:1184-1187）**不是同一個型別**，
 *   不要把兩者的解析方式弄混。
 *
 * - **兩個 status 欄位的 value 是 ActiveStatusEnum（1 啟用 / 2 禁用），不是布林**：
 *   rajah:459 的欄位註解原文即「value = ActiveStatusEnum：1 啟用 / 2 禁用」。本 tool 另附
 *   人類可讀的解析結果，但保留原始陣列不動。
 *
 * - **⚠️ 未設定過的幣別「不會出現在清單裡」，不是回 0**：method 上方的 agrabah 註解原文
 *   （:968）就是「僅回已設定的幣別；未設定者不出現在清單中（前端與平台幣別清單自行合併）」。
 *   實作上四個欄位各自呼叫 queryByIdWithoutError（:976-979），查不到就是空陣列。
 *   所以**不能用「某幣別不在 addStatus 裡」推論它是停用**——正確做法是把
 *   aladdin_platform_currency_platform_get_currencies 的平台幣別清單與這裡的結果自行合併，
 *   缺席者視為「尚未設定」。本 tool 會把四個欄位各自出現的幣別集合明列出來，方便呼叫端比對。
 *
 * - **四個欄位彼此獨立、幣別集合不保證一致**：它們存在 id_currency_links 的四個不同 serviceId
 *   （CurrencyLinkServiceIdEnum.fundAdjustmentAutoReviewAddStatus / AddLimit / DeductStatus /
 *   DeductLimit），平台層級 targetId 固定為 0（AUTO_REVIEW_CONFIG_TARGET_ID = 0，
 *   fund_adjustment_manager.ts:44）。理論上可能出現「某幣別有 addStatus 卻沒有 addLimit」
 *   的不對稱狀態，呼叫端不要假設四個陣列等長或同一組幣別。
 *
 * - **⚠️ addLimit / deductLimit 是 stored value**：本 method 直接回傳 currency link 的原始
 *   value，**沒有換算**——對照同檔的稽核快照 helper #buildAutoReviewConfigAuditSnapshot
 *   （:1114-1122）才會呼叫 `Exchange.storedToNormal(row?.addLimit ?? 0, decimalPlaces)`
 *   （:1119、:1121）轉成 normal 寫進 audit log。也就是說：**audit log 裡的門檻是已換算的、
 *   這支 tool 回的是未換算的**，兩邊數字看起來會差很多，不是 bug。
 *   換算 `normal = stored / 10^(decimalPlaces + 2)`（jafar/src/exchange.ts:32-38），
 *   decimalPlaces 依幣別用 aladdin_platform_currency_platform_get_currencies 查。
 *
 * - **門檻的業務範圍是 normal 1~99999**：寫入端 method 的註解（:988）明寫「開關啟用時門檻必填且
 *   normal 1~99999，關閉則門檻寫 0」，驗證函式是 isAutoReviewAmountLimitValid（:1041-1042）。
 *   讀取端不做任何驗證，DB 有什麼就回什麼。
 *
 * - PII（第 8 節）：回傳是純平台層級的風控設定，**完全不含任何會員個資或財務紀錄**。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 1. **正常查詢（無參數）**：success。四個欄位都回三個幣別——
 *    addStatus = [CNY:1, USD:1, USDT:1]（本 tool 翻成 addStatusByCurrency
 *    `{CNY:"enabled", USD:"enabled", USDT:"enabled"}`）、
 *    deductStatus 同樣三個皆 enabled；
 *    addLimit = [CNY:200000, USD:100000, USDT:50000]、deductLimit 同值。
 *    確認 status 的 value 真的是 ActiveStatusEnum 數字（1）而非布林。
 * 2. **「未設定的幣別不會出現」實證**：用
 *    aladdin_platform_currency_platform_get_currencies 查得該平台共有 **6** 個幣別——
 *    INR(status=2) / CNY(1) / TWD(2) / JPY(2) / USD(1) / USDT(1)。
 *    自動審核配置只出現 CNY / USD / USDT 三個，**INR / TWD / JPY 完全缺席**。
 *    這正是檔頭警告的情境：缺席代表「尚未設定」，不代表「自動審核已停用」。
 *    本 tool 的 presentCurrencyCodes 欄位讓呼叫端能直接跟幣別清單做差集比對。
 * 3. **四個欄位的幣別集合在本輪剛好一致**（都是 CNY/USD/USDT），所以「可能不對稱」這一條
 *    在現有資料上沒有被觀察到——該結論來自四個欄位各自獨立 serviceId 查詢的源碼結構
 *    （:976-979），如實標記為源碼推得而非實測。
 * 4. **stored value 換算對帳**：addLimit CNY=200000，CNY decimalPlaces=2 → 除數 10^4 →
 *    normal = 20.00，落在後端規定的門檻有效範圍 normal 1~99999 內，與寫入端註解（:988）自洽。
 * 5. **⚠️ 實測到「不能假設所有幣別都是 2 位小數」的真實反例**：同一次 get_currencies 查詢顯示
 *    **JPY 的 decimalPlaces 是 0**（其餘 INR/CNY/TWD/USD/USDT 為 2）。若之後有人替 JPY 設定
 *    自動審核門檻，它的換算除數會是 10^(0+2)=100 而不是 10000。這條實測結果也回頭佐證了本 domain
 *    其他 tool「decimalPlaces 一律逐幣別查、不要假設」的要求不是形式主義。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs, ACTIVE_STATUS_MAP } from '../const.ts';

type Link = { code?: string; value?: number };

/** 把 [CurrencyLink] 的 status 陣列翻成 { 幣別: 'enabled' | 'disabled' | 原始數字 } 方便判讀。 */
function statusLinksToMap(links: Link[]): Record<string, string | number> {
    const out: Record<string, string | number> = {};
    for (const link of links) {
        if (!link?.code) continue;
        const hit = Object.entries(ACTIVE_STATUS_MAP).find(([ , v ]) => v === link.value);
        out[ link.code ] = hit ? hit[ 0 ] : (link.value ?? 0);
    }
    return out;
}

function codesOf(links: Link[]): string[] {
    return links.map((link) => link?.code).filter((code): code is string => Boolean(code));
}

export function registerGetFundAdjustmentAutoReviewConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_get_fund_adjustment_auto_review_config',
        {
            title: 'Get the per-currency auto-review gate config for fund adjustments (read-only)',
            description:
                '讀取本平台「資金調整自動審核配置」——上分／下分各自的自動審核開關與金額門檻，**逐幣別設定**' +
                '（rajah: FundAdjustmentPlatform.GetFundAdjustmentAutoReviewConfig），對應後台' +
                '「帳務管理 > 資金調整 > 調整列表 > 自動審核配置」。無參數，範圍由登入平台決定。' +
                '這個配置決定調整單建立後會不會被系統自動核准；自動審核的結果會反映在調整單的 ' +
                'autoReviewResult 欄位（可用 aladdin_platform_fund_adjustment_platform_list_user_fund_adjustment 查）。' +
                '⚠️ **本 MCP 只提供讀取、沒有對應的寫入 tool**：修改這個配置等同調整金流風控閘門，' +
                '需要人為裁示，不在本工具集的能力範圍內。要改請走後台頁面。' +
                '⚠️ **未設定過的幣別「不會出現在清單裡」，不是回 0 或 disabled**：後端只回已設定的幣別。' +
                '所以**不能因為某個幣別不在 addStatus 裡就判定它是停用的**——那代表「尚未設定」。' +
                '要得到完整視圖，請把 aladdin_platform_currency_platform_get_currencies 的平台幣別清單' +
                '與本 tool 的結果自行合併；本 tool 已把四個欄位各自出現的幣別集合列在 presentCurrencyCodes 方便比對。' +
                '⚠️ **四個欄位彼此獨立、幣別集合不保證一致**（存在四個不同的 serviceId），' +
                '可能出現「某幣別有開關卻沒有門檻」的不對稱狀態，不要假設四個陣列等長或同一組幣別。' +
                '⚠️ **addStatus / deductStatus 的 value 是 ActiveStatusEnum（1=啟用、2=禁用），不是布林**；' +
                '本 tool 另附 addStatusByCurrency / deductStatusByCurrency 兩張已翻譯的對照表，原始陣列也保留。' +
                '⚠️ **addLimit / deductLimit 是 stored value（未換算）**：normal = stored / 10^(該幣別 decimalPlaces + 2)，' +
                '2 位小數的幣別即除以 10000；decimalPlaces 用 aladdin_platform_currency_platform_get_currencies 查。' +
                '（順帶一提，後台稽核 log 裡記的門檻是**已換算**的 normal 值，與本 tool 回的數字差一個倍率，不是 bug。）' +
                '門檻的業務有效範圍是 normal 1~99999（開關關閉時門檻存 0），但讀取端不做驗證，DB 有什麼就回什麼。' +
                '⚠️ 這裡的元素型別是 CurrencyLink（value 是**單一數字**），與同模組 preset 的 amounts 用的 ' +
                'CurrencyAmountLink（value 是**陣列**）不同，解析方式別弄混。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。回傳是平台層級的風控設定，不含任何會員個資。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.GetFundAdjustmentAutoReviewConfig(),
            );
            if (r.failed) return asErrorResult(r);

            const config = deepFixLongs(r.data?.config ?? null) as {
                addStatus?: Link[];
                addLimit?: Link[];
                deductStatus?: Link[];
                deductLimit?: Link[];
            } | null;

            const addStatus = config?.addStatus ?? [];
            const addLimit = config?.addLimit ?? [];
            const deductStatus = config?.deductStatus ?? [];
            const deductLimit = config?.deductLimit ?? [];

            return asTextResult({
                success: true,
                limitsAreStoredValue: true,
                unsetCurrenciesAreAbsentNotZero: true,
                config: { addStatus, addLimit, deductStatus, deductLimit },
                addStatusByCurrency: statusLinksToMap(addStatus),
                deductStatusByCurrency: statusLinksToMap(deductStatus),
                // 四個欄位各自出現了哪些幣別——與 get_currencies 的平台幣別清單比對即可找出「尚未設定」的幣別。
                presentCurrencyCodes: {
                    addStatus: codesOf(addStatus),
                    addLimit: codesOf(addLimit),
                    deductStatus: codesOf(deductStatus),
                    deductLimit: codesOf(deductLimit),
                },
            });
        },
    );
}
