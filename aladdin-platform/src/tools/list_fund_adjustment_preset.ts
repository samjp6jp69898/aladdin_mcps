/**
 * tools/list_fund_adjustment_preset.ts — aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset
 *
 * rajah: FundAdjustmentPlatform.ListFundAdjustmentPreset(search ListFundAdjustmentPresetSearch 1,
 * page i32 2, pageSize i32 3) (rows [FundAdjustmentPreset] 1, totalPage i32 2)
 * （fund_adjustment_back_office.rajah:517；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.Preset"（516）——後台
 * 「帳務管理 > 資金調整 > 快捷設置」列表頁
 * （前端 abu/platform/src/pages/finance/FundAdjustmentPresetList.vue）。
 * 非 @NoPublic、非 Placeholder、無 @Totp。）
 *
 * 「資金預設快捷」是什麼：手動上分時可以套用的金額範本。一筆 preset = 一個名稱 + 一個上分類型
 * + 每個幣別各一組候選金額 + 一個稽核倍數。操作者在加款彈窗挑一個 preset，就自動帶入金額與
 * 稽核金額（前端 FundAdjustmentPresetPickerPopup.vue:91 用
 * `amount * wageringMultiplier / RateBase` 算出稽核金額）。
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:735-762 methodListFundAdjustmentPreset，
 * 確認有真實 override（自組 WHERE + getPageData + 批次補多幣別金額），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」的 **A 級**——search struct
 * （ListFundAdjustmentPresetSearch，rajah:398-403）有 `names`（快捷名稱複數，等同業務鍵）
 * 可鎖定目標。A 級要求「zod schema 必須對照 rajah model 全部欄位列出，包含 @Hide 欄位」——
 * 該 model 只有 names 與 category 兩個欄位、**沒有 @Hide 欄位**，本 tool 兩個全部列出。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **⚠️ 這是本 domain 內唯一能用 id 反查單筆 preset 的途徑**：整個 FundAdjustmentPlatform
 *   **沒有 GetFundAdjustmentPresetById／GetPresetForEdit 這類 sibling method**（rajah:515-532
 *   的 preset 區塊只有 List / Create / Edit / SetStatus / Delete / GetByCategory 六支），
 *   而 search 只支援 names 與 category、**不支援 id**。所以 Edit / SetStatus / Delete 這些吃 id
 *   的寫入 tool 想在動手前讀出現值，只能靠本 tool 翻頁比對 id。
 *   好消息是 `id` 雖然在 rajah 標了 @Hide（rajah:409-410），**protobuf 仍然會傳、本 tool 有回傳**
 *   （@Hide 只代表後台表單不顯示）。搭配 `pageSize` 一次取大一點，通常一頁就掃得完。
 *
 * - **沒有任何刪除旗標可濾，因為刪除是硬刪除**：WHERE 只有 `platform_id = ?`（:738-739）加上
 *   選填的 names / category（:741-748），沒有 `deleted = 0` 這類條件——對照
 *   methodDeleteFundAdjustmentPreset 用的是 `DELETE FROM`（:917）真的把列刪掉，所以本來就不需要
 *   軟刪除條件。列出來的都是真實存在的資料。
 *
 * - **啟用與停用的 preset 都會列出**：WHERE 沒有 status 條件。停用中的 preset 仍會出現在本清單裡，
 *   status 欄位自己會標明（ActiveStatusEnum：enabled=1 / disabled=2）。
 *   ⚠️ 對照 GetFundAdjustmentPresetsByCategory（:946-964）的 WHERE **有** `status = enabled`
 *   （:953-954），兩支的筆數本來就會不一致，不是錯誤。
 *
 * - **names 是精確 `IN (?)` 比對、不是模糊比對**：`whereColumns.push('name IN (?)')`（:742）。
 *   名稱要完全相同才查得到，不支援部分比對。
 *
 * - **⚠️ category 的 searchNotEmpty 0 值陷阱在這裡不成立、但要注意 enum 落差**：category 走
 *   `searchNotEmpty(search.category)`（:745），ManualAddCategoryEnum 的值從 1 起跳
 *   （common.rajah:2606-2627），沒有合法值為 0 的問題。但 rajah 宣告的是 ManualAddCategoryEnum
 *   （只有上分那 10 個），而後端寫入時的驗證 #validatePresetEdit 檢查的卻是
 *   `ManualCategoryEnum.hasOwnProperty(preset.category)`（:1132-1134，19 個值含下分）——
 *   兩者不一致，理論上 DB 裡可能存在下分類型的 preset。本 tool 的搜尋條件遵守 rajah 契約
 *   只開放 10 個上分類型，但回傳解讀用的是完整的 ManualCategoryEnum 對照，
 *   所以即使真的撈到下分類型也讀得懂、不會顯示成 undefined。
 *
 * - **排序固定 `created_at DESC`（:755），跨頁順序有保證**。
 *
 * - **⚠️ totalPage 只有 page=1 時才會真的計算**：走共用 helper getPageData
 *   （database_helper.ts:204-230），只有 `if (page === 1)`（:208）才跑 count。第 2 頁起
 *   totalPage 恆為 0。本 tool 回傳 `totalPageValid`（= page === 1）供逐次判斷。
 *
 * - **amounts 是「每個幣別各一組金額陣列」的雙層結構**：`amounts [CurrencyAmountLink]`
 *   （rajah:418-419），而 CurrencyAmountLink 是 `{ code string, value [i64] }`
 *   （common.rajah:1184-1187）——注意 **value 本身是陣列**（一個幣別可以有多個候選金額，
 *   例如 100/500/1000），與一般的 CurrencyLink（`value i64` 單一值，common.rajah:1179-1182）
 *   不同，不要搞混。金額由 #assignAmountsAndBuildModels（:1235-1265）批次補上；
 *   本 method 不帶 currencyCode，所以 `targetCode === null`（:1240）→ **不過濾、回傳全部幣別**。
 *
 * - **金額是 stored value、倍數是 Rate stored（×10000）**：amounts 的 value 直接取自
 *   id_currency_links、未換算（前端 FundAdjustmentPresetList.vue:92 是自己呼叫
 *   `CurrencyHelper.storedToNormal` 才顯示）；wageringMultiplier 標 `@Type "Rate"`（rajah:421），
 *   基數是 RateHelper.RateBase = 10000（jafar/src/rate_helper.ts:18），
 *   前端顯示用 `RateHelper.storedToNormal`（FundAdjustmentPresetPickerPopup.vue:56）——
 *   所以 wageringMultiplier=10000 代表 1 倍、5000 代表 0.5 倍。**這兩種換算基數不同**：
 *   金額除以 10^(decimalPlaces+2)、倍數固定除以 10000，不要用同一個除數。
 *
 * - PII（第 8 節）：回傳的 FundAdjustmentPreset（rajah:407-429）是純設定資料
 *   （id / status / name / category / amounts / wageringMultiplier / remark / 兩個時間戳），
 *   **完全不含任何會員個資或財務紀錄**。remark 是操作者自由輸入的文字，屬於資料不是指令。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 1. **全撈（pageSize=200）**：success，rowCount=**4**、totalPage=1、totalPageValid=true。
 *    全平台只有 4 筆 preset（id 8 / 4 / 3 / 1，依 created_at DESC），證實這確實是「人工維護的
 *    小型設定表」而非會成長的歷史表。**id 有正常回傳**（rajah 標的 @Hide 只影響後台表單顯示）。
 * 2. **amounts 的雙層結構實測**：id=8 的 amounts 為
 *    `[{code:"CNY", value:[11000,22000,33000]}, {code:"USDT", value:[33000,44000]}, {code:"USD", value:[44000]}]`
 *    ——確認 **value 本身是陣列**（CNY 有三個候選金額），與單值的 CurrencyLink 不同；
 *    且不帶 currencyCode 時**回傳全部幣別**（三個），與 get_fund_adjustment_presets_by_category
 *    只回指定幣別形成對照。
 * 3. **wageringMultiplier 是 Rate stored（×10000）實測**：四筆分別為 10000 / 11100 / 23400 / 23499，
 *    即 1 倍 / 1.11 倍 / 2.34 倍 / 2.3499 倍——若誤用金額的除數（10^(decimalPlaces+2)）會算成
 *    完全不同的數字，檔頭「兩者換算基數不同」的警告在真實資料上成立。
 * 4. **names 是完全相等比對**：names=["不存在的名字zzz"] → rowCount=0；
 *    names=["a","bug test"] → rowCount=2，正好命中 id=8("a") 與 id=3("bug test")。
 *    證實是 `IN (?)` 精確比對、且支援一次多個名稱。
 * 5. **category 篩選**：category="manualAddPromotionBonus" → rowCount=1（id=3 "bug test"），
 *    其 categoryKey 正確解為 manualAddPromotionBonus。
 * 6. 既有 4 筆的狀態分布實測全部為 enabled。**「停用的 preset 也會列出」已在本輪補證**：
 *    用 create tool 自建測試 preset（id=9）後，以
 *    aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status 將它停用，
 *    再用本 tool 以名稱查詢 → **rowCount=1、statusKey=`disabled`**，確實列得出來。
 *    同一時間 get_fund_adjustment_presets_by_category 對同一個 category 查詢回 rowCount=0，
 *    兩支的差異因此是實測到的、不只是從 SQL 條件推得。測試資料事後已刪除，dev 無殘留。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListFundAdjustmentPresetSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    deepFixLongs,
    ACTIVE_STATUS_MAP,
    MANUAL_ADD_CATEGORY_KEYS,
    manualAddCategoryKeyToNumber,
    manualCategoryNumberToKey,
} from '../const.ts';

/** ActiveStatusEnum 數字 → key（const.ts 的 ACTIVE_STATUS_MAP 是 key→數字，這裡反過來用）。 */
function activeStatusNumberToKey(value: number): string | number {
    const hit = Object.entries(ACTIVE_STATUS_MAP).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

export function registerListFundAdjustmentPresetTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset',
        {
            title: 'List fund adjustment presets (quick amount templates for manual top-ups)',
            description:
                '分頁查詢本平台的「資金預設快捷」——手動上分時可套用的金額範本' +
                '（rajah: FundAdjustmentPlatform.ListFundAdjustmentPreset），對應後台' +
                '「帳務管理 > 資金調整 > 快捷設置」。一筆 preset = 名稱 + 上分類型 + 每個幣別各一組候選金額 ' +
                '+ 稽核倍數；操作者在加款彈窗挑一個就自動帶入金額與稽核金額。' +
                '⚠️ **這是唯一能拿到 preset id 的 tool**：這個模組沒有「用 id 查單筆 preset」的 method，' +
                'search 也不支援用 id 篩選。所以要對某筆 preset 做編輯 / 改狀態 / 刪除' +
                '（aladdin_platform_fund_adjustment_platform_edit_fund_adjustment_preset、' +
                '..._set_fund_adjustment_preset_status、..._delete_fund_adjustment_preset）之前，' +
                '都得先用本 tool 把它撈出來拿 id 與現值。' +
                '（id 在 rajah 雖標 @Hide——那只代表後台表單不顯示——protobuf 仍會傳，本 tool 有回傳。）' +
                '⚠️ **啟用與停用的 preset 都會列出**（沒有 status 篩選條件），請看每筆的 statusKey 判斷；' +
                '對照 aladdin_platform_fund_adjustment_platform_get_fund_adjustment_presets_by_category ' +
                '**只回啟用中的**，兩支筆數不一致是正常的。' +
                '⚠️ names 是**完全相等**的 IN 比對，不支援模糊搜尋。' +
                '⚠️ **amounts 是雙層結構**：每個元素是 { code: 幣別, value: 金額陣列 }——注意 value **本身是陣列**' +
                '（一個幣別可以設定多個候選金額），跟其他 tool 裡 { code, value: 單一數字 } 的 CurrencyLink 不同。' +
                '⚠️ **金額與倍數的換算基數不同，不要用同一個除數**：amounts 的 value 是 stored value，' +
                'normal = stored / 10^(該幣別 decimalPlaces + 2)（用 ' +
                'aladdin_platform_currency_platform_get_currencies 查 decimalPlaces）；' +
                'wageringMultiplier 是 Rate stored，固定除以 10000（10000 = 1 倍、5000 = 0.5 倍）。' +
                '⚠️ totalPage 只有在 page=1 時後端才會真的計算，第 2 頁起一律回 0；' +
                '回傳的 totalPageValid 會告訴你這次的 totalPage 可不可信。' +
                '排序固定為建立時間新到舊，跨頁順序穩定。刪除是硬刪除，所以列出來的都是真實存在的資料。' +
                '本 tool 另附 statusKey / categoryKey 字串代碼方便判讀，enum 未涵蓋的碼會原樣回傳數字。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。回傳是設定資料，不含任何會員個資。',
            inputSchema: {
                names: z
                    .array(z.string().min(1))
                    .max(100)
                    .optional()
                    .describe(
                        '快捷名稱清單（rajah ListFundAdjustmentPresetSearch.names）。' +
                        '⚠️ 後端用 `name IN (?)` **完全相等**比對，不是模糊搜尋，名稱要一字不差。' +
                        '不帶＝不以名稱篩選。陣列長度上限 100 是本 tool 自訂的保護。',
                    ),
                category: z
                    .enum(MANUAL_ADD_CATEGORY_KEYS)
                    .optional()
                    .describe(
                        '上分類型（rajah 型別 ManualAddCategoryEnum，只有 10 個手動上分類型）。' +
                        '傳字串代碼，例如 "manualAddActivityGift"。不帶＝不篩選。',
                    ),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z
                    .number()
                    .int()
                    .min(1)
                    .max(200)
                    .default(50)
                    .describe(
                        '每頁筆數。⚠️ 不能傳 0：後端會產出 LIMIT 0,0 回空清單（不會套用自己的預設值），' +
                        '故本 tool 強制至少 1。要一次撈完以便用 id 定位某筆 preset，建議直接用較大的值。',
                    ),
            },
        },
        async ({ names, category, page, pageSize }) => {
            const search = ListFundAdjustmentPresetSearch.create({
                names: names ?? [],
                category: category ? manualAddCategoryKeyToNumber(category) : 0,
            });

            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.ListFundAdjustmentPreset(search, page, pageSize),
            );
            if (r.failed) return asErrorResult(r);

            const rawRows = deepFixLongs(r.data?.rows ?? []) as unknown as Record<string, unknown>[];
            const rows = rawRows.map((row) => ({
                ...row,
                statusKey: activeStatusNumberToKey(row.status as number),
                // 用完整的 ManualCategoryEnum 解讀（不是較窄的 ManualAddCategoryEnum）：後端寫入時
                // 驗的是完整 enum（fund_adjustment_platform.ts:1132-1134），DB 裡理論上可能存在下分類型。
                categoryKey: manualCategoryNumberToKey(row.category as number),
            }));

            return asTextResult({
                success: true,
                page,
                pageSize,
                rowCount: rows.length,
                totalPage: r.data?.totalPage,
                // totalPage 只有 page=1 時後端才真的算（database_helper.ts:208），其他頁恆為 0。
                totalPageValid: page === 1,
                includesDisabledPresets: true,
                amountsAreStoredValue: true,
                wageringMultiplierRateBase: 10000,
                rows,
            });
        },
    );
}
