/**
 * tools/get_rebate_configs.ts — aladdin_platform_rebate_platform_get_rebate_configs
 *
 * rajah: RebatePlatform.GetRebateConfigs(page i32 1, pageSize PageSizeEnum 2)
 * (rows [RebateConfig] 1, totalPage i32 2)
 * （rebate_back_office.rajah:270；service RebatePlatform 定義於同檔 268 行、@Module "Rebate"
 * （267），service 級的 `# @Permission "BonusCenter.Rebate"`（266）是被註解掉的，而這支 method
 * 本身也沒有另掛 @Permission——是本 service 少數沒有明確權限節點的 method 之一；
 * 非 @NoPublic、非 Placeholder）——後台「優惠中心 > 返水管理 > 返水配置」列表頁。
 *
 * agrabah 對應實作：rebate_platform.ts:40-79 methodGetRebateConfigs，確認有真實 override
 * （真的查 `rebate_configs` 表 + 批次算會員數 + 批次補幣別金額欄位），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」的 **B 級（高風險）**——簽名只有
 * page/pageSize，**完全沒有 search struct、沒有任何可鎖定單一目標的欄位**（連範圍鍵都沒有，
 * 範圍由後端用登入者的 platformId 決定）。依 B 級要求逐條處理：
 * - 「禁止把這類 method 包成用業務鍵查特定一筆的內部查找工具」：本 tool 就是單純的列表查詢，
 *   不做任何內部逐頁掃描比對，沒有違反。
 * - 「選 method 前先確認是否已有用業務鍵直接查詢的 sibling method」：**有兩支**，所以呼叫端
 *   完全不需要靠翻頁定位——(a) RebatePlatform.GetRebateConfigById(id)，包成
 *   aladdin_platform_rebate_platform_get_rebate_config_by_id；(b)
 *   RebatePlatform.GetRebateConfigNameList()，包成
 *   aladdin_platform_rebate_platform_get_rebate_config_name_list，一次回傳全平台所有
 *   id+名稱（不分頁），要用名稱找 id 就用它。description 已明確導向這兩支。
 * - 「驗收案例必須包含目標記錄不在第一頁的情境」：見下方 dev 驗證第 3/4 點，實際用
 *   pageSize=size10 翻到第 2 頁取得第一頁沒有的 id，確認翻頁真的有效。
 *
 * agrabah 實作細節（讀源碼查證）：
 * - 查詢條件是 `platform_id = ? AND deleted = 0`（rebate_platform.ts:43），**排除軟刪除**；
 *   對照 methodGetRebateConfigNameList（同檔 886）條件只有 `platform_id = ?`（rebate_platform.ts:886）、不排除軟刪除，
 *   兩支的筆數會不一致，這是後端既有行為（2026-08-28 dev 實測：本 tool 13 筆、名稱清單 25 筆）。
 * - `pageSize` 是 PageSizeEnum（common.rajah:2449-2457 的離散值），`serverDefault`(0) 由後端
 *   轉成 `DefaultPageSize`=100（database_helper.ts:11）。本 tool 用 const.ts 既有的
 *   PAGE_SIZE_KEYS/PAGE_SIZE_MAP，agent 傳字串 key、不傳裸數字。
 * - **totalPage 只有 page=1 時才會真的計算**：共用 helper getPageData（database_helper.ts:204-230）
 *   只有 `if (page === 1)` 才呼叫 count 並算 totalPage，其他頁一律沿用初始值 0。已 dev 實測
 *   （見下方第 4 點）。呼叫端不能把非第一頁的 totalPage=0 當成「沒有更多資料」。
 * - **分頁 SQL 沒有 ORDER BY**（rebate_platform.ts:45 只有 `WHERE ... LIMIT offset,size`），
 *   對照同檔 methodGetRebateConfigNameList 有傳 `'id asc'`（:886）——所以本 method 跨頁的列順序
 *   沒有後端保證，翻頁時理論上可能重複或漏抓。description 已據實告知並建議一次取完或改用
 *   有排序的名稱清單。
 * - 回傳的 RebateConfig（rebate_back_office.rajah:103-132）**六個**金額欄位（dailyRebateMax/
 *   minDrawAmount/singleBetLimit/dailyDrawMax/singleBetMin/wageringMultiplier）**全部**是
 *   `[CurrencyLink]` 多幣別陣列（rajah:124 的 wageringMultiplier 也是，只是多了 @Type "Rate"
 *   表示語意是倍數不是金額），元素形狀是 `{ code, value }`（common.rajah:1179-1182），
 *   value 是 i64。本 tool 回傳前套用 const.ts 的 deepFixLongs，把 protobufjs Long
 *   （含巢狀在 CurrencyLink 內的 value 與頂層 updatedAtTimestamp）轉成一般 number——
 *   否則 JSON.stringify 會把 Long 轉成十進位字串，讓呼叫端無法把讀回值直接餵給寫入 tool 的
 *   z.number() schema（該函式自己的 docblock 記錄了這個已在 dev 復現過的失敗模式）。
 *   memberCount 是後端另外批次算出來的會員數
 *   （依 VIP 等級歸屬 + 個人指定覆蓋，且排除 $ 開頭的合營代理帳號），不是資料表欄位。
 * - **`operator`（操作人）實際上永遠是空的**：rajah model RebateConfig 有宣告 operator 欄位
 *   （rebate_back_office.rajah:129），但 agrabah 只做 `RebateConfig.fromObject(DbRebateConfig
 *   .create(row))` 後手動補 rebateName/updatedAtTimestamp/memberCount 三個欄位
 *   （rebate_platform.ts:53-58），**從未指派 operator**；DB 端 DbRebateConfig 也只有
 *   `operatorId`（agrabah/src/database_types/rebate.ts:10）沒有 operator 名稱欄位。2026-08-28 dev 實測
 *   13 筆全部都沒有 operator 這個 key（protobuf 空字串不輸出）。description 因此不宣稱有操作人。
 * - 整個回傳沒有 realName/銀行帳號等第 8 節列管的真實使用者 PII 欄位（memberCount 只是人數）。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 1. page=1, pageSize=size10：success，rowCount=10，totalPage=2。
 * 2. 不帶任何參數（page 預設 1、pageSize 預設 serverDefault）：success，rowCount=13，
 *    totalPage=1——證實 serverDefault 真的被後端轉成 100（13 筆一頁裝得下）。
 * 3. **「目標記錄不在第一頁」情境（第 2 節 B 級強制驗收案例）**：page=2, pageSize=size10
 *    回 rowCount=3，id 為 49 / 1053 / 1054，這三筆完全沒有出現在第 1 頁的 10 筆裡，
 *    10 + 3 = 13 與第 2 點的全量筆數吻合，證實翻頁真的取得到第一頁以外的資料。
 * 4. **totalPage 陷阱實測驗證**：同一組條件 page=1 回 totalPage=2、page=2 回 totalPage=0
 *    （但 rows 仍正確回 3 筆，不是查詢失敗），與 getPageData 只在 page=1 計算的源碼一致。
 * 5. 回傳欄位實際 union（13 筆合併）：id, rebateName, memberCount, dailyRebateMax,
 *    minDrawAmount, singleBetLimit, dailyDrawMax, wageringMultiplier, singleBetMin,
 *    updatedAtTimestamp。**沒有 operator**（如上方所述，後端從未指派）。
 *    金額欄位實際格式為 [{ code: 'CNY', value: ... }, { code: 'INR', ... }]——欄位名是
 *    code/value（不是 currencyCode/amount）。⚠️ 首輪實測時 value 與 updatedAtTimestamp 都是
 *    十進位**字串**（protobufjs Long 被 JSON.stringify 轉成字串），2026-08-28 review 後改為
 *    在回傳前套 deepFixLongs，重測確認已成為一般數字。
 * 6. 與名稱清單的差異實測：本 tool 13 筆 vs
 *    aladdin_platform_rebate_platform_get_rebate_config_name_list 25 筆，id 差集 12 筆。
 *    「這 12 筆就是軟刪除資料」是從兩支 method 的 SQL 條件差異推得的結論，不是實測觀察——
 *    名稱清單只回 id/rebateName，沒有 deleted 欄位可看，兩支 tool 都無法直接觀察到刪除旗標。
 * 7. deepFixLongs 加上後重測（2026-08-28）：金額 value 與 updatedAtTimestamp 皆為 number。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, deepFixLongs } from '../const.ts';

export function registerGetRebateConfigsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_get_rebate_configs',
        {
            title: 'List this platform\'s rebate configs (paged)',
            description:
                '分頁查詢本平台**未刪除**的返水配置列表（rajah: RebatePlatform.GetRebateConfigs），' +
                '對應後台「優惠中心 > 返水管理 > 返水配置」列表頁。' +
                '⚠️ 這支 method **沒有任何篩選條件**，只有 page/pageSize——想找特定一筆不要靠翻頁：' +
                '已知 id 就用 aladdin_platform_rebate_platform_get_rebate_config_by_id；' +
                '只知道名稱就先用 aladdin_platform_rebate_platform_get_rebate_config_name_list ' +
                '（一次回傳全平台所有 id+名稱、不分頁）查出 id 再查。' +
                '本 tool 只排除已軟刪除的配置（後端條件只有 deleted = 0；這張表沒有啟用/停用狀態欄位，' +
                '所以「未刪除」不等於「啟用中」），' +
                '而上述名稱清單 tool 不排除，兩者筆數不一致是後端既有行為、不是錯誤。' +
                'pageSize 只能是固定選項（PageSizeEnum），serverDefault 由後端轉成 100。' +
                '⚠️ 後端這支的分頁 SQL **沒有 ORDER BY**（只有 WHERE + LIMIT offset,size），' +
                '資料庫不保證跨頁的列順序穩定——翻頁時同一筆有可能重複出現或被跳過。' +
                '需要完整清單時，優先用 pageSize=size200 一次取完，或改用 ' +
                'aladdin_platform_rebate_platform_get_rebate_config_name_list（後端有 id asc 排序）。' +
                '⚠️ totalPage 只有在 page=1 時後端才會真的計算，翻到第 2 頁以後一律回 0' +
                '（已 dev 實測，非本工具的 bug）——判斷是否為最後一頁，要嘛記住 page=1 拿到的 ' +
                'totalPage，要嘛用「這次回傳筆數 < pageSize」判斷。' +
                '回傳每筆的金額欄位（dailyRebateMax 每日最高產生返水、minDrawAmount 最低領取金額、' +
                'singleBetLimit 單筆投注返水上限、dailyDrawMax 每日可領取最高返水、' +
                'singleBetMin 單筆投注金額下限）都是**多幣別陣列** [CurrencyLink]（每個幣別各一筆 ' +
                '{currencyCode, amount}），不是單一數字；wageringMultiplier 是稽核倍數（Rate 型別）。' +
                'memberCount 是後端即時算出的歸屬會員數（依 VIP 等級歸屬 + 個人指定覆蓋，' +
                '排除 $ 開頭的合營代理帳號），不是資料表欄位。' +
                'updatedAtTimestamp 是最後操作時間（i64 毫秒，已轉成一般數字）。' +
                '⚠️ rajah model 雖然宣告了 operator（操作人）欄位，但後端從未指派值，' +
                '實際回傳一律沒有這個欄位，不要期待能從這裡拿到操作人。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('serverDefault').describe('每頁筆數，只能是固定選項之一；serverDefault 由後端轉成 100'),
            },
        },
        async ({ page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigs(page, PAGE_SIZE_MAP[ pageSize ]));
            if (r.failed) return asErrorResult(r);

            const rows = deepFixLongs(r.data?.rows ?? []);
            return asTextResult({
                success: true,
                page,
                rowCount: rows.length,
                totalPage: r.data?.totalPage,
                totalPageOnlyValidOnFirstPage: true,
                rows,
            });
        },
    );
}
