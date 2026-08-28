/**
 * tools/create_or_update_rebate_config.ts —
 * aladdin_platform_rebate_platform_create_or_update_rebate_config
 *
 * rajah: RebatePlatform.CreateOrUpdateRebateConfig(config RebateConfigEdit 1)（無回傳值）
 * （rebate_back_office.rajah:273，@Permission "BonusCenter.Rebate.RebateConfig"（272）；
 * service RebatePlatform 定義於同檔 268 行、@Module "Rebate"（267）；非 @NoPublic、非 Placeholder）
 * ——後台「優惠中心 > 返水管理 > 返水配置」的新增／編輯儲存。
 *
 * agrabah 對應實作：rebate_platform.ts:221-402 methodCreateOrUpdateRebateConfig，確認有真實
 * override（整個 doTransaction 寫 rebate_configs + 標籤群組/遊戲群組 + CurrencyLink/AmountLink
 * 關聯 + 更新時發 OnRebateConfigChangedMessage 清快取 + 寫稽核 log），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」。逐條處理：
 * - **後端屬第 3 種模式（整包覆蓋、完全沒有 pre-load）**：rebate_platform.ts:309-316 直接
 *   `new DbRebateConfig()` 後把 id/platformId/rebateName/ratio/note/deleted/operatorId 填好，
 *   再 `updateObject(rebateConfig, false)`——**沒有先 load 現有列**，所以 rebateName/ratio/note
 *   只要沒帶到就會被寫成空字串／0。六個 CurrencyLink 欄位同理，是用呼叫端傳來的陣列
 *   `updateById` 覆寫（:342-364）。因此第 4 節第 1 條「先讀現值、只覆蓋要改的欄位」在這支是
 *   **絕對必要**：本 tool 在 id > 0（更新）時一律先呼叫 GetRebateConfigById 取完整現值，
 *   只覆寫呼叫端明確指定的欄位。
 * - **第 4 節第 3 條（id=0 走新增、id>0 走更新，必須明確告知呼叫端）**：後端用 `if (!config.id)`
 *   分流（:319-333），新增走 insertObject、更新走 updateObject **且只有更新分支會發清快取
 *   Message**（:334-338）。本 tool 回傳 `mode: 'create' | 'update'` 明講這次是哪一種。
 * - **第 4 節第 2 條（round-trip 逐欄比對）**：RPC 回傳型別是 Empty（remote.gen.ts:37921-37929
 *   的 doRequest 第 4 參數是 Empty），**不回 id、也不回任何資料**，所以「沒報錯」完全不能當成
 *   成功。本 tool 寫入後一律再讀一次：更新時用 GetRebateConfigById 逐欄比對；
 *   新增時因為拿不到 id，改用「呼叫前後的 GetRebateConfigNameList id 集合差集」定位出新 id
 *   （比對名稱不可靠——dev 上就有兩筆同名的「一般會員」，rebate_configs 沒有名稱唯一約束），
 *   再讀回來驗證。
 * - **第 4 條/第 5 條的特殊陷阱**：本 method 不是 CreateOrUpdateRole 那種 diff 語意，也不是
 *   ActivityTabs 那種「省略即保留」語意——見下面 rebateTagRatioList 的說明，它是第三種：
 *   **省略即刪除關聯**。
 *
 * ⚠️ **不帶回 rebateTagRatioList / rebateGameRatioList 會清掉該配置的所有比例設定**
 * （簽名完全看不出來，與 update_rebate_global_setting 的 steppedConfigList 是同一種地雷）：
 * 方法尾端無條件執行
 * `syncAmounts(..., AmountLinkServiceIdEnum.rebateTagGroup, rebateConfig.id, groupIds)`（:367-370）
 * 與 `syncAmounts(..., rebateGameGroup, rebateConfig.id, groupGameIds)`（:372-375），
 * 而 groupIds/groupGameIds 是從呼叫端傳來的兩個清單累積出來的。傳空陣列 → 關聯被清除。
 * 本 tool 因此在更新時一律把讀回的兩個清單原樣帶回，且**不開放**編輯它們（廠商×標籤返水比例、
 * 特殊遊戲指定比例的結構太複雜、又牽涉 vendorId/rebateTag/gameId 的合法值查詢，要改請走後台 UI）。
 * 新增時這兩個清單必然是空的（後端也沒有其他來源），建立出來的配置只有基本欄位與金額上限，
 * 比例設定要另外用後台 UI 補——description 已明講這個限制。
 * ⚠️ 還有一支 `syncAmounts(..., rebateSteppedRatio, rebateConfig.id, steppedRatioIds)`（:377-380），
 * 而 `steppedRatioIds` 在整個方法裡宣告後**從未被 push 過**（:277 宣告、之後沒有任何寫入），
 * 所以每次呼叫這支 method 都會把該 rebateConfig 底下的 rebateSteppedRatio 關聯清成空。
 * 這是後端既有行為（看起來是複製貼上殘留），本檔如實揭露，不是本 tool 造成的。
 *
 * 其他實作細節（讀源碼查證）：
 * - `operatorId` 由後端從登入態填入（:315 `context.userId`），呼叫端無法指定；
 *   但注意列表版 RebateConfig 的 `operator`（人名）欄位後端從未指派，永遠是空的
 *   （見 get_rebate_configs.ts 檔頭）。
 * - `deleted` 每次都被寫成 0（:314）——所以對一個已軟刪除的 id 呼叫更新，會把它**復活**。
 *   本 tool 讀現值用的 GetRebateConfigById 條件含 `deleted = 0`，已刪除的 id 在讀現值那步就會失敗，
 *   所以本 tool 不會意外復活配置；但直接打 RPC 是做得到的，這裡記錄下來供後續查證。
 * - 新增時兩個群組清單是先於 config 被 insert 的，當下 `rebateConfigId` 會被寫成 0（:236、:281），
 *   真正的歸屬靠後面的 syncAmounts 建立關聯——所以 `rebate_vendor_groups.rebate_config_id` 這個
 *   欄位對新建的配置而言是不可靠的，不要拿它做關聯查詢。
 * - `ratio` 與比例類欄位是 @Type "Percent:10000"（放大一萬倍的整數，10000 = 1%）；
 *   六個金額欄位是 [CurrencyLink]（`{ code, value }`，common.rajah:1179-1182，value 是 i64
 *   stored value）。本 tool 的輸入沿用同一套格式，不做任何單位換算——傳進來是什麼就送什麼。
 *
 * 影響範圍：返水配置決定會員實際能拿多少返水。新增一筆不會自動綁到任何會員（會員歸屬另由 VIP
 * 等級設定或個人指定決定），相對安全；但**更新既有配置會立即影響所有歸屬到該配置的會員**之後
 * 產生的返水金額。這不是不可逆的金流操作（改回去即可，且不會動到已產生的返水紀錄或會員餘額），
 * 但屬高影響設定，description 已要求呼叫端先確認。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 1. 完全不帶參數：本 tool 前置擋下（新增時 rebateName 必填），**沒有送出任何寫入**。
 * 2. 帶 id=99999（不存在）+ note：停在 stage="read-current"、errorCode=1，
 *    **沒有送出任何寫入**——證實「更新一定先讀現值、讀不到就中止」的設計有效。
 * 3. 帶 id=1064 但不帶任何要改的欄位：前置擋下，沒有送出寫入。
 * 4. **新增**（rebateName="MCP測試勿用_20260828"、note、ratio=1500、
 *    dailyRebateMax=[{CNY,123400}]、minDrawAmount=[{CNY,1000}]）：
 *    success=true、mode="create"、**createdId=1064**（由呼叫前後的 id 集合差集定位出來，
 *    不是靠名稱比對）。回讀的 config 逐欄與送出值相符；未指定的三個金額欄位
 *    （singleBetLimit/dailyDrawMax/wageringMultiplier/singleBetMin）與兩組比例清單
 *    都是空陣列，與「新增不會憑空產生金額設定」的說明一致。
 * 5. **部分更新的關鍵驗收（第 4 節第 2 條）**：對 id=1064 只帶 `note` 一個欄位。
 *    success=true、mode="update"、requestedFields=["note"]。逐欄回報顯示：
 *    note before「MCP tool 驗證用，測完會刪」→ after「只改備註_驗證其他欄位不被清空」（ok）；
 *    **rebateName、ratio、dailyRebateMax、minDrawAmount、singleBetLimit、dailyDrawMax、
 *    wageringMultiplier、singleBetMin 的 after 全部等於 before**（含陣列內容逐值相同）、
 *    unexpectedChanges=[]、兩組比例清單筆數 before=after。
 *    這正是本 tool 存在的理由——後端是整包覆蓋，若沒有先讀現值再合併，這一次只改備註的呼叫
 *    會把名稱清成空字串、把五個金額欄位全部清空。
 * 6. **測後清理**：測試用的 id=1064 已用
 *    aladdin_platform_rebate_platform_delete_rebate_config 刪除，未留下任何「生效中」的測試配置。
 *    ⚠️ 但後端只有軟刪除，該資料列會永久留在 rebate_configs 表、持續出現在
 *    get_rebate_config_name_list 的回傳中（名稱刻意取為「MCP測試勿用_20260828」以便辨識）。
 *    它不綁任何會員、不影響任何返水計算。
 * 全程未修改任何既有的返水配置——建立、更新、刪除都只針對這一筆自己建的測試資料。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RebateConfigEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

const currencyLinkSchema = z.array(z.object({
    code: z.string().describe('幣別代碼，如 CNY / INR / JPY'),
    value: z.number().int().describe('該幣別的 stored value 整數（不是顯示金額）'),
}));

const CURRENCY_FIELDS = [ 'dailyRebateMax', 'minDrawAmount', 'singleBetLimit', 'dailyDrawMax', 'wageringMultiplier', 'singleBetMin' ] as const;

export function registerCreateOrUpdateRebateConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_create_or_update_rebate_config',
        {
            title: 'Create or update a rebate config (read-modify-write upsert)',
            description:
                '新增或修改本平台的返水配置（rajah: RebatePlatform.CreateOrUpdateRebateConfig），' +
                '對應後台「優惠中心 > 返水管理 > 返水配置」的新增／編輯儲存。' +
                '**帶 id 就是更新、不帶 id 就是新增**，回傳的 mode 欄位會明講這次做了哪一種。' +
                '⚠️ 更新既有配置會立即影響所有歸屬到該配置的會員之後產生的返水金額' +
                '（不會動到已產生的返水紀錄或會員餘額，改回去即可還原）。呼叫前請先確認使用者真的要改。' +
                '更新時只需要帶想改的欄位：本 tool 會先用 ' +
                'aladdin_platform_rebate_platform_get_rebate_config_by_id 讀現值，只覆寫你指定的欄位，' +
                '其餘原樣帶回——這是**必要**的，因為後端是整包覆蓋、完全沒有欄位級合併，' +
                '沒帶到的文字欄位會被寫成空字串、數字欄位會被寫成 0。' +
                '⚠️ 本 tool **不能**編輯 rebateTagRatioList（廠商×返水標籤比例）與 rebateGameRatioList' +
                '（特殊遊戲指定比例）：更新時會把讀回的原值原樣帶回（不帶回的話後端的 syncAmounts ' +
                '會把該配置的比例設定全部清掉）；新增出來的配置則必然沒有這兩組比例設定，' +
                '要設定請走後台 UI。' +
                '⚠️ 後端已知副作用：每次呼叫都會把該配置的 rebateSteppedRatio 關聯清空' +
                '（後端有一支 syncAmounts 用的清單從頭到尾沒被填過，看起來是殘留程式碼）。' +
                '欄位格式：ratio 是 Percent:10000 的整數（10000 = 1%、1000 = 0.1%）；' +
                'dailyRebateMax（每日最高產生返水）、minDrawAmount（最低領取金額）、' +
                'singleBetLimit（單筆投注返水上限）、dailyDrawMax（每日可領取最高返水）、' +
                'singleBetMin（單筆投注金額下限）、wageringMultiplier（稽核倍數）' +
                '都是多幣別陣列 [{ code, value }]，value 是 stored value 整數（不是顯示金額），' +
                '本 tool 不做任何單位換算。要知道現有配置用什麼數量級，先讀 get_rebate_config_by_id。' +
                'RPC 本身沒有回傳值、**新增也不回 id**，所以本 tool 一定會做 round-trip：' +
                '更新時逐欄比對回讀結果；新增時用呼叫前後的配置 id 集合差集定位出新 id' +
                '（不靠名稱比對——返水配置名稱沒有唯一約束，dev 上就有同名資料）再讀回驗證。',
            inputSchema: {
                id: z.number().int().min(1).optional().describe('要更新的返水配置 id；不帶就是新增一筆。id 來自 aladdin_platform_rebate_platform_get_rebate_configs'),
                rebateName: z.string().max(30).optional().describe('返水配置名稱（rajah 限制最長 30 字）。新增時必填'),
                note: z.string().optional().describe('備註'),
                ratio: z.number().int().min(0).optional().describe('未知返水標籤的返水比例，Percent:10000 格式的整數（10000 = 1%）'),
                dailyRebateMax: currencyLinkSchema.optional().describe('每日最高產生返水，多幣別陣列'),
                minDrawAmount: currencyLinkSchema.optional().describe('最低領取金額，多幣別陣列'),
                singleBetLimit: currencyLinkSchema.optional().describe('單筆投注返水上限，多幣別陣列'),
                dailyDrawMax: currencyLinkSchema.optional().describe('每日可領取最高返水，多幣別陣列'),
                wageringMultiplier: currencyLinkSchema.optional().describe('稽核倍數，多幣別陣列（@Type "Rate"，語意是倍數不是金額）'),
                singleBetMin: currencyLinkSchema.optional().describe('單筆投注金額下限，多幣別陣列'),
            },
        },
        async (input) => {
            const { id, ...rest } = input;
            const overrides: Record<string, unknown> = {};
            for (const [ key, value ] of Object.entries(rest)) {
                if (value !== undefined) overrides[ key ] = value;
            }
            const isUpdate = id !== undefined;

            if (!isUpdate && !overrides.rebateName) {
                return asTextResult({
                    success: false,
                    message: '新增返水配置時 rebateName 必填（後端沒有預設名稱，省略會建立出一筆空名稱的配置）。要更新既有配置請帶 id。',
                });
            }
            if (isUpdate && Object.keys(overrides).length === 0) {
                return asTextResult({
                    success: false,
                    message: '帶了 id 但沒有指定任何要修改的欄位。只想看內容請用 aladdin_platform_rebate_platform_get_rebate_config_by_id。',
                });
            }

            let payload: unknown;
            let beforeConfig: Record<string, unknown> | null = null;
            let idsBefore: number[] = [];

            if (isUpdate) {
                const before = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigById(id));
                if (before.failed) {
                    return asErrorResult(before, {
                        stage: 'read-current',
                        requestedId: id,
                        hint: '讀取現值失敗，**沒有送出任何寫入**。errorCode=1（unknown、message 空）代表這個 id 不存在或已被軟刪除（後端 GetRebateConfigById 條件含 deleted = 0），兩者無法區分。',
                    });
                }
                if (!before.data?.config) {
                    return asTextResult({ success: false, stage: 'read-current', message: '讀取現值成功但沒有 config，無法安全地做部分更新，已中止，未送出任何寫入。' });
                }
                beforeConfig = deepFixLongs(before.data.config) as unknown as Record<string, unknown>;
                // base 展開現值（含 rebateTagRatioList / rebateGameRatioList，不帶回會被後端清空），
                // 再蓋上呼叫端要改的欄位。寫法比照 update_message_board_setting.ts / update_vip_setting.ts。
                payload = RebateConfigEdit.create({ ...before.data.config, ...overrides, id });
            } else {
                const nameListBefore = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigNameList());
                if (nameListBefore.failed) {
                    return asErrorResult(nameListBefore, { stage: 'read-id-set', hint: '新增前無法取得既有配置 id 清單，就無法在新增後定位出新 id，已中止，未送出任何寫入。' });
                }
                idsBefore = (nameListBefore.data?.rows ?? []).map((r) => r.id as number);
                payload = RebateConfigEdit.create({ ...overrides, id: 0 });
            }

            const w = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.CreateOrUpdateRebateConfig(payload as never));
            if (w.failed) {
                return asErrorResult(w, {
                    stage: 'write',
                    mode: isUpdate ? 'update' : 'create',
                    hint: '寫入被後端拒絕，整段在同一個 transaction 內，沒有部分寫入。',
                });
            }

            if (isUpdate) {
                const after = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigById(id));
                if (after.failed) {
                    return asErrorResult(after, { stage: 'verify-readback', mode: 'update', hint: '寫入的 RPC 已回成功，但回讀驗證失敗——無法確認實際結果，請自行用 get_rebate_config_by_id 覆核。' });
                }
                const afterConfig = deepFixLongs(after.data?.config) as unknown as Record<string, unknown>;
                const checked = [ 'rebateName', 'note', 'ratio', ...CURRENCY_FIELDS ];
                const fields = checked.map((key) => ({
                    field: key,
                    changeRequested: key in overrides,
                    before: beforeConfig?.[ key ] ?? null,
                    after: afterConfig?.[ key ] ?? null,
                    ok: key in overrides
                        ? JSON.stringify(afterConfig?.[ key ] ?? null) === JSON.stringify(overrides[ key ])
                        : JSON.stringify(afterConfig?.[ key ] ?? null) === JSON.stringify(beforeConfig?.[ key ] ?? null),
                }));
                const unexpected = fields.filter((f) => !f.ok);
                const groupCounts = {
                    rebateTagRatioList: {
                        before: (beforeConfig?.rebateTagRatioList as unknown[] | undefined)?.length ?? 0,
                        after: (afterConfig?.rebateTagRatioList as unknown[] | undefined)?.length ?? 0,
                    },
                    rebateGameRatioList: {
                        before: (beforeConfig?.rebateGameRatioList as unknown[] | undefined)?.length ?? 0,
                        after: (afterConfig?.rebateGameRatioList as unknown[] | undefined)?.length ?? 0,
                    },
                };
                const groupsKept = groupCounts.rebateTagRatioList.before === groupCounts.rebateTagRatioList.after
                    && groupCounts.rebateGameRatioList.before === groupCounts.rebateGameRatioList.after;
                return asTextResult({
                    success: unexpected.length === 0 && groupsKept,
                    mode: 'update',
                    id,
                    roundTripVerified: true,
                    requestedFields: Object.keys(overrides),
                    fields,
                    groupCounts,
                    unexpectedChanges: unexpected,
                    note: unexpected.length === 0 && groupsKept
                        ? '回讀驗證通過：要求變更的欄位已生效，未要求變更的欄位與兩組比例清單筆數都與呼叫前相同。'
                        : '⚠️ 回讀驗證發現非預期差異，請人工覆核（unexpectedChanges 與 groupCounts）。',
                });
            }

            const nameListAfter = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigNameList());
            if (nameListAfter.failed) {
                return asErrorResult(nameListAfter, { stage: 'verify-locate', mode: 'create', hint: '新增的 RPC 已回成功，但無法重讀 id 清單定位新建的配置，請自行用 get_rebate_configs 確認。' });
            }
            const beforeSet = new Set(idsBefore);
            const newIds = (nameListAfter.data?.rows ?? []).map((r) => r.id as number).filter((i) => !beforeSet.has(i));
            if (newIds.length !== 1) {
                return asTextResult({
                    success: false,
                    mode: 'create',
                    newIdCandidates: newIds,
                    note: newIds.length === 0
                        ? '⚠️ 新增的 RPC 回成功，但呼叫前後的配置 id 集合沒有變化，無法確認是否真的建立成功，請人工覆核。'
                        : '⚠️ 呼叫前後多出不只一個 id（可能有其他人同時在建立配置），無法安全地判定哪一個是本次建立的，請人工覆核。',
                });
            }
            const created = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateConfigById(newIds[ 0 ]));
            if (created.failed) {
                return asErrorResult(created, { stage: 'verify-readback', mode: 'create', createdId: newIds[ 0 ], hint: '已定位出新建的 id，但回讀失敗，請自行用 get_rebate_config_by_id 覆核。' });
            }
            return asTextResult({
                success: true,
                mode: 'create',
                createdId: newIds[ 0 ],
                roundTripVerified: true,
                requestedFields: Object.keys(overrides),
                config: deepFixLongs(created.data?.config),
                note: '新增成功並已回讀驗證。新建配置沒有 rebateTagRatioList / rebateGameRatioList 比例設定（本 tool 不支援，請走後台 UI 補），也不會自動綁定任何會員。',
            });
        },
    );
}
