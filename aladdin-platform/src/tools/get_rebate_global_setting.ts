/**
 * tools/get_rebate_global_setting.ts — aladdin_platform_rebate_platform_get_rebate_global_setting
 *
 * rajah: RebatePlatform.GetRebateGlobalSetting() (config RebateGlobalSetting 1)
 * （rebate_back_office.rajah:291，@Permission "BonusCenter"——刻意綁共同祖先，因為「返水管理」
 * 與「階梯式返水」兩頁共用這支，見同檔 290 的註解；service RebatePlatform 定義於同檔 268 行、
 * @Module "Rebate"（267）；
 * 非 @NoPublic、非 Placeholder）——後台「優惠中心 > 返水管理 > 全域返水設定」。
 *
 * agrabah 對應實作：rebate_platform.ts:604-682 methodGetRebateGlobalSetting，確認有真實
 * override（真的查 rebate_global_settings + 階梯配置兩層巢狀），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」（無參數、回傳單一 model；
 * 定位鍵是登入態的 platformId，不是呼叫端參數）。第 1 節「實測 id 不存在的實際行為」在這支
 * 沒有 id 參數，對應的邊界是「這個平台還沒有 rebate_global_settings 資料列」——後端一樣是
 * `loadObject`（rebate_platform.ts:606），而 `loadObject` 查無資料回的是
 * `ServiceResult.fromData(null)`（success 不是 failed，
 * mysql/mysql_relational_database_engine.ts:293-296），接著 :611 `RebateGlobalSetting
 * .fromObject(null)` 會拋 TypeError、被 common/server.ts:225-227 的 catch-all 轉成
 * errorCode=1（unknown、message 空）。dev 上該平台有資料、走不到這條路徑，但呼叫端要知道
 * 「errorCode=1」在這支的語意可能是「本平台尚未初始化全域返水設定」而不是真的系統錯誤。
 *
 * ⚠️ **「Get 前綴不保證唯讀」——這支真的有副作用**（第 1 節明文要求查證的情況）：
 * rebate_platform.ts:644 每讀到一筆階梯配置就呼叫
 * `this.insertDebugLog(context, 0, steppedConfig.id, ratiosResult.data.length, '').then()`，
 * 對 `rebate_debug_logs` 表 **INSERT 一筆除錯紀錄**（fire-and-forget，不 await、不影響回傳）。
 * 這不是業務資料異動（不改任何返水設定、不動任何使用者資料、不涉金流），呼叫端不會因為多讀
 * 幾次而改變系統行為，但「完全唯讀」的說法不成立，description 已據實揭露：
 * 可安全重複呼叫，但每次呼叫會在後端除錯表留下紀錄，不要當成零成本的輪詢對象。
 *
 * agrabah 實作細節（讀源碼查證）：
 * - 讀取走 `context.readonlyRelationalDatabase`（唯讀連線），條件只有 `platform_id = ?`
 *   （rebate_platform.ts:606），沒有跨租戶風險（platformId 來自登入態、非參數）。
 * - `steppedConfigList` 的「內建預設值」有一個**容易誤解的邊界**：agrabah 方法註解寫「當平台
 *   尚未建立任何 RebateSteppedConfig 時，回傳一個內建預設 steppedConfig（configName=综合返水、
 *   rebateMode=validAmount）」，但實際控制流是——AmountLink 關聯查不到任何 id 時（618-619）
 *   直接回**空陣列 []**，並不會給預設值；只有在「AmountLink 有 id、但 rebate_stepped_configs
 *   撈不到對應 row」這種懸空引用情況下（668-678）才會回那筆預設。呼叫端因此要同時處理
 *   `steppedConfigList` 為空陣列與含一筆 id=0 預設值兩種情況。
 * - `steppedRatioList[].minAmount` 是 [CurrencyLink] 多幣別陣列（common.rajah:1179-1182，
 *   value 是 i64；本 tool 回傳前套 const.ts 的 `deepFixLongs` 轉成一般 number，理由見該函式自己的
 *   docblock 所記錄的「讀回值直接餵回寫入 tool」失敗模式）；rajah 上還宣告了 maxAmount
 *   但已被註解掉（rebate_back_office.rajah:66-67 與 rebate_platform.ts:660-664 兩邊都註解掉），實際不會有值。
 * - enum 對照（rebate_back_office.rajah）：status/verify/claimSwitch 是 ActiveStatusEnum
 *   （common.rajah 的 enabled=1、disabled=2）；rebatePeriod 是 RebatePeriodEnum（daily=0 每日領取、
 *   immediate=1 時時領取，rebate_back_office.rajah:11-16）；rebateGetType 是 RebateGetTypeEnum
 *   （auto=0 自動領取、manual=1 手動領取，同檔 4-9；欄位在 model 上標 @Readonly，同檔 31）；
 *   globalRebateMode 是 GlobalRebateModeEnum（none=0 關閉、combined=1 綜合返水、
 *   separate=2 倍場返水，同檔 92-99）；rebateMode 是 RebateSteppedModeEnum（loss=0 虧損返水、
 *   validAmount=1 流水返水，同檔 50-55）。
 *   這些對照表已集中放進 const.ts 供本 tool 與 update 版共用。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 1. 呼叫本 tool（無參數）：success。回傳 config 頂層欄位實際為 id=2、status=1、
 *    rebatePeriod=0、rebateGetType=1、rebateExpireHour=720、verify=1、claimSwitch=1、
 *    globalRebateMode=2，與 rajah model 宣告的 9 個欄位一一對應（含 @Hide 的 id 與
 *    globalRebateMode，證實 @Hide 只是後台表單不顯示、API 照樣回傳）。
 * 2. steppedConfigList 實際回 6 筆（id 19/22/23/24/25/26，configName 分別為 综合返水、1.8、
 *    1.88、2.0、3.2、測試非28），每筆含 rebateMode=1、minRoundValue（i64，JSON 上是字串）、
 *    gameIds（3~22 個 id 不等）、wageringMultiplier、steppedRatioList（1~2 筆）。
 *    ⚠️ 首輪實測時 minRoundValue 與 CurrencyLink.value 都是十進位字串，2026-08-28 review 後
 *    加上 deepFixLongs，重測確認已是一般數字。
 *    steppedRatioList 元素形如 { id: 20, ratio: 10, minAmount: [{ code: 'CNY', value: '0' }] }，
 *    確認 minAmount 是多幣別陣列、且沒有 maxAmount 欄位（與 rajah/agrabah 兩邊都註解掉一致）。
 * 3. **未觀察到**「id=0 內建預設」那條分支——本平台已有 6 筆真實階梯配置，
 *    走不到 rebate_platform.ts:668-678 的懸空引用分支。該分支的存在是讀源碼確認的，
 *    dev 上沒有可重現的資料，description 仍保留提醒讓呼叫端兩種情況都能處理。
 * 4. `wageringMultiplier`（階梯配置的稽核倍率）在 rajah 上是裸 i32、**沒有 @Type 標註**
 *    （rebate_back_office.rajah:88，model RebateSteppedConfig 72-89），dev 實測值為 25000/30000/13700/3000/50000。數量級看起來
 *    像放大一萬倍，但 rajah 沒有宣告這件事，本檔與 description 因此不宣稱它的縮放倍率，
 *    只如實回傳原值。
 * 5. 副作用宣稱：rebate_platform.ts:644 的 insertDebugLog 是讀源碼確認的（每筆階梯配置一次，
 *    本平台一次呼叫會寫 6 筆），未在 dev 直接查 rebate_debug_logs 佐證——DB 查詢不在本輪
 *    授權的驗證手段內。description 對此的敘述維持在源碼可證的範圍：會寫除錯紀錄、不動業務資料。
 * 除上述後端自身的除錯紀錄外，本 tool 未寫入/修改任何 dev 業務資料，無需清理。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetRebateGlobalSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_get_rebate_global_setting',
        {
            title: 'Get this platform\'s global rebate setting',
            description:
                '讀取本平台的全域返水設定（rajah: RebatePlatform.GetRebateGlobalSetting），' +
                '對應後台「優惠中心 > 返水管理 > 全域返水設定」，同一份設定也被「階梯式返水」頁共用。' +
                '無參數，範圍由登入態的平台決定。' +
                '回傳欄位與 enum 對照：status（返水產生開關，1=開 2=關）、' +
                'claimSwitch（返水領取開關，1=開 2=關）、verify（返水是否需審核，1=開 2=關）、' +
                'rebatePeriod（領取週期，0=每日領取 1=時時領取）、' +
                'rebateGetType（領取方式，0=自動領取 1=手動領取；此欄位在 model 上標記為唯讀）、' +
                'rebateExpireHour（返水有效期限，單位小時）、' +
                'globalRebateMode（全局返水模式，0=關閉 1=綜合返水 2=倍場返水）、' +
                'steppedConfigList（階梯式返水配置陣列，每筆含 configName、rebateMode' +
                '（0=虧損返水 1=流水返水）、minRoundValue 最小下注期數、gameIds 特殊遊戲、' +
                'wageringMultiplier 稽核倍率、steppedRatioList 階層比例（ratio 為 Percent:10000 ' +
                '格式的整數，minAmount 為多幣別陣列 [{code,value}]））。' +
                '⚠️ steppedConfigList 可能是空陣列，也可能是後端補的一筆 id=0 的內建預設' +
                '（configName="综合返水"、rebateMode=1、比例清單為空），兩種都要能處理。' +
                '⚠️ 這支雖然是 Get，但**不是完全唯讀**：後端每讀到一筆階梯配置會非同步 INSERT ' +
                '一筆除錯紀錄到 rebate_debug_logs 表（不影響回傳內容、不動任何返水設定或使用者' +
                '資料）。可以安全重複呼叫，但不要拿它當零成本的輪詢對象。' +
                '⚠️ 失敗語意：若本平台尚未建立全域返水設定資料列，後端會回 errorCode=1（genie unknown、' +
                'message 空），這是已知的後端行為（查無資料仍往下對 null 取欄位、被最外層 catch），' +
                '不代表系統故障。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateGlobalSetting());
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                config: deepFixLongs(r.data?.config),
            });
        },
    );
}
