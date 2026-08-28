/**
 * tools/update_rebate_global_setting.ts —
 * aladdin_platform_rebate_platform_update_rebate_global_setting
 *
 * rajah: RebatePlatform.UpdateRebateGlobalSetting(config RebateGlobalSetting 1)（無回傳值）
 * （rebate_back_office.rajah:294，@Permission "BonusCenter"（293）——與 GetRebateGlobalSetting
 * 同樣刻意綁共同祖先，因為「返水管理」與「階梯式返水」兩頁共用；service RebatePlatform 定義於
 * 同檔 268 行、@Module "Rebate"（267）；非 @NoPublic、非 Placeholder）
 * ——後台「優惠中心 > 返水管理 > 全域返水設定」的儲存動作。
 *
 * agrabah 對應實作：rebate_platform.ts:698-869 methodUpdateRebateGlobalSetting，確認有真實
 * override（一整個 doTransaction 寫 rebate_global_settings + 階層配置/比例 + CurrencyLink/
 * AmountLink 關聯 + 發 OnRebateGlobalSettingChangedMessage 清快取 + 寫稽核 log），
 * 不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」。該節的三種後端合併模式
 * 中，這支經讀源碼確認是**第 3 種：完全沒有欄位級 pre-load、整包覆蓋**——
 * rebate_platform.ts:739-747 把 config 的七個頂層欄位**無條件**指派到 DB 物件上
 * （status/rebatePeriod/rebateGetType/rebateExpireHour/verify/claimSwitch/globalRebateMode），
 * 沒有任何「呼叫端有沒有設定這個欄位」的判斷。因此第 4 節第 1 條「先讀現值、只覆蓋要改的欄位」
 * 在這支是**絕對必要**而不是保險：本 tool 一律先呼叫 GetRebateGlobalSetting，直接把回傳的
 * RebateGlobalSetting 物件本身拿來改（不重新建構、不重新編碼），只覆寫呼叫端明確指定的欄位，
 * 其餘原封不動送回。
 *
 * ⚠️ **不傳 steppedConfigList 會清掉整個平台的階梯式返水配置**（這是本檔最重要的一條，
 * 簽名完全看不出來）：方法尾端無條件執行
 * `amountLinkManager.syncAmounts(..., AmountLinkServiceIdEnum.rebateSteppedConfig,
 * rebateGlobalSetting.id, steppedConfigIds)`（rebate_platform.ts:837-840），而 steppedConfigIds
 * 是從呼叫端傳來的 steppedConfigList 累積出來的。傳空陣列 → syncAmounts 收到空清單 →
 * 該平台與所有階梯配置的關聯被清除。所以本 tool **必定**把讀回來的 steppedConfigList 原樣帶回，
 * 且**不開放**編輯它（要改階梯配置請走後台 UI；本 tool 只負責七個頂層開關）。
 *
 * 其他實作細節（讀源碼查證）：
 * - **平台還沒有設定列時會走新增**：loadObject 回 null 時 new 一個 DbRebateGlobalSetting
 *   （:726-733），所以這支同時是 create 與 update。但本 tool 先呼叫 GetRebateGlobalSetting 讀現值，
 *   而那支在沒有設定列時會拋例外回 errorCode=1（見 get_rebate_global_setting.ts 檔頭），
 *   所以**本 tool 在「平台從未設定過」的情況下無法運作**，會在讀現值那步就失敗並如實回報。
 *   這是刻意的取捨：沒有現值就無法滿足「只覆蓋要改的欄位」的要求，硬送一份憑空的 config
 *   會把七個欄位全部設成預設值。
 * - **rebateGetType（返水領取方式）不開放修改**：model 上標 @Readonly（rebate_back_office.rajah:31），
 *   後台表單不給改。但後端**沒有**擋，且是無條件覆寫——所以本 tool 仍必須把現值原樣帶回，
 *   否則會被寫成 0（auto）。tool 只是不提供修改它的參數。
 * - **兩個欄位會被後端無條件寫死**：`rebateStrategy = 0`（返水方式，原始碼註解「暫時破棄」）與
 *   `steppedSwitch = 0`（28 返水開關，同樣「暫時破棄」）（:748-749）。這兩欄不在 rajah model 上，
 *   呼叫端無從控制，但每次儲存都會被歸零——這是後端既有行為，本 tool 只是如實揭露。
 * - **前置驗證**：steppedConfigList 長度 > 2 時，會檢查 index 1 起所有 gameIds 全域不重複，
 *   重複回 AgrabahErrorCodeEnum.rebateGameIdDuplicate + 'gameIds duplicate'（:700-713）。
 *   本 tool 原樣帶回既有清單，正常情況不會踩到；若既有資料本身就有重複，這支會失敗且不寫入
 *   （整段在 doTransaction 之外，屬於乾淨的前置擋下）。
 * - 成功後會 publish OnRebateGlobalSettingChangedMessage 清快取（:865 附近）並寫平台稽核 log
 *   （PlatformActionIdEnum.rebateGlobalSettingUpdate），所以每次呼叫都會留下可追溯的操作紀錄。
 * - 回傳型別是 Empty（remote.gen.ts:38005-38013 的 doRequest 第 4 參數是 Empty），
 *   RPC 不回任何資料，**成功與否不能只看不報錯**——本 tool 依第 4 節第 2 條，寫入後一定
 *   再讀一次做 round-trip 比對，並把「要求變更的欄位」與「未要求變更的欄位」的前後值都回報。
 *
 * 影響範圍提醒：這是**平台層級**的返水總開關（返水產生/領取/審核、領取週期、有效期限、
 * 全局返水模式），改動會影響全平台所有會員之後產生與領取返水的行為。它不是不可逆的金流操作
 * （把值改回去即可還原，且不會動到任何已產生的返水紀錄或會員餘額），但仍屬高影響設定，
 * description 已要求呼叫端先確認。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 0. 測試前先用 get_rebate_global_setting 取得完整快照存檔（scalars = id:2, status:1,
 *    rebatePeriod:0, rebateGetType:1, rebateExpireHour:720, verify:1, claimSwitch:1,
 *    globalRebateMode:2；steppedConfigList 6 筆），作為事後還原與比對的基準。
 * 1. 不帶任何欄位：本 tool 前置擋下（success=false + 說明），**沒有送出任何寫入**。
 * 2. rebateExpireHour: 720 → 721：success=true，roundTripVerified=true。逐欄回報顯示
 *    rebateExpireHour before=720 / after=721 / matchesRequest=true，其餘六欄
 *    （status/rebatePeriod/rebateGetType/verify/claimSwitch/globalRebateMode）
 *    before 與 after 完全相同、unexpectedChanges=[]、steppedConfigCount before=after=6。
 * 3. **「未要求變更的欄位是否被動到」的獨立驗證**（不靠本 tool 自己的回報）：寫入後另外用
 *    get_rebate_global_setting 重讀，與步驟 0 的快照做完整比對——純量欄位只有
 *    rebateExpireHour 從 720 變 721，而 `steppedConfigList` 整棵樹（6 筆配置、各自的
 *    configName/rebateMode/minRoundValue/wageringMultiplier/gameIds/steppedRatioList
 *    含 ratio 與多幣別 minAmount）**逐欄完全相等**。這證實了檔頭「必須把讀回的
 *    steppedConfigList 原樣帶回」的作法有效，沒有發生任何巢狀資料遺失或被 syncAmounts 清空。
 * 4. **六個 enum/數值映射一次驗完（零淨變更）**：把六個可改欄位全部帶上「等於現值」的值
 *    （status=enabled, rebatePeriod=daily, globalRebateMode=separate, verify=enabled,
 *    claimSwitch=enabled, rebateExpireHour=720）→ success=true，逐欄 requested 依序解出
 *    1 / 0 / 2 / 1 / 1 / 720，且 after 全部等於 requested。這一次呼叫同時驗證了
 *    ACTIVE_STATUS_MAP、REBATE_PERIOD_MAP、GLOBAL_REBATE_MODE_MAP 三張對照表的字串→數值轉換
 *    都正確，而且沒有實際改變任何設定。
 * 5. **測後還原與確認**：rebateExpireHour 已在步驟 4 同一次呼叫改回 720；最後再讀一次全量設定，
 *    與步驟 0 的原始快照**完整相等（含 steppedConfigList 全樹）**，dev 上沒有留下任何測試痕跡。
 *    唯一無法還原的是後端自己寫的稽核 log 與除錯紀錄（rebate_debug_logs），那是後端行為、
 *    本來就沒有刪除介面。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RebateGlobalSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ACTIVE_STATUS_MAP,
    GLOBAL_REBATE_MODE_KEYS,
    GLOBAL_REBATE_MODE_MAP,
    REBATE_PERIOD_KEYS,
    REBATE_PERIOD_MAP,
    deepFixLongs,
} from '../const.ts';

/** 供 round-trip 比對用：只取七個頂層純量欄位，不含 steppedConfigList（巢狀且本 tool 不動它）。 */
const SCALAR_FIELDS = [ 'status', 'rebatePeriod', 'rebateGetType', 'rebateExpireHour', 'verify', 'claimSwitch', 'globalRebateMode' ] as const;

function pickScalars(config: Record<string, unknown> | null | undefined): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const key of SCALAR_FIELDS) out[ key ] = (config as Record<string, unknown> | null)?.[ key ] ?? 0;
    return out;
}

export function registerUpdateRebateGlobalSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_update_rebate_global_setting',
        {
            title: 'Update this platform\'s global rebate setting (partial, read-modify-write)',
            description:
                '修改本平台的全域返水設定（rajah: RebatePlatform.UpdateRebateGlobalSetting），' +
                '對應後台「優惠中心 > 返水管理 > 全域返水設定」的儲存。' +
                '⚠️ 高影響設定：這是**平台層級**的返水總開關，改動會影響全平台所有會員之後產生與' +
                '領取返水的行為（不會動到已產生的返水紀錄或會員餘額，把值改回去即可還原）。' +
                '呼叫前請先確認使用者真的要改。' +
                '只需要帶想改的欄位：本 tool 會先呼叫 GetRebateGlobalSetting 讀現值，' +
                '只覆寫你指定的欄位，其餘（含不開放修改的 rebateGetType 與整份階梯式返水配置）' +
                '原樣帶回——這是**必要**的，因為後端是整包覆蓋、沒有欄位級合併，' +
                '而且不帶階梯配置會把平台的階梯式返水配置關聯全部清掉。' +
                '可改欄位：status（返水產生開關 enabled/disabled）、claimSwitch（返水領取開關）、' +
                'verify（返水是否需審核）、rebatePeriod（領取週期 daily 每日 / immediate 時時）、' +
                'rebateExpireHour（返水有效期限，小時）、' +
                'globalRebateMode（全局返水模式 none 關閉 / combined 綜合返水 / separate 倍場返水）。' +
                '⚠️ 本 tool **不能**編輯階梯式返水配置（steppedConfigList）與 rebateGetType' +
                '（後者在 model 上標 @Readonly），要改請走後台 UI。' +
                '⚠️ 後端每次儲存都會把兩個 rajah model 上沒有的欄位寫死為 0（rebateStrategy、' +
                'steppedSwitch，原始碼註解都寫「暫時破棄」），這是既有行為、呼叫端無從控制。' +
                '⚠️ 若本平台從未建立過全域返水設定，讀現值那步會失敗（後端已知行為，回 errorCode=1），' +
                '本 tool 會如實回報而不會憑空送出一份預設設定。' +
                'RPC 本身沒有回傳值，所以本 tool 寫入後一定會再讀一次做 round-trip 比對，' +
                '回傳 before/after 與逐欄 changed/unchanged 判定，不會只憑「沒報錯」就宣稱成功。' +
                '成功時後端會清返水快取並寫一筆平台稽核 log。',
            inputSchema: {
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('返水產生開關；不帶則維持現值'),
                claimSwitch: z.enum([ 'enabled', 'disabled' ]).optional().describe('返水領取開關；不帶則維持現值'),
                verify: z.enum([ 'enabled', 'disabled' ]).optional().describe('返水是否需要審核；不帶則維持現值'),
                rebatePeriod: z.enum(REBATE_PERIOD_KEYS).optional().describe('領取週期：daily 每日領取 / immediate 時時領取；不帶則維持現值'),
                rebateExpireHour: z.number().int().min(0).optional().describe('返水有效期限（小時）；不帶則維持現值'),
                globalRebateMode: z.enum(GLOBAL_REBATE_MODE_KEYS).optional().describe('全局返水模式：none 關閉 / combined 綜合返水 / separate 倍場返水；不帶則維持現值'),
            },
        },
        async (input) => {
            const requested: Record<string, number> = {};
            if (input.status !== undefined) requested.status = ACTIVE_STATUS_MAP[ input.status ];
            if (input.claimSwitch !== undefined) requested.claimSwitch = ACTIVE_STATUS_MAP[ input.claimSwitch ];
            if (input.verify !== undefined) requested.verify = ACTIVE_STATUS_MAP[ input.verify ];
            if (input.rebatePeriod !== undefined) requested.rebatePeriod = REBATE_PERIOD_MAP[ input.rebatePeriod ];
            if (input.rebateExpireHour !== undefined) requested.rebateExpireHour = input.rebateExpireHour;
            if (input.globalRebateMode !== undefined) requested.globalRebateMode = GLOBAL_REBATE_MODE_MAP[ input.globalRebateMode ];

            if (Object.keys(requested).length === 0) {
                return asTextResult({
                    success: false,
                    message: '沒有指定任何要修改的欄位。這支 tool 是讀-改-寫，至少要帶一個欄位；只想看現值請用 aladdin_platform_rebate_platform_get_rebate_global_setting。',
                });
            }

            const before = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateGlobalSetting());
            if (before.failed) {
                return asErrorResult(before, {
                    stage: 'read-current',
                    hint: '讀取現值失敗，**沒有送出任何寫入**。errorCode=1（unknown、message 空）通常代表本平台還沒有全域返水設定資料列（後端已知行為）。',
                });
            }
            const config = before.data?.config;
            if (!config) {
                return asTextResult({
                    success: false,
                    stage: 'read-current',
                    message: '讀取現值成功但沒有 config，無法安全地做部分更新，已中止，未送出任何寫入。',
                });
            }

            const beforeScalars = pickScalars(config as unknown as Record<string, unknown>);
            const beforeSteppedCount = (config as unknown as { steppedConfigList?: unknown[] }).steppedConfigList?.length ?? 0;

            // 比照本 server 既有 update 類 tool 的寫法（update_message_board_setting.ts:168、
            // update_vip_setting.ts:121）：base 展開現值、再蓋上呼叫端要改的欄位。
            // steppedConfigList 隨 base 一起原封不動帶回（不帶回會被後端 syncAmounts 清空，見檔頭）。
            const merged = RebateGlobalSetting.create({ ...config, ...requested });

            const w = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.UpdateRebateGlobalSetting(merged));
            if (w.failed) {
                return asErrorResult(w, {
                    stage: 'write',
                    beforeScalars: deepFixLongs(beforeScalars),
                    hint: '寫入被後端拒絕。errorCode 對應 rebateGameIdDuplicate 時，代表既有階梯配置的 gameIds 本身就有重複（後端在寫入前擋下），不是本次要改的欄位有問題；此時沒有任何資料被寫入。',
                });
            }

            const after = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateGlobalSetting());
            if (after.failed) {
                return asErrorResult(after, {
                    stage: 'verify-readback',
                    hint: '寫入的 RPC 已回成功，但回讀驗證失敗——無法確認實際結果，請自行用 aladdin_platform_rebate_platform_get_rebate_global_setting 覆核。',
                });
            }
            const afterScalars = pickScalars(after.data?.config as unknown as Record<string, unknown>);
            const afterSteppedCount = (after.data?.config as unknown as { steppedConfigList?: unknown[] })?.steppedConfigList?.length ?? 0;

            const fields = SCALAR_FIELDS.map((key) => ({
                field: key,
                requested: key in requested ? requested[ key ] : null,
                before: beforeScalars[ key ],
                after: afterScalars[ key ],
                matchesRequest: key in requested ? afterScalars[ key ] === requested[ key ] : afterScalars[ key ] === beforeScalars[ key ],
            }));
            const unexpected = fields.filter((f) => !f.matchesRequest);

            return asTextResult({
                success: unexpected.length === 0 && afterSteppedCount === beforeSteppedCount,
                roundTripVerified: true,
                requestedFields: Object.keys(requested),
                fields: deepFixLongs(fields),
                steppedConfigCount: { before: beforeSteppedCount, after: afterSteppedCount },
                unexpectedChanges: deepFixLongs(unexpected),
                note: unexpected.length === 0 && afterSteppedCount === beforeSteppedCount
                    ? '回讀驗證通過：要求變更的欄位已生效，未要求變更的欄位與階梯配置筆數都與呼叫前相同。'
                    : '⚠️ 回讀驗證發現非預期差異，請人工覆核（unexpectedChanges 與 steppedConfigCount）。',
            });
        },
    );
}
