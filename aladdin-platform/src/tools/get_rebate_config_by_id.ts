/**
 * tools/get_rebate_config_by_id.ts — aladdin_platform_rebate_platform_get_rebate_config_by_id
 *
 * rajah: RebatePlatform.GetRebateConfigById(id i32 1) (config RebateConfigEdit 1)
 * （rebate_back_office.rajah:285，method 級 @Permission "BonusCenter.Rebate"（同檔 284）；
 * service RebatePlatform 定義於同檔 268 行、@Module "Rebate"（267）；非 @NoPublic、
 * 非 Placeholder）——後台「優惠中心 >
 * 返水管理 > 返水配置」的單筆編輯表單資料來源。
 *
 * agrabah 對應實作：rebate_platform.ts:478-586 methodGetRebateConfigById，確認有真實 override
 * （真的查 rebate_configs + CurrencyLink 六個金額欄位 + 標籤群組/遊戲群組兩層巢狀），
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆（Get by id，回傳單一 model）」。
 * 該節各條檢查項的處理：
 * - 「實測 id 不存在的實際行為」：見下方 dev 驗證第 2 點（實打不存在的 id）。
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
 * - 六個金額欄位（dailyRebateMax/minDrawAmount/singleBetLimit/dailyDrawMax/
 *   wageringMultiplier/singleBetMin）是 `[CurrencyLink]` 多幣別陣列，元素形狀為
 *   `{ code, value }`（common.rajah:1179-1182），value 是 i64、不是單一數字。
 *   本 tool 回傳前套用 const.ts 的 deepFixLongs 把 protobufjs Long（含巢狀在 CurrencyLink
 *   內的 value 與 minRoundValue 這類 i64）轉成一般 number——這是讓呼叫端能把讀回值直接餵給
 *   create_or_update tool 的 z.number() schema 的必要處理（const.ts:410-414 記錄了這個已在
 *   dev 復現過的失敗模式）。
 * - `ratio`（未知返水標籤返水比例）與 rebateTagRatioList 內的 `ratio` 是
 *   `@Type "Percent:10000"`（rebate_back_office.rajah:219-220 與 180-182）——**放大 10000 倍的整數**，
 *   例如 10000 代表 1%、5000 代表 0.5%，不是百分比原值。
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
                '⚠️ 資料格式：六個金額欄位（dailyRebateMax/minDrawAmount/singleBetLimit/' +
                'dailyDrawMax/wageringMultiplier/singleBetMin）都是多幣別陣列 ' +
                '[{ code, value }]（common.rajah:1179-1182），value 是 i64 stored value、' +
                '本 tool 回傳前已用 deepFixLongs 轉成一般數字（否則會是十進位字串，無法直接餵回寫入 tool）；' +
                'ratio 與 rebateTagRatioList[].ratios[].ratio 是 Percent:10000 格式的整數' +
                '（10000 = 1%），不是百分比原值。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。' +
                '要修改內容請用 aladdin_platform_rebate_platform_create_or_update_rebate_config，' +
                '該 tool 會自己先呼叫本 method 讀現值再合併。',
            inputSchema: {
                id: z.number().int().min(1).describe('返水配置 id，來自 get_rebate_configs 或 get_rebate_config_name_list'),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigById(id));
            if (r.failed) return asErrorResult(r, { requestedId: id, hint: '查不到時最常見的原因是這筆配置已被軟刪除（後端條件含 deleted = 0），或這個 id 不屬於本平台。可用 aladdin_platform_rebate_platform_get_rebate_configs 確認目前生效中的 id。' });

            return asTextResult({
                success: true,
                config: deepFixLongs(r.data?.config),
            });
        },
    );
}
