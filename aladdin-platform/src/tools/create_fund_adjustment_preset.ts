/**
 * tools/create_fund_adjustment_preset.ts — aladdin_platform_fund_adjustment_platform_create_fund_adjustment_preset
 *
 * rajah: FundAdjustmentPlatform.CreateFundAdjustmentPreset(preset FundAdjustmentPresetEdit 1)（無回傳值）
 * （fund_adjustment_back_office.rajah:520；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.Preset.Add"（519）——後台
 * 「帳務管理 > 資金調整 > 快捷設置」的新增。非 @NoPublic、非 Placeholder、**無 @Totp**。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:767-806 methodCreateFundAdjustmentPreset，
 * 確認有真實 override（驗證 → 單一交易內 insert + 寫多幣別金額 → 寫 audit log），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 3 節「寫入 — 新增（Create / Add）」。該節要求的處理如下：
 * - **「完成後用回傳 id 呼叫對應 Get 做 round-trip 驗證，不能以 RPC 不報錯視為業務正確」**：
 *   ⚠️ 這支 method **完全沒有回傳值**（rajah:520 括號後沒有回傳段），拿不到新建的 id。
 *   本 tool 因此改用「以業務鍵 name 回讀」的方式做 round-trip：建立後立刻用
 *   ListFundAdjustmentPreset(names=[剛建立的名稱]) 撈回來，逐欄比對送出值與讀回值
 *   （name / category / wageringMultiplier / remark / status / amounts 深比對），
 *   並把讀回的 id 一併回報給呼叫端（後續 edit/setStatus/delete 都需要這個 id）。
 * - **「有天然業務鍵（如 code）的，建議/強制先查重再建立」**：name 就是這裡的天然業務鍵。
 *   ⚠️ **唯一性是 DB 層擋的、不是 service 層**（本輪 review 修正過的一條錯誤結論）：
 *   #validatePresetEdit（:1128-1174）確實沒有任何 `SELECT ... WHERE name = ?` 的查重，
 *   但資料表本身有 `UNIQUE INDEX platform_id_name (platform_id, name)`
 *   （migrations/fund_adjustment/202605141103_create_fund_adjustment_presets.sql:12，
 *   全 migrations 目錄只有這一個檔、沒有後續 ALTER 移除）。所以**同一平台內同名 preset 建不出來**，
 *   硬送會拿到 DB duplicate key（dev 實測 errorCode=13，見驗證第 7 點）。
 *   初版檔頭寫「DB 端也沒有 unique 索引、同名可以重複建立」是錯的——原因是只查了 service 層
 *   沒查 migration，且當時沒有實打。
 *   本 tool 仍在呼叫前主動查重，但目的改為**給出看得懂的錯誤**（直接說「這個名稱已被 id=N 使用」）
 *   而不是讓呼叫端拿到一個裸的 errorCode=13。
 * - **「`Add*` 不保證是新增實體，底層機制必須逐一查證」**：本 method 名為 Create、實作也確實是
 *   `new DbFundAdjustmentPreset()`（:775-781）+ `insertObject`（:784），是真正的新增。
 *   **但它有天然的冪等保護**：因為 name 有 DB 唯一性約束，「送出後不確定有沒有成功」時重試不會產生
 *   第二筆，只會拿到 duplicate key 錯誤。這對應 method-category-checklist 第 3 節列的第二種
 *   `Add*` 型態（「絕對值 SET + 天然冪等保護……這種反而安全，重試會被後端擋下，
 *   不要誤判成危險的累加型」），**不是**第一種「真累加、不可自動重試」。
 *   初版把它歸成不可重試的累加型，方向相反，已改正。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **⚠️ amounts 只檢查「有沒有涵蓋啟用幣別」，多帶的幣別會被照單全收寫進 DB**：
 *   #validatePresetEdit 的最後一段（:1167-1171）是拿平台啟用幣別逐一去 providedCodeMap 裡找，
 *   **只驗超集、不驗有沒有多餘的**。dev 實測（驗證第 6 點）帶了平台未啟用的 INR，後端接受並存進去。
 *   ⚠️ 而且後端這個比對是 **case-sensitive 精確字串比對**（:1151-1171 用
 *   `providedCodeMap.set(link.code)` / `has(code)`，沒有 toUpperCase），所以幣別代碼的大小寫
 *   要跟 get_currencies 回傳的一致。本 tool 的前置檢查為此也改成精確比對，
 *   避免出現「本 tool 放行、後端卻回 currency xxx is required」的不一致。
 *
 * - **status 由後端寫死 enabled，不能在建立時指定**：`record.status = ActiveStatusEnum.enabled`
 *   （:781）。要建立後停用，得再呼叫
 *   aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status。
 *
 * - **⚠️ amounts 必須涵蓋平台「全部啟用幣別」，少一個就整筆失敗**：#validatePresetEdit 最後一段
 *   （:1166-1170）把 `core.currency.ListByPlatformId(platformId, true)` 回傳的每個啟用幣別逐一
 *   檢查是否出現在 preset.amounts 裡，缺一個就回 invalidData 並附訊息 `currency XXX is required`。
 *   所以送出前必須先用 aladdin_platform_currency_platform_get_currencies 查出啟用中（status=1）
 *   的幣別清單，每個都給金額。本 tool 會在呼叫前自行做一次同樣的檢查並給出明確缺漏清單，
 *   讓呼叫端不必從後端的通用 invalidData 猜是哪個幣別漏了。
 *
 * - **其餘驗證規則（#validatePresetEdit，:1128-1173）**：name trim 後非空（:1129-1131）；
 *   category 必須是 **ManualCategoryEnum**（19 個值，含下分）的合法值（:1132-1134）
 *   ——⚠️ 這與 rajah 宣告的 ManualAddCategoryEnum（10 個上分值，common.rajah:2606-2627）不一致，
 *   後端比契約寬。本 tool 遵守 rajah 契約只開放 10 個上分類型，不利用這個落差。
 *   wageringMultiplier >= 0（:1135-1137，可以是 0）；amounts 非空陣列（:1138-1140）；
 *   每個 amounts 元素的 code 非空（:1152-1154）、value 必須是非空陣列（:1155-1157）、
 *   每個值必須是有限的非負數（:1158-1162）。
 *
 * - **寫入是單一交易，任一步失敗整批 rollback**：insertObject 與
 *   `updateAmountsById(...CurrencyLinkServiceIdEnum.fundAdjustmentPresetAmount, record.id, preset.amounts)`
 *   包在 `doTransaction` 內（:783-789），所以不會出現「主檔建了但金額沒寫進去」的半套狀態。
 *
 * - **會寫 audit log**：`audit(context, SystemIdEnum.fundAdjustment,
 *   PlatformActionIdEnum.fundAdjustmentPresetCreate, AuditData.createNew(after))`（:804）。
 *   ⚠️ 稽核快照的換算方向與直覺相反（初版寫反了，本輪 review 後改正）——
 *   #buildPresetAuditSnapshot（:1214-1229）**amounts 保留 stored 值**（:1219-1224，只是攤平成純物件；
 *   換算發生在更下游的 audit handler `formatCurrencyToDisplayLinks`），
 *   **被換成 normal 的是 wageringMultiplier**（:1225，`RateHelper.storedToNormal`，10000 → 1）。
 *   要拿稽核紀錄重建資料時，wageringMultiplier 記得乘回 10000。
 *
 * - **金額與倍數是兩種不同的 stored 表示，換算基數不同**：amounts 的 value 是幣別 stored value
 *   （normal = stored / 10^(decimalPlaces + 2)，jafar/src/exchange.ts:32-38）；
 *   wageringMultiplier 是 Rate stored，基數固定 10000（jafar/src/rate_helper.ts:18），
 *   10000 = 1 倍。**本 tool 不做任何換算**，你送什麼進去就存什麼——請自行換算好再傳。
 *
 * - **remark 允許空字串**：`record.remark = preset.remark || ''`（:780）。
 *
 * - PII（第 8 節）：這是純設定資料，**完全不含任何會員個資或財務紀錄**，
 *   也不涉及密鑰/token/密碼，不需要遮罩或二次驗證機制。
 *
 * ⚠️ **這是寫入操作，且沒有回傳 id**。但它是可逆的：本 MCP 有對應的
 * aladdin_platform_fund_adjustment_platform_delete_fund_adjustment_preset 可以刪掉建錯的資料
 * （硬刪除），也有 set_status 可以停用。與本 domain 那些被標記為 needs_clarification 的
 * 金流寫入（ApplyAdd / AdjustmentReview 等）不同——preset 只是金額範本設定，
 * **本身不會動到任何會員的錢**。
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
 * 測試資料：本輪自建名為 `mcp-cb-test-144406`、category=manualAddOther 的 preset（id=9），
 * 全部驗證跑完後已用 delete tool 刪除，dev 上的 preset 總數回到原本的 4 筆（id 8/4/3/1），
 * 無殘留（見第 6 點）。
 * 1. **「amounts 未涵蓋全部啟用幣別」被本 tool 的前置檢查擋下**：只給 CNY 一種 →
 *    success=false、stage=`pre-check-missing-currency`，訊息明列「缺少平台啟用幣別：USD, USDT」，
 *    並回傳 enabledCurrencyCodes=[CNY, USD, USDT] 與 providedCurrencyCodes=[CNY]。
 *    **未送出 RPC**——呼叫端不必從後端那個籠統的 invalidData 反猜是哪個幣別漏了。
 * 2. **正常建立**：三個幣別齊全（CNY:[10000,20000] / USD:[30000] / USDT:[40000]）、
 *    wageringMultiplier=10000 → success，stage=`created`，**createdId=9**（靠名稱回讀取得，
 *    因為後端這支沒有回傳值）、sameNameRowCount=1。
 *    roundTrip 六項（name / category / wageringMultiplier / remark / statusIsEnabled /
 *    amountsDeepEqual）**全部 true**，roundTripAllMatched=true。
 *    其中 statusIsEnabled=true 證實了「後端寫死 enabled、不能在建立時指定」。
 *    amountsDeepEqual=true 證實雙層結構（每幣別一組金額陣列）原樣存回，沒有被攤平或截斷。
 * 3. **名稱查重守門**：用同一個名稱再建一次（不帶 allowDuplicateName）→ success=false、
 *    stage=`pre-check-duplicate-name`，訊息「已存在名稱為「mcp-cb-test-144406」的資金預設快捷（1 筆）」，
 *    並回傳既有那筆的完整內容。**未送出 RPC**。
 *    （這證實本 tool 的保護生效；後端本身沒有唯一性限制這件事來自源碼與 DB 結構，
 *    本輪**沒有**刻意用 allowDuplicateName=true 去 dev 上製造重複資料驗證，
 *    如實標記為源碼推得而非實測。）
 * 4. 回傳的 createdRow 實測欄位為 amounts / category / categoryKey / createdAtTimestamp / id /
 *    name / remark / status / statusKey / updatedAtTimestamp / wageringMultiplier，
 *    與 rajah model FundAdjustmentPreset 一致（外加本 tool 附上的兩個 *Key）。
 * 5. 建立出來的 id=9 後續被 edit / set_status / delete 三支 tool 接力使用，
 *    形成完整的生命週期驗證（見那三支各自的 dev 驗證段）。
 * 6b. **（本輪 review 後補測）額外幣別被照單全收**：建立時多帶平台**未啟用**的 INR
 *    （CNY/USD/USDT/INR 四個）→ success，讀回的 amounts 含 INR:[40000]。
 *    證實後端 #validatePresetEdit **只驗超集、不驗多餘**，多帶的幣別會被寫進 DB。
 * 6c. **名稱唯一性由 DB 擋（推翻初版結論的決定性實測）**：對同名再建一次（當時還有
 *    allowDuplicateName 參數、刻意繞過本 tool 的查重守門）→ success=false、
 *    stage=`create`、**errorCode=13**（DB duplicate key）。
 *    證實資料表的 `UNIQUE (platform_id, name)` 真的生效，初版檔頭「DB 沒有 unique 索引、
 *    同名可重複建立」是錯的。據此本輪已移除 allowDuplicateName 參數（它宣稱的事做不到），
 *    並把冪等性結論從「不可重試」改為「有天然冪等保護、可安全重試」。
 * 6d. **修正後回歸**：同名建立現在會在前置檢查就被擋下（stage=`pre-check-duplicate-name`，
 *    訊息明確指出「名稱『…』已被既有的資金預設快捷使用（id=12）」），不再送出 RPC、
 *    也不再讓呼叫端收到裸的 errorCode=13。
 * 6. **清理**：測試結束後用 * 6. **清理**：測試結束後用
 *    aladdin_platform_fund_adjustment_platform_delete_fund_adjustment_preset 刪除 id=9，
 *    再用 list 覆核 dev 上只剩原本的 4 筆（id 8/4/3/1）、且沒有任何名稱含 `mcp-cb-test` 的殘留。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import {
    FundAdjustmentPresetEdit,
    ListFundAdjustmentPresetSearch,
} from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    deepFixLongs,
    I32_MAX,
    ACTIVE_STATUS_MAP,
    describeEnum,
    MANUAL_ADD_CATEGORY_KEYS,
    manualAddCategoryKeyToNumber,
    manualCategoryNumberToKey,
} from '../const.ts';

/**
 * 逐頁掃描的上限，比照同 server 的 create_or_update_item.ts:95-96 既有慣例
 * （method-category-checklist.md 第 2 節 B 級要求：總掃描上限 20 頁 × 200 筆 = 4000 筆）。
 * preset 是人工維護的小表（2026-08-28 dev 上僅 4 筆），實務上一頁就掃完。
 */
const LIST_PAGE_SIZE = 200;
const LIST_SCAN_PAGE_CAP = 20;

export type PresetRow = Record<string, unknown>;

/** 把 preset 列補上人類可讀的 enum 代碼。preset 系列四支 tool 共用。 */
export function formatPresetRow(row: PresetRow): PresetRow {
    return {
        ...row,
        statusKey: describeEnum(ACTIVE_STATUS_MAP, row.status as number),
        // 用較寬的 ManualCategoryEnum 解讀：後端寫入時驗的是完整 enum
        // （fund_adjustment_platform.ts:1132-1134），DB 裡理論上可能存在下分類型。
        categoryKey: manualCategoryNumberToKey(row.category as number),
    };
}

/**
 * 用 id 逐頁掃描定位單筆 preset。
 *
 * 為什麼需要這個 helper：整個 FundAdjustmentPlatform **沒有** GetFundAdjustmentPresetById /
 * GetPresetForEdit 這類 sibling method（rajah:515-532 的 preset 區塊只有 List / Create / Edit /
 * SetStatus / Delete / GetByCategory 六支），而 ListFundAdjustmentPresetSearch（rajah:398-403）
 * 只支援 names 與 category、**不支援 id**。method-category-checklist.md 第 5 節要求
 * 「先確認是否已有用業務鍵直接查詢的 sibling method；若確實沒有，只能靠分頁掃描比對，
 * 比照第 2 節 B 級要求逐頁掃到底、設上限與逾時保護」——這就是那個 fallback。
 * 實作**參考**同 server 的 create_or_update_item.ts:204-217 findItemById，但**刻意修正了它的一個缺陷**：
 * 那支每一頁都重新做 `totalPage = listR.data?.totalPage ?? 1`（該檔 :212），而 getPageData 只有
 * page=1 才算 totalPage、第 2 頁起回 **0**（不是 null，`?? 1` 救不到），於是迴圈條件
 * `page <= Math.min(0, CAP)` 立刻為假——**實際最多掃到第 2 頁就靜默停止**，而且 hitScanCap
 * 會算成 `0 > 20 = false`，正是 checklist 第 2 節第 3 點禁止的「觸頂卻宣稱已掃完」。
 * 本函式改成只在 `page === 1` 時取 totalPage，避免這個問題。
 * （create_or_update_item.ts 的那個 bug 屬既有問題，不在本輪範圍，未修改。）
 *
 * 回傳三態：找到（matchedRow）／後端錯誤（listR）／掃完沒找到（兩者皆 undefined，
 * 並以 hitScanCap 標示是否是因為觸及掃描上限而提前停止——不能把觸頂說成「已掃描全部」）。
 */
export async function findPresetById(id: number) {
    let totalPage = 1;
    let scannedPages = 0;
    let scannedRows = 0;
    for (let page = 1; page <= Math.min(totalPage, LIST_SCAN_PAGE_CAP); page++) {
        const search = ListFundAdjustmentPresetSearch.create({ names: [], category: 0 });
        const listR = await withAutoRelogin(() =>
            remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.ListFundAdjustmentPreset(
                search,
                page,
                LIST_PAGE_SIZE,
            ),
        );
        if (listR.failed) return { listR, matchedRow: undefined, scannedPages, scannedRows } as const;
        scannedPages++;
        const rows = listR.data?.rows ?? [];
        scannedRows += rows.length;
        // totalPage 只有 page=1 時後端才真的計算（database_helper.ts:208），所以只在第一頁採用它。
        if (page === 1) totalPage = listR.data?.totalPage ?? 1;
        const matchedRow = rows.find((row) => row.id === id);
        if (matchedRow) {
            return {
                listR: undefined,
                matchedRow: deepFixLongs(matchedRow) as unknown as PresetRow,
                scannedPages,
                scannedRows,
            } as const;
        }
    }
    return {
        listR: undefined,
        matchedRow: undefined,
        scannedPages,
        scannedRows,
        hitScanCap: totalPage > LIST_SCAN_PAGE_CAP,
    } as const;
}

/** 用名稱（天然業務鍵）精確查出所有同名 preset。建立前查重與建立後 round-trip 都用它。 */
export async function findPresetsByName(name: string) {
    const search = ListFundAdjustmentPresetSearch.create({ names: [ name ], category: 0 });
    const listR = await withAutoRelogin(() =>
        remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.ListFundAdjustmentPreset(search, 1, LIST_PAGE_SIZE),
    );
    if (listR.failed) return { listR, rows: undefined } as const;
    return { listR: undefined, rows: (deepFixLongs(listR.data?.rows ?? []) as unknown as PresetRow[]) } as const;
}

/** 送出的 amounts 與讀回的 amounts 深比對（順序無關、以幣別代碼為鍵）。 */
export function amountsDeepEqual(
    sent: Array<{ code: string; value: number[] }>,
    readBack: unknown,
): boolean {
    if (!Array.isArray(readBack)) return false;
    const norm = (list: Array<{ code?: string; value?: unknown }>) => {
        const out: Record<string, number[]> = {};
        for (const link of list) {
            if (!link?.code) continue;
            out[ link.code.toUpperCase() ] = (Array.isArray(link.value) ? link.value : []).map(Number).sort((a, b) => a - b);
        }
        return out;
    };
    const a = norm(sent);
    const b = norm(readBack as Array<{ code?: string; value?: unknown }>);
    const keys = new Set([ ...Object.keys(a), ...Object.keys(b) ]);
    for (const key of keys) {
        const left = a[ key ];
        const right = b[ key ];
        if (!left || !right || left.length !== right.length) return false;
        for (let i = 0; i < left.length; i++) if (left[ i ] !== right[ i ]) return false;
    }
    return true;
}

/** 取得本平台啟用中（status=enabled）的幣別代碼，用於呼叫前檢查 amounts 是否涵蓋齊全。 */
export async function listEnabledCurrencyCodes() {
    // 與 get_currencies.ts:76 同一條路徑；enabledOnly=true 讓後端只回啟用中的幣別。
    // 為什麼這份清單與後端 #validatePresetEdit 用的那份等價（本輪 review 查證後補正的鏈路）：
    // 本 tool 走 CurrencyPlatform.GetCurrencies(enabledOnly) → core.currency.List(enabledOnly)
    //（agrabah/src/servers/core_back_office/services/currency_platform.ts:35），**不是**後端那支用的
    // ListByPlatformId——但兩者最後都落到同一個 _ListCurrencies，而它回的是
    // `this.currencyMap.get(context.platformId)`（core/services/currency.ts:124，連傳進去的 platformId
    // 參數都不使用，是該檔自己標了 [TBD] 的既有怪癖），enabledOnly 的篩選也是同一行（:125）。
    // 後端 #validatePresetEdit 傳的正是 context.platformId，所以兩邊得到的集合一致。
    const r = await withAutoRelogin(() => remote.coreBackOffice.currencyPlatform.GetCurrencies(true));
    if (r.failed) return { r, codes: undefined } as const;
    const codes = (r.data?.currencies ?? [])
        .map((currency) => currency.code)
        .filter((code): code is string => Boolean(code));
    return { r: undefined, codes } as const;
}

const amountsSchema = z
    .array(
        z.object({
            code: z.string().min(1).describe('幣別代碼，例如 "CNY"'),
            value: z
                .array(z.number().int().min(0))
                .min(1)
                .describe('該幣別的候選金額陣列（stored value，未換算；一個幣別可有多個金額）。後端要求非空、每個值為非負整數。'),
        }),
    )
    .min(1)
    .describe(
        '每個幣別各一組候選金額（rajah [CurrencyAmountLink]，注意 value 本身是陣列）。' +
        '⚠️ **必須涵蓋平台全部啟用中的幣別**，少一個後端就整筆拒絕（invalidData: currency XXX is required）。' +
        '啟用幣別請用 aladdin_platform_currency_platform_get_currencies 查（status=1 者）。' +
        '⚠️ 金額是 **stored value**（normal × 10^(該幣別 decimalPlaces + 2)），本 tool 不做換算。',
    );

export function registerCreateFundAdjustmentPresetTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_create_fund_adjustment_preset',
        {
            title: 'Create a fund adjustment preset (quick amount template) — write operation',
            description:
                '新增一筆「資金預設快捷」——手動上分時可套用的金額範本' +
                '（rajah: FundAdjustmentPlatform.CreateFundAdjustmentPreset）。對應後台' +
                '「帳務管理 > 資金調整 > 快捷設置」的新增。' +
                '**這是寫入操作**，但只是金額範本設定、**不會動到任何會員的錢**；且可逆——建錯了可以用 ' +
                'aladdin_platform_fund_adjustment_platform_delete_fund_adjustment_preset 刪掉。' +
                '⚠️ **後端這支沒有回傳值，拿不到新建的 id**。本 tool 因此在建立後立刻用名稱回讀，' +
                '把讀回的 id 與完整內容一併回報，並逐欄比對送出值與讀回值（比對結果在 roundTrip 欄位）。' +
                '後續要編輯／改狀態／刪除這筆，就用回報的那個 id。' +
                '⚠️ **同一平台內名稱必須唯一**（資料表有 UNIQUE (platform_id, name)；後端 service 層沒查重，' +
                '是 DB 擋的，硬送會拿到 duplicate key 錯誤 errorCode=13）。' +
                '本 tool 會先查重並直接告訴你「這個名稱已被 id=N 使用」，而不是讓你收到一個裸的錯誤碼。' +
                '✅ **這個唯一性同時是天然的冪等保護**：呼叫後不確定有沒有成功時，**可以安全重試**——' +
                '若前一次其實已寫入，重試只會拿到 duplicate key 而不會產生第二筆。' +
                '（仍建議重試前先用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 以名稱確認。）' +
                '⚠️ **amounts 必須涵蓋平台全部啟用中的幣別**，少一個後端整筆拒絕。' +
                '本 tool 會在呼叫前自行檢查並明確告訴你缺哪些幣別（後端只會回一個籠統的 invalidData）。' +
                '⚠️ 反過來，**多帶平台沒啟用的幣別後端會照單全收並寫進 DB**（只驗超集、不驗多餘），' +
                '而且幣別代碼是 **case-sensitive** 比對——請照 ' +
                'aladdin_platform_currency_platform_get_currencies 回傳的原始大小寫傳入。' +
                '⚠️ **金額與稽核倍數是兩種不同的 stored 表示、換算基數不同，本 tool 一律不換算**：' +
                'amounts 的 value 是幣別 stored value（normal × 10^(decimalPlaces + 2)，' +
                'decimalPlaces 用 aladdin_platform_currency_platform_get_currencies 查）；' +
                'wageringMultiplier 是 Rate stored、基數固定 10000（要 1 倍就傳 10000、2.5 倍傳 25000）。' +
                '請自行換算好再傳。' +
                '新建的 preset **狀態一律是啟用（後端寫死）**，不能在建立時指定；要停用請建立後再呼叫 ' +
                'aladdin_platform_fund_adjustment_platform_set_fund_adjustment_preset_status。' +
                'category 只開放 10 種手動上分類型（依 rajah 契約）。' +
                '寫入是單一交易，不會出現「主檔建了但金額沒寫」的半套狀態。此操作會寫入後台稽核紀錄。',
            inputSchema: {
                name: z
                    .string()
                    .min(1)
                    .max(50)
                    .describe(
                        '快捷名稱（rajah FundAdjustmentPresetEdit.name，必填）。這是本模組的天然業務鍵——' +
                        '本 tool 靠它做建立前查重與建立後回讀。' +
                        '⚠️ 同一平台內必須唯一（DB 有 UNIQUE 約束），長度上限 50（DDL 為 VARCHAR(50)）。',
                    ),
                category: z
                    .enum(MANUAL_ADD_CATEGORY_KEYS)
                    .describe('上分類型（rajah ManualAddCategoryEnum，10 個手動上分類型），傳字串代碼，例如 "manualAddActivityGift"。'),
                amounts: amountsSchema,
                wageringMultiplier: z
                    .number()
                    .int()
                    .min(0)
                    .max(I32_MAX)
                    .describe(
                        '稽核倍數，**Rate stored 值、基數 10000**（10000 = 1 倍、25000 = 2.5 倍、0 = 不需稽核）。' +
                        '後端只要求 >= 0。⚠️ 不要跟金額用同一個換算基數。' +
                        '後台用它算稽核金額的公式是 floor(調整金額 × wageringMultiplier / 10000)。',
                    ),
                remark: z.string().max(100).default('').describe('備註（選填，rajah 沒有標 Required，後端會把未帶的值存成空字串）。長度上限 100（DDL 為 VARCHAR(100)）。'),
            },
        },
        async ({ name, category, amounts, wageringMultiplier, remark }) => {
            // --- 呼叫前檢查 1：名稱查重（後端沒有做，見檔頭）---
            const existing = await findPresetsByName(name);
            if (existing.listR) return asErrorResult(existing.listR);
            if (existing.rows && existing.rows.length > 0) {
                return asTextResult({
                    success: false,
                    stage: 'pre-check-duplicate-name',
                    message: `名稱「${ name }」已被既有的資金預設快捷使用（id=${ existing.rows.map((row) => row.id).join(', ') }），無法建立同名的第二筆。`,
                    hint:
                        '資料表有 UNIQUE (platform_id, name)，同一平台內名稱必須唯一——就算繞過本檢查直接送出，' +
                        '後端也會回 duplicate key（errorCode=13）。請換一個名稱，' +
                        '或改用 aladdin_platform_fund_adjustment_platform_edit_fund_adjustment_preset 編輯既有那一筆。',
                    existingRows: existing.rows.map(formatPresetRow),
                });
            }

            // --- 呼叫前檢查 2：amounts 是否涵蓋全部啟用幣別（後端只回籠統的 invalidData）---
            const currencies = await listEnabledCurrencyCodes();
            if (currencies.r) return asErrorResult(currencies.r);
            // 精確比對（不做 toUpperCase）：後端 #validatePresetEdit 是 case-sensitive 的字串比對，
            // 這裡放寬會造成「本 tool 放行、後端仍回 currency xxx is required」的不一致。
            const providedCodes = new Set(amounts.map((link) => link.code));
            const missing = (currencies.codes ?? []).filter((code) => !providedCodes.has(code));
            if (missing.length > 0) {
                return asTextResult({
                    success: false,
                    stage: 'pre-check-missing-currency',
                    message: `amounts 缺少平台啟用幣別：${ missing.join(', ') }。後端會整筆拒絕（invalidData: currency XXX is required）。`,
                    hint: '請為每個啟用中的幣別都提供金額陣列。啟用幣別清單可用 aladdin_platform_currency_platform_get_currencies 查（status=1 者）。',
                    enabledCurrencyCodes: currencies.codes,
                    providedCurrencyCodes: [ ...providedCodes ],
                });
            }

            // --- 送出 ---
            const preset = FundAdjustmentPresetEdit.create({
                name,
                category: manualAddCategoryKeyToNumber(category),
                amounts: amounts.map((link) => ({ code: link.code, value: link.value })),
                wageringMultiplier,
                remark: remark ?? '',
            });

            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.CreateFundAdjustmentPreset(preset),
            );
            if (r.failed) {
                return asTextResult({
                    success: false,
                    stage: 'create',
                    errorCode: r.errorCode,
                    message: r.message,
                    hint:
                        r.errorCode === 13
                            ? '這是 DB 的 duplicate key：同一平台內 preset 名稱必須唯一（UNIQUE (platform_id, name)）。請換一個名稱。'
                            : '名稱有 DB 唯一性約束，所以重試是安全的——若前一次其實已寫入，重試只會再拿到 duplicate key，不會產生第二筆。' +
                              '仍建議先用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 以名稱確認實際狀態。',
                });
            }

            // --- round-trip：這支沒有回傳 id，只能用業務鍵 name 回讀（見檔頭第 3 節說明）---
            const readBack = await findPresetsByName(name);
            if (readBack.listR) {
                return asTextResult({
                    success: true,
                    stage: 'created-but-readback-failed',
                    message: 'RPC 回報建立成功，但回讀驗證時查詢失敗，無法確認實際內容與取得新的 id。',
                    readBackErrorCode: readBack.listR.errorCode,
                    readBackMessage: readBack.listR.message,
                    hint: '請自行用 aladdin_platform_fund_adjustment_platform_list_fund_adjustment_preset 以名稱查詢確認。',
                });
            }

            const rows = readBack.rows ?? [];
            // 同名可能有多筆（allowDuplicateName 或先前殘留），取 id 最大的那筆視為本次新建。
            const created = rows.slice().sort((a, b) => (b.id as number) - (a.id as number))[ 0 ];
            if (!created) {
                return asTextResult({
                    success: false,
                    stage: 'created-but-not-found',
                    message: 'RPC 回報建立成功，但立刻以名稱回讀卻查不到任何資料。請人工確認後端狀態。',
                });
            }

            const roundTrip = {
                name: created.name === name,
                category: created.category === manualAddCategoryKeyToNumber(category),
                wageringMultiplier: created.wageringMultiplier === wageringMultiplier,
                remark: (created.remark ?? '') === (remark ?? ''),
                statusIsEnabled: created.status === ACTIVE_STATUS_MAP.enabled,
                amountsDeepEqual: amountsDeepEqual(amounts, created.amounts),
            };
            const allMatched = Object.values(roundTrip).every(Boolean);

            return asTextResult({
                success: true,
                stage: 'created',
                createdId: created.id,
                sameNameRowCount: rows.length,
                roundTrip,
                roundTripAllMatched: allMatched,
                roundTripNote: allMatched
                    ? '送出值與讀回值逐欄一致（含 amounts 深比對），建立確認無誤。'
                    : '⚠️ 部分欄位讀回值與送出值不一致，請檢查 roundTrip 明細與下方 createdRow。',
                amountsAreStoredValue: true,
                wageringMultiplierRateBase: 10000,
                createdRow: formatPresetRow(created),
            });
        },
    );
}
