/**
 * tools/get_rebate_config_by_id.ts — aladdin_platform_rebate_platform_get_rebate_config_by_id
 *
 * rajah: RebatePlatform.GetRebateConfigById(id i32 1) (config RebateConfigEdit 1)
 * （rebate_back_office.rajah:285，method 級 @Permission "BonusCenter.Rebate"（同檔 284）；
 * service RebatePlatform 定義於同檔 268 行、@Module "Rebate"（267）；非 @NoPublic、
 * 非 Placeholder）——後台「優惠中心 >
 * 返水管理 > 返水配置」的單筆編輯表單資料來源。
 *
 * agrabah 對應實作：rebate_platform.ts:478-589 methodGetRebateConfigById，確認有真實 override
 * （真的查 rebate_configs + CurrencyLink 六個金額欄位 + 標籤群組/遊戲群組兩層巢狀），
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆（Get by id，回傳單一 model）」。
 * 該節各條檢查項的處理：
 * - 「實測 id 不存在的實際行為」：checklist 列的三種可能（回錯誤碼／空值 struct／拋例外）中，
 *   這支實際是**拋例外**，而不是後端有意回一個錯誤碼。完整成因鏈（逐段讀源碼確認）：
 *   `loadObject` 查無資料時回的是 `ServiceResult.fromData(null)`——**success 不是 failed**
 *   （mysql/mysql_relational_database_engine.ts:293-296）→ 所以 rebate_platform.ts:482 的
 *   `loadResult.failed` 為 false（該行上方 :480 的註解「// 確認存在」名不副實）→ 流程走到 :486
 *   `RebateConfigEdit.fromObject(null)`，該函式第一件事就是讀 `d.id`，對 null 直接 TypeError
 *   → 被 agrabah 的 catch-all（common/server.ts:225-227）轉成
 *   `GenieResponse.fromObject({ errorCode: ErrorCode.unknown })`、**不帶 message**。
 *   這正好解釋 dev 觀測到的 errorCode=1 + message 空字串，也解釋「不存在」與「已軟刪除」為何
 *   無法區分。本 server 對這個 pattern 已有既定寫法（delist_post.ts / relist_post.ts /
 *   remove_post.ts 都標註「errorCode=1(unknown) = 已知後端 bug，id 不存在時的正常反應」），
 *   本檔比照。⚠️ 也因為 errorCode=1 是 catch-all，它**不等於「查無資料」**——任何未捕捉的
 *   後端例外都會回同一個碼，hint 的措辭已避免把兩者畫上等號。
 * - 「跨租戶風險」：**源碼層已保證**——查詢條件是 `id = ? AND platform_id = ? AND deleted = 0`
 *   （rebate_platform.ts:481），platformId 來自登入態的 RequestContext、不是呼叫端參數，
 *   所以無法用別平台的 id 撈到資料。另外 `deleted = 0` 代表**已軟刪除的配置也查不到**
 *   （已 dev 實測，見下方第 3 點）——這點與
 *   aladdin_platform_rebate_platform_get_rebate_config_name_list（不排除軟刪除）不同，
 *   拿名稱清單裡的 id 來查有可能查不到，description 已警告。
 * - 「複合 key 不成對」：本 method 只有單一 key（id），不適用。
 * - 「*ForEdit 系列欄位通常比顯示版多，逐欄檢查有無不該給 agent 看到的內部欄位」：本 method
 *   回傳的是 RebateConfigEdit（編輯版，rebate_back_office.rajah:186-224），確實比列表版
 *   RebateConfig 多出 note（備註）、rebateTagRatioList（廠商×返水標籤比例）、
 *   rebateGameRatioList（特殊遊戲指定比例）、ratio（未知返水標籤返水比例）四組欄位，少了
 *   memberCount/operator/updatedAtTimestamp。逐欄檢查結果：全部都是返水規則設定值，
 *   沒有密鑰/token/密碼，也沒有 realName/銀行帳號等第 8 節列管的真實使用者 PII。
 * - 「Get 前綴不保證唯讀」：已核對 agrabah 實作全程只有 loadObject/queryAmounts/queryById
 *   等讀取呼叫，沒有任何 insert/update/transaction，確為唯讀。
 *
 * 資料格式陷阱（讀源碼查證）：
 * - `[CurrencyLink]` 多幣別陣列（元素形狀 `{ code, value }`，common.rajah:1179-1182，
 *   value 原始型別是 i64）出現在**八個**位置，不只頂層那些：頂層五個金額欄位
 *   dailyRebateMax/minDrawAmount/singleBetLimit/dailyDrawMax/singleBetMin（@Type "Currency"）、
 *   頂層 wageringMultiplier（**@Type "Rate"，是稽核倍數不是金額**，rajah:204-206），
 *   以及巢狀的 rebateTagRatioList[].minBetAmount（rajah:141-142）與
 *   rebateGameRatioList[].minBetAmount（rajah:162-163）。八處都是陣列、不是單一數字。
 *   本 tool 回傳前套用 const.ts 的 `deepFixLongs`（該函式自己的 docblock 記錄了 2026-08-25
 *   dev 復現的 UpdateVipPointSetting 失敗模式）把 protobufjs Long 遞迴轉成一般 number，
 *   否則 JSON.stringify 會把它們變成十進位字串。
 * - `@Type "Percent:10000"`（**放大 10000 倍的整數**，10000 = 1%、5000 = 0.5%）共有三處，
 *   缺一不可：頂層 `ratio`（未知返水標籤返水比例，rajah:219-220）、
 *   `rebateTagRatioList[].ratios[].ratio`（rajah:180-182）、
 *   `rebateGameRatioList[].ratio`（rajah:167-168）。第三處特別容易漏——dev 實測該欄位值是
 *   1000，照字面會被誤讀成 1000%，實際是 0.1%。
 * - `rebateTagRatioList[].ratios[]` 的 vendorId 是廠商編號、rebateTag 是返水標籤編號；
 *   `rebateGameRatioList[].gameIds` 是特殊遊戲 id 陣列（來自 AmountLink 關聯表）。
 * - `id` 在 model 上標了 @Hide（僅代表後台表單不顯示），API 仍會回傳。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 1. id=15（生效中的配置）：success，回傳完整 config——含 note="看看"、ratio=20000
 *    （Percent:10000 格式，即 2%）、六個金額欄位皆為多幣別陣列（CNY/INR，singleBetMin 還多一個
 *    JPY）、rebateGameRatioList 兩組（gameIds 分別是 [258]、[255]，各自帶 ratio=1000 與
 *    minBetAmount 陣列）。本筆沒有 rebateTagRatioList（該平台此配置未設定標籤群組，
 *    protobuf 空陣列不輸出）。⚠️ 首輪實測時 CurrencyLink 的 value 是十進位字串，
 *    2026-08-28 review 後加上 deepFixLongs，重測確認已是一般數字。
 * 2. **id 不存在（id=99999）**：success=false，errorCode=1、message 空字串。errorCode 1 是
 *    genie 基礎碼 ErrorCode.unknown（genie/src/common/error_code.ts:3），不是 idNotExists(11)
 *    或 objectNotFound(14)。errorName 顯示「(未知錯誤碼)」是既有行為——mcp_result.ts 用
 *    AgrabahErrorCodeEnum 反查，而該 enum 從 101 起（remote.gen.ts:19963），不涵蓋 0~25 的
 *    genie 基礎碼。本 tool 因此在失敗回應額外附 requestedId + hint，讓呼叫端不必靠猜。
 * 3. **已軟刪除的 id（id=1052，取自名稱清單有、GetRebateConfigs 沒有的差集）**：同樣是
 *    success=false / errorCode=1 / message 空——與「id 完全不存在」的回應**無法區分**，
 *    證實了源碼 `deleted = 0` 條件的效果，也證實 description 對「名稱清單的 id 不保證查得到」
 *    的警告是必要的。
 * 4. 跨租戶：查詢條件的 platformId 來自登入態、不是呼叫端參數（rebate_platform.ts:481），
 *    tool 也沒有開放任何平台參數，結構上不可能跨平台查詢，無須另做實測。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetRebateConfigByIdTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_get_rebate_config_by_id',
        {
            title: 'Get one rebate config (edit form payload)',
            description:
                '依 id 讀取本平台單一返水配置的**完整編輯內容**（rajah: ' +
                'RebatePlatform.GetRebateConfigById），對應後台「優惠中心 > 返水管理 > 返水配置」' +
                '的編輯表單。比列表版多了 note（備註）、rebateTagRatioList（廠商×返水標籤的返水' +
                '比例群組，每組還有 minBetAmount 最小有效投注）、rebateGameRatioList（特殊遊戲' +
                '指定比例群組，含 gameIds）、ratio（未知返水標籤的返水比例）。' +
                'id 來源：aladdin_platform_rebate_platform_get_rebate_configs（生效中的清單）或 ' +
                'aladdin_platform_rebate_platform_get_rebate_config_name_list（含已刪除的 id↔名稱）。' +
                '⚠️ 後端查詢條件是 `id = ? AND platform_id = ? AND deleted = 0`：' +
                '已軟刪除的配置查不到（會回錯誤），所以從名稱清單拿到的 id 不保證查得到；' +
                'platformId 取自登入態、不是參數，查不到別平台的配置。' +
                '⚠️ 資料格式一：多幣別陣列 [{ code, value }] 出現在八個位置——五個金額欄位' +
                '（dailyRebateMax/minDrawAmount/singleBetLimit/dailyDrawMax/singleBetMin）、' +
                'wageringMultiplier（這個是稽核**倍數**不是金額，型別同樣是多幣別陣列）、' +
                '以及巢狀的 rebateTagRatioList[].minBetAmount 與 rebateGameRatioList[].minBetAmount。' +
                'value 原始型別是 i64，本 tool 已轉成一般數字（不是十進位字串）。' +
                '⚠️ 資料格式二：Percent:10000 格式的整數（10000 = 1%、1000 = 0.1%）共三處——' +
                '頂層 ratio、rebateTagRatioList[].ratios[].ratio、rebateGameRatioList[].ratio，' +
                '三處都不是百分比原值。' +
                '⚠️ 失敗語意：id 不存在或已軟刪除時，後端回 errorCode=1（genie 的 unknown）、' +
                'message 空字串——這是已知的後端行為（查無資料時仍往下走、對 null 取欄位拋例外，' +
                '被最外層 catch 成 unknown），不是本工具的問題，也**無法**從回應區分「不存在」與' +
                '「已刪除」。又因為 errorCode=1 是 catch-all，它不等於「查無資料」，' +
                '其他後端例外也會回同一個碼。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                id: z.number().int().min(1).describe('返水配置 id，來自 aladdin_platform_rebate_platform_get_rebate_configs 或 aladdin_platform_rebate_platform_get_rebate_config_name_list'),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigById(id));
            if (r.failed) {
                return asErrorResult(r, {
                    requestedId: id,
                    hint: 'errorCode=1（genie unknown、message 空）是這支 method 查無資料時的已知後端行為（非本工具問題）：'
                        + '最可能的原因是這個 id 已被軟刪除（後端條件含 deleted = 0）或根本不存在，兩者的回應無法區分；'
                        + '但 errorCode=1 是後端最外層的 catch-all，也可能是其他未捕捉例外。'
                        + '可用 aladdin_platform_rebate_platform_get_rebate_configs 確認目前未刪除的 id。',
                });
            }

            return asTextResult({
                success: true,
                config: deepFixLongs(r.data?.config),
            });
        },
    );
}
