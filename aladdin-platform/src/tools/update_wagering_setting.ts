/**
 * tools/update_wagering_setting.ts — aladdin_platform_wagering_platform_update_wagering_setting
 *
 * rajah: WageringPlatform.UpdateWageringSetting（wagering_back_office.rajah:425，
 * @Totp（同檔 423）+ @Permission "Finance.Wagering.Setting.Setting.Save"（同檔 424））。
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」）。後端
 * methodUpdateWageringSetting（agrabah/src/servers/wagering_back_office/services/
 * wagering_platform.ts:694-741）在一個 transaction 內做兩件語意完全不同的事，必須分開理解：
 *
 * A. autoRemoveSwitch —— **裸 UPDATE，整包覆蓋，而且沒有 0 列保護**：
 *    `UPDATE wagering_setting SET auto_remove_switch = ? WHERE platform_id = ?`（同檔 700-704）。
 *    程式只檢查 updateSettingResult.failed，**不檢查影響列數**——本平台若還沒有 wagering_setting
 *    列，這句會影響 0 列、靜默什麼都沒做，但整支 RPC 仍回成功。
 *    本工具因為一定先呼叫 GetWageringSetting（那支內部走 getOrCreateDbWageringSetting，
 *    agrabah/src/managers/wagering_manager.ts:541-561，會把列建出來），大幅降低撞上這個坑的機率。
 *    但**不能宣稱「該列必定存在」**：getWageringSetting 在建列失敗時只 log 一行、回預設值，
 *    整支讀取仍回成功（同檔 86-91），所以讀取成功不等於列一定建起來了。真正的保底是寫入後的
 *    round-trip——若那句 UPDATE 影響 0 列，讀回值不會等於送出值，applied/success 會是 false。
 *    這是「先讀現值」在這裡的實際價值，不只是為了比對。
 *    **另一個更危險的點**：protobuf 的 i32 欄位沒帶就是 0，而 0 是 StatusEnum.unknown。
 *    後端判斷自動解除時只特判 `autoRemoveSwitch === StatusEnum.disabled`
 *    （wagering_manager.ts:230），任何非 2 的值都會被當成「不擋」。也就是說**漏帶
 *    autoRemoveSwitch 會把它寫成 0，效果等同把自動解除從關閉改成開啟**。這正是第 4 節警告的
 *    「數字欄位用 prototype 預設值 0 會被硬覆蓋」的實例。本工具因此**永遠送出明確的
 *    autoRemoveSwitch**：呼叫端沒指定時，帶回剛剛讀到的現值。
 *
 * B. autoRemoveBalance —— **逐幣別 upsert，省略即保留，但打錯代碼無法回頭**：
 *    currencyLinkManager.updateCurrencyLinks（同檔 707）→ updateById
 *    （agrabah/src/managers/currency_link_manager.ts:84-87）→ 共用 update helper（同檔 12-42）：
 *    只走傳入陣列，逐筆 `UPDATE id_currency_links … WHERE … AND code = ?`，影響 0 列才 INSERT；
 *    **沒出現在陣列裡的幣別完全不會被碰**（不刪除、不歸零），code 為空的項目直接跳過。
 *    所以這半邊與 update_turnover_multiplier_setting 是同一種語意，不是整包覆蓋。
 *    代價是：後端完全不驗 code，打錯字就會 INSERT 出一列垃圾，而 id_currency_links
 *    **沒有任何刪除路徑**（currency_link_manager.ts 全檔唯一的 DELETE 在 :198，那是另一張
 *    CurrencyAmountLink 表），且讀回時形狀一模一樣、round-trip 會誤判成 applied=true。
 *    本工具因此在送出前先用 CurrencyPlatform.GetCurrencies 驗證每個 code 都是本平台真實存在的幣別。
 *
 * 第 4 節四項要求：1. 先讀現值（見上，且對 A 半邊是必要而非選配）；2. 寫入後 round-trip
 * 讀回逐欄比對，明確回報「沒要求改的欄位是否仍等於呼叫前的值」；3. 新增 vs 更新——
 * B 半邊**可以確定並已回報**：GetWageringSetting 不像 turnover 那支會替不存在的項目補預設值
 * （currency_link_manager.ts:89-96 只回真實存在的列），所以呼叫前讀不到該 code 就確定這次是
 * INSERT，讀得到就是 UPDATE，回傳的 writeMode 直接給答案；A 半邊沒有 id 分流語意，不宣稱。
 * 4. 非 diff 型，無誤刪風險。
 *
 * @Totp：gate 只在該平台替這條 route 設定了 TOTP 時才會要求（ManagementGateLogic.routeGuard，
 * agrabah/src/servers/gate/gate_logics/management_gate_logic.ts:87-105），而驗證碼是由操作者
 * 事先在後台完成、由 gate 從 cache 取用，**RPC 簽名裡沒有可以帶 totpCode 的參數**，MCP 層無法補。
 * 2026-08-28 在 dev（pk-platform.alddev.com）實測未被要求 TOTP，代表該平台沒開這條 route 的設定；
 * 在有開的環境上本工具會直接失敗，那是預期行為，不是工具壞掉。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { WageringSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, toPlainNumber } from '../const.ts';

const SWITCH_KEYS = [ 'enabled', 'disabled' ] as const;

/** 把讀回的 autoRemoveBalance 整理成 code -> value（一般數字）的 map。 */
function toBalanceMap(links: unknown): Map<string, number> {
    const map = new Map<string, number>();
    if (!Array.isArray(links)) return map;
    for (const link of links) {
        const l = link as { code?: unknown; value?: unknown };
        if (typeof l.code === 'string') map.set(l.code, toPlainNumber(l.value) ?? 0);
    }
    return map;
}

export function registerUpdateWageringSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_update_wagering_setting',
        {
            title: 'Update platform wagering auto-remove setting',
            description:
                '修改本平台「財務」→「稽核」→「設置」的稽核自動解除設定' +
                '（rajah: WageringPlatform.UpdateWageringSetting，需要權限節點 ' +
                'Finance.Wagering.Setting.Setting.Save，且掛 @Totp）。' +
                '**這是風險設定，不是顯示設定**：開關開啟後，系統會在該會員被新增稽核的那一刻，' +
                '把他「中心錢包 + 各場館餘額」加總與該幣別門檻比較，' +
                '**總餘額小於或等於門檻就把他該幣別所有未完成稽核改成 autoRemove**' +
                '（agrabah/src/managers/wagering_manager.ts:244-256），等於免除剩下的打碼要求、讓他可以提款。' +
                '所以**開啟開關、或把門檻調高，都是放寬提款條件的方向**。' +
                '要先看目前設定請用 aladdin_platform_wagering_platform_get_wagering_setting。' +
                '**以下五點務必先看清楚：**' +
                '**(1) 漏帶 autoRemoveSwitch 會把它寫成 0，效果等同「開啟」**——後端是裸 UPDATE 整包覆蓋，' +
                '而 protobuf i32 沒帶就是 0（StatusEnum.unknown）；判斷自動解除時只特判 ' +
                '`=== disabled(2)`（wagering_manager.ts:230），任何非 2 的值都當成不擋。' +
                '本工具因此**永遠送出明確的 autoRemoveSwitch**：你沒指定時會自動帶回剛讀到的現值，' +
                '不會讓它退化成 0。這是本工具替你擋掉的坑，直接打 RPC 沒有這層保護。' +
                '**(2) autoRemoveBalance 是逐幣別 upsert，省略即保留**——後端只走你傳入的陣列，' +
                '逐筆依 code 更新、找不到才新增（agrabah/src/managers/currency_link_manager.ts:12-42、84-87）；' +
                '**沒出現在陣列裡的幣別不會被刪除、也不會被歸零**。所以只要傳你要改的那幾個幣別即可。' +
                '**(3) 值是 stored 整數，不是人類可讀金額**——stored = 人類金額 × 10^(decimalPlaces+2)' +
                '（jafar/src/exchange.ts:32-38，CNY/TWD 的 decimalPlaces=2，也就是 ×10000）。' +
                '幣別精度查 aladdin_platform_currency_platform_get_currencies。傳錯數量級就是直接放寬門檻，' +
                '所以本工具對「調高門檻」與「把開關改成 enabled」都要求額外傳 confirmRiskyChange=true。' +
                '**(4) 沒設門檻的幣別等同門檻 0**——後端 find 找不到就取 0（wagering_manager.ts:110-111），' +
                '而餘額要 <= 0 才會解除，除了餘額剛好為 0 的會員之外，實務上等於「該幣別永不自動解除」。' +
                '**幣別代碼打錯無法回頭**：後端不驗 code、會直接 INSERT，而 id_currency_links ' +
                '沒有任何刪除路徑，垃圾列讀回時形狀一模一樣、看起來還像成功。本工具因此會先用 ' +
                'CurrencyPlatform.GetCurrencies 驗證每個 code 都是本平台真實存在的幣別，' +
                '不合法的直接擋下並附上合法清單。回傳的 writeMode 也會告訴你該幣別這次是 insert 還是 update。' +
                '**(5) 這條 route 掛 @Totp**——若該平台替它開了 TOTP 設定，gate 會要求二次驗證，' +
                '而驗證碼是操作者事先在後台完成、由 gate 從 cache 取用，' +
                '**RPC 簽名裡沒有可以帶 totpCode 的參數，本工具無法代勞**；那種環境下本工具會直接失敗，' +
                '這是預期行為。2026-08-28 dev 實測未被要求 TOTP。' +
                '本工具會在寫入前先讀一次現值、寫入後再讀一次，回傳 before / after / changed / writeMode，' +
                '並逐一比對「你沒指定的欄位與幣別是否仍等於呼叫前的值」（unchangedVerified）。' +
                '此操作會送出 audit 寫入（wagering_platform.ts:733-741，fire-and-forget、未 await）。' +
                '**這是寫入型 tool**：在 prod 實例上必須先用 AskUserQuestion（或功能相同的方式）明確詢問' +
                '使用者是否要在正式環境執行，取得明確同意後才可帶上 confirm 參數；絕不能自行假設使用者同意。',
            inputSchema: {
                autoRemoveSwitch: z.enum(SWITCH_KEYS).optional().describe(
                    '自動解除總開關：enabled=開啟／disabled=關閉。**不帶就維持現值**' +
                    '（本工具會自動讀現值帶回去，不會讓它退化成 0）。改成 enabled 需要 confirmRiskyChange=true',
                ),
                autoRemoveBalance: z.array(z.object({
                    code: z.string().min(1).describe('幣別代碼，例如 CNY／TWD。取自 aladdin_platform_currency_platform_get_currencies'),
                    value: z.number().int().min(0).max(Number.MAX_SAFE_INTEGER).describe(
                        '該幣別的自動解除門檻，**stored 整數**（人類金額 × 10^(decimalPlaces+2)，CNY/TWD 為 ×10000）。' +
                        '調高門檻＝更多會員符合自動解除，需要 confirmRiskyChange=true',
                    ),
                })).optional().describe(
                    '要修改的逐幣別門檻。只傳你要改的幣別即可——沒帶到的幣別不會被刪除也不會被歸零',
                ),
                confirmRiskyChange: z.boolean().optional().describe(
                    '把 autoRemoveSwitch 改成 enabled，或調高任何幣別的門檻時必填 true。' +
                    '這兩個方向都是放寬提款條件（讓更多會員的打碼要求被自動免除），需要明確意圖',
                ),
                confirm: z.string().optional().describe(
                    `在 prod 實例上執行寫入時必填，值必須是 "${ PROD_CONFIRM_TOKEN }"。` +
                    '必須先向使用者明確詢問並取得同意後才可帶上，絕不能自行假設。非 prod 環境會忽略此欄位',
                ),
            },
        },
        async ({ autoRemoveSwitch, autoRemoveBalance, confirmRiskyChange, confirm }) => {
            assertProdConfirmed(confirm);
            const wp = () => remote.wageringBackOffice.wageringPlatform;

            if (autoRemoveSwitch === undefined && (autoRemoveBalance ?? []).length === 0) {
                return asTextResult({
                    success: false,
                    message: 'autoRemoveSwitch 與 autoRemoveBalance 至少要指定一項，否則這次呼叫不會改變任何東西。',
                });
            }

            // DB 的 code 比對幾乎確定是 ci collation，['CNY','cny'] 也算重複，正規化後再比。
            const dupes = new Set<string>();
            for (const b of autoRemoveBalance ?? []) {
                if (dupes.has(b.code.toUpperCase())) {
                    return asTextResult({
                        success: false,
                        message: `autoRemoveBalance 裡有重複的幣別「${ b.code }」。後端逐筆處理、後者覆蓋前者，` +
                            '結果不明確，請合併成一筆再呼叫。',
                    });
                }
                dupes.add(b.code.toUpperCase());
            }

            // 第 4 節要求：先讀現值。對這支而言不只是為了比對——autoRemoveSwitch 沒帶會被寫成 0，
            // 而且讀取本身會把 wagering_setting 列建出來，避免後端裸 UPDATE 影響 0 列的靜默失敗。
            const beforeRes = await withAutoRelogin(() => wp().GetWageringSetting());
            if (beforeRes.failed) return asErrorResult(beforeRes, { stage: '寫入前讀取現值失敗，未進行任何寫入' });
            const beforeSetting = beforeRes.data?.wageringSetting as Record<string, unknown> | undefined;
            const beforeSwitchRaw = beforeSetting === undefined ? undefined : toPlainNumber(beforeSetting.autoRemoveSwitch);
            // 本工具的核心保證是「絕不讓沒讀到的值被寫上線」。讀不到現值就不能拿預設值頂替後送出，
            // 否則等於憑空捏造一個狀態寫進 DB，並且 notes 還會宣稱那是「呼叫前的現值」。直接中止。
            if (beforeSwitchRaw === undefined) {
                return asTextResult({
                    success: false,
                    message: '讀取現值時後端沒有回傳 autoRemoveSwitch，本工具無法判斷它目前是什麼狀態，' +
                        '因此中止、未進行任何寫入。理由：這個欄位是整包覆蓋，若拿預設值頂替後送出，' +
                        '等於憑空決定了全平台的自動解除開關。請先用 ' +
                        'aladdin_platform_wagering_platform_get_wagering_setting 確認後端狀況。',
                });
            }
            const beforeSwitch = beforeSwitchRaw;
            const beforeBalance = toBalanceMap(beforeSetting?.autoRemoveBalance);

            // id_currency_links 沒有任何刪除路徑（currency_link_manager.ts 全檔唯一的 DELETE 在 :198，
            // 那是另一張 CurrencyAmountLink 表），所以打錯的幣別代碼會 INSERT 出一列永遠清不掉的資料，
            // 而且讀回時形狀一模一樣、round-trip 會誤判成 applied=true。送出前先對平台幣別清單驗證。
            if ((autoRemoveBalance ?? []).length > 0) {
                const currencyRes = await withAutoRelogin(() => remote.coreBackOffice.currencyPlatform.GetCurrencies(false));
                if (currencyRes.failed) {
                    return asErrorResult(currencyRes, {
                        stage: '無法取得平台幣別清單以驗證 autoRemoveBalance 的 code，未進行任何寫入。' +
                            '不驗證就送出的風險是：打錯的幣別代碼會在 id_currency_links 建出一列永遠清不掉的資料',
                    });
                }
                const knownCodes = new Set(
                    (currencyRes.data?.currencies ?? [])
                        .map((c) => (c as { code?: string | null }).code)
                        .filter((c): c is string => typeof c === 'string'),
                );
                const unknown = (autoRemoveBalance ?? []).map((b) => b.code).filter((c) => !knownCodes.has(c));
                if (unknown.length > 0) {
                    return asTextResult({
                        success: false,
                        message: `autoRemoveBalance 裡有本平台不存在的幣別代碼：${ unknown.join('、') }。` +
                            '已在送出前擋下（尚未寫入任何東西）。後端不驗代碼、會直接 INSERT，' +
                            '而 id_currency_links 沒有任何刪除 API，打錯就會留下永遠清不掉的資料列，' +
                            '且讀回時看起來還像是成功的。請對照下面的合法代碼清單修正。',
                        validCurrencyCodes: [ ...knownCodes ].sort(),
                    });
                }
            }

            // 放寬提款條件的方向都要求明確意圖（後端沒有這道閘門）。
            if (confirmRiskyChange !== true) {
                const risky: string[] = [];
                if (autoRemoveSwitch === 'enabled' && beforeSwitch !== STATUS_MAP.enabled) {
                    risky.push('autoRemoveSwitch：要從關閉改成開啟，會開始自動免除符合條件會員的打碼要求');
                }
                for (const b of autoRemoveBalance ?? []) {
                    const before = beforeBalance.get(b.code);
                    if (before === undefined || b.value > before) {
                        risky.push(
                            `${ b.code } 門檻：${ before === undefined ? '（目前未設定，等同 0）' : before } → ${ b.value }，` +
                            '調高門檻代表更多會員符合自動解除條件',
                        );
                    }
                }
                if (risky.length > 0) {
                    return asTextResult({
                        success: false,
                        message: '這次變更會放寬提款條件，已在送出前擋下（尚未寫入任何東西）。' +
                            '確認無誤請加上 confirmRiskyChange=true 重新呼叫。' +
                            '提醒：門檻是 stored 整數（人類金額 × 10^(decimalPlaces+2)，CNY/TWD 為 ×10000）。',
                        blocked: risky,
                        current: {
                            autoRemoveSwitch: beforeSwitch,
                            autoRemoveBalance: [ ...beforeBalance.entries() ].map(([ code, value ]) => ({ code, value })),
                        },
                    });
                }
            }

            // autoRemoveSwitch 一定明確送出（沒指定就帶回現值），避免被寫成 0。
            const switchToSend = autoRemoveSwitch ? STATUS_MAP[ autoRemoveSwitch ] : beforeSwitch;
            const payload = WageringSetting.create({
                autoRemoveSwitch: switchToSend,
                autoRemoveBalance: (autoRemoveBalance ?? []).map((b) => ({ code: b.code, value: b.value })),
            });

            const writeRes = await withAutoRelogin(() => wp().UpdateWageringSetting(payload));
            if (writeRes.failed) {
                return asErrorResult(writeRes, {
                    stage: '寫入失敗，請用 aladdin_platform_wagering_platform_get_wagering_setting 覆核目前實際值。' +
                        '若錯誤與 TOTP 有關，代表該平台替這條 route 開了二次驗證，本工具無法代勞（見工具說明第 5 點）',
                });
            }

            const afterRes = await withAutoRelogin(() => wp().GetWageringSetting());
            if (afterRes.failed) {
                return asTextResult({
                    success: false,
                    verified: false,
                    writeRpcReportedSuccess: true,
                    message: '寫入 RPC 回報成功，但讀回驗證失敗，**無法確認這次改動是否生效**。' +
                        '這不代表寫入失敗，也不代表成功——請自行用 ' +
                        'aladdin_platform_wagering_platform_get_wagering_setting 覆核目前實際值。',
                    readBackError: { errorCode: afterRes.errorCode, message: afterRes.message },
                });
            }
            const afterSetting = (afterRes.data?.wageringSetting ?? {}) as Record<string, unknown>;
            const afterSwitch = toPlainNumber(afterSetting.autoRemoveSwitch) ?? 0;
            const afterBalance = toBalanceMap(afterSetting.autoRemoveBalance);

            const switchChanged = {
                before: beforeSwitch,
                requested: switchToSend,
                after: afterSwitch,
                applied: afterSwitch === switchToSend,
                explicitlyRequested: autoRemoveSwitch !== undefined,
            };
            const balanceChanged = (autoRemoveBalance ?? []).map((b) => ({
                code: b.code,
                before: beforeBalance.get(b.code) ?? null,
                requested: b.value,
                after: afterBalance.get(b.code) ?? null,
                applied: afterBalance.get(b.code) === b.value,
                // 與 turnover 那支不同：GetWageringSetting 不會替不存在的幣別補預設值
                // （currency_link_manager.ts:89-96 只回真實存在的列），所以 before 為 null
                // 就確定這次是新增一列，有值就確定是更新。這裡可以給出確定的答案。
                writeMode: beforeBalance.has(b.code) ? 'update' : 'insert',
            }));

            const requestedCodes = new Set((autoRemoveBalance ?? []).map((b) => b.code));
            const untouched = [ ...beforeBalance.keys() ].filter((c) => !requestedCodes.has(c)).map((c) => ({
                code: c,
                before: beforeBalance.get(c) ?? null,
                after: afterBalance.get(c) ?? null,
                unchanged: beforeBalance.get(c) === afterBalance.get(c),
            }));

            const allApplied = switchChanged.applied && balanceChanged.every((b) => b.applied);
            const allUntouchedUnchanged = untouched.every((u) => u.unchanged);

            return asTextResult({
                success: allApplied && allUntouchedUnchanged,
                autoRemoveSwitch: switchChanged,
                autoRemoveBalance: balanceChanged,
                unchangedVerified: { ok: allUntouchedUnchanged, rows: untouched },
                notes: {
                    ...(beforeSwitch !== STATUS_MAP.enabled && beforeSwitch !== STATUS_MAP.disabled ? {
                        warningCurrentSwitchValue: `呼叫前的 autoRemoveSwitch 是 ${ beforeSwitch }，`
                            + '既不是 enabled(1) 也不是 disabled(2)。後端只特判 disabled，'
                            + '所以這個值目前的實際效果等同「自動解除沒有被平台設定擋住」。'
                            + '若這不是你要的，請明確把它設成 disabled。',
                    } : {}),
                    switchAlwaysSent: switchChanged.explicitlyRequested
                        ? '你明確指定了 autoRemoveSwitch'
                        : '你沒指定 autoRemoveSwitch，本工具自動帶回呼叫前的現值送出——'
                            + '若不這麼做，protobuf 會把它送成 0（unknown），而後端只特判 disabled(2)，'
                            + '效果等同把自動解除打開',
                    applied: allApplied
                        ? '指定的欄位讀回值都等於要求的值'
                        : '**有欄位讀回值與要求不符**，請檢查上面 applied=false 的項目',
                    untouched: allUntouchedUnchanged
                        ? '未指定的幣別讀回值都與呼叫前相同（符合後端「省略即保留」的語意）'
                        : '**未指定的幣別有值被動到**，這不符合預期，請立即人工覆核',
                    unit: '門檻是 stored 整數（人類金額 × 10^(decimalPlaces+2)，CNY/TWD 為 ×10000）',
                    audit: '後端已送出 audit 寫入，但那是 fire-and-forget（未 await），不保證一定落地',
                },
            });
        },
    );
}
