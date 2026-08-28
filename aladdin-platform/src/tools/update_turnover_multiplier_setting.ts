/**
 * tools/update_turnover_multiplier_setting.ts — aladdin_platform_wagering_platform_update_turnover_multiplier_setting
 *
 * rajah: WageringPlatform.UpdateTurnoverMultiplierSetting（wagering_back_office.rajah:431，
 * @Permission "Finance.Wagering.Setting.TurnoverMultiplierSetting"，同檔 430。**未掛 @Totp**——
 * 對照同 service 的 UpdateWageringSetting（423）與 ManualAddUserWagering（408）都有掛，
 * agrabah 端也自己留了「[TBD: 需開發者確認是否應加 @Totp]」的註解（wagering_platform.ts:797）。
 * rajah 參數名 `mltiplierList` 有拼字疏漏，屬上游既有問題，不影響呼叫。）
 *
 * 分類（method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」，特別是該節第 5 點
 * 「批次陣列型 Upsert」）：後端 methodUpdateTurnoverMultiplierSetting
 * （agrabah/src/servers/wagering_back_office/services/wagering_platform.ts:800-855）先把 DB 現有列
 * 讀成 map（同檔 802-808），再對**傳入陣列**逐筆處理：該 turnoverType 不在 DB → insert 新列
 * （同檔 815-822）；已在 DB → 先清 redis 再 UPDATE（同檔 826-841）。**沒出現在傳入陣列裡的
 * turnoverType 既不會被刪除、也不會被當成差異、更不會被重設**——原樣保留。這正是第 4 節第 5 點
 * 描述的第三種語意，description 已明講「省略某筆的實際後果」。
 *
 * 第 4 節的四項操作性要求逐條處理：
 * 1.「先讀現值再合併」——本工具一定先呼叫 GetTurnoverMultiplierSetting 取得現值（用於回報
 *    before/after 與 round-trip 比對）。送出時**只送呼叫端明確指定的 turnoverType**。
 *    這與第 4 節「只覆寫要改的欄位、其餘原樣帶回」是同一個目的、不同做法：這支後端對
 *    「沒帶到的 type」本來就原樣保留（不是整包覆蓋），所以少送不會遺失任何東西。
 *    持平說明：全帶四種**也是安全的**——多建出來的那一列值就是 10000，與單數版
 *    getTurnoverMultiplier 惰性初始化建出的列完全相同（wagering_manager.ts:309-313），是 no-op；
 *    而且官方 abu 後台每次存檔本來就是四種全送（TurnoverMultiplierSettingPopup.vue:64-73 用
 *    enum 全成員 push、:28-36 整包送出）。本工具選擇只送指定項的理由是縮小寫入面與 audit 噪音，
 *    不是因為全送有害。
 * 2.「round-trip 逐欄比對未變更欄位」——寫入後一定再讀一次，回傳 before/after/changed，
 *    並且明確列出「未指定的 type 是否仍等於呼叫前的值」（unchangedVerified）。
 * 3.「明確告知這次是新增還是更新」——**只能部分做到，回傳如實區分**：
 *    GetTurnoverMultiplierSetting 會替 DB 沒有的 type 補上預設值 10000 再回傳
 *    （wagering_platform.ts:773-778），所以「讀到 10000」無法分辨「DB 有一列且值是 10000」與
 *    「DB 根本沒有列」。但反過來是確定的：**before 不等於 10000 的 type，DB 必定已有列，
 *    這次必定是 UPDATE**。回傳的 writeMode 欄位就是照這個規則給 'update' 或 'unknown'，
 *    不會把可判定的情況也講成不可判定。
 * 4. 本 method 不是 CreateOrUpdateRole 那種 diff 型，無第 4 節第 4 點的誤刪風險。
 *
 * **後端不驗 turnoverType 值域**（同檔 815-822 直接 insert），傳入未知數值會在
 * turnover_multiplier_setting 建出一列永遠不會被消稽核用到的垃圾資料。因此本工具的 zod schema
 * 只收 TurnoverTypeEnum 的四個合法 key，不開放裸數字。
 *
 * **gameBet 的業務保護**：abu 後台把 gameBet 這格鎖成唯讀
 * （abu/platform/src/pages/finance/wagering/TurnoverMultiplierSettingPopup.vue:94-95 硬編
 * `TurnoverTypeEnum.gameBet`），但 agrabah 後端完全沒有第二道防線。既然這是 UI 實際在執行的
 * 業務規則，本工具比照補上一道：要改 gameBet 必須額外明確傳 confirmGameBet=true，
 * 避免呼叫端在不知情的狀況下繞過前端限制。這是本工具自己加的閘門，不是後端行為。
 *
 * **快取：本工具的 round-trip 只證明 DB，不證明「消稽核實際會用到的值」。**
 * 更新既有列時後端會先 removeTurnoverMultiplier 清 redis（wagering_platform.ts:826），
 * 但**新增列的分支沒有清**（同檔 815-822）。這個不對稱會真的出問題，原因是那把 redis key
 * **沒有帶 platformId**：Keys.getTurnoverMultiplierGroupKey()（agrabah/src/common/keys.ts:816-818）
 * 回傳的是裸常數 'tmg'（同檔 215），hash field 只有 turnoverType——對照同檔相鄰的
 * getPlatformUserRoomMuteKey(:808)、getTotpBindTokenKey(:812) 都有帶 platformId，漏帶是異常。
 * 也就是說**這把快取是跨平台共用的**：A 平台的消稽核 job 寫進去的值，B 平台會讀到。
 * 於是「快取有值但本平台 DB 沒有列」不但會發生、而且是多平台部署下的常態，而 INSERT 分支
 * 又不清快取、redis key 也沒有 TTL（WageringCache.setTurnoverMultiplier 只做 groupSet，
 * wagering_manager.ts:56-63）——結果是 DB 寫成功、本工具回報 applied=true，但消稽核 job
 * 仍吃著別的平台留下的舊值，且永不過期。
 * 另一個較窄的破口：UPDATE 分支的 removeTurnoverMultiplier 是**在 transaction 內、commit 之前**
 * 呼叫的（wagering_platform.ts:826），併發的 getTurnoverMultiplier 可能在 commit 前重新讀到舊值
 * 並回填快取。
 * 這兩點都是 agrabah 端的問題、MCP 層無法修，只能如實告知呼叫端：**改完若發現不生效，
 * 先懷疑這個快取，不要以為是本工具沒寫進去。**（已回報給後端 owner。）
 *
 * 第 8 節（敏感資料／PII，橫切分類）評估：輸入與回傳都只有打碼類型與倍率，屬平台設定、
 * 不含任何會員資料或憑證，不觸發該節任何要求。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { TurnoverMultiplierSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { TURNOVER_TYPE_KEYS, TURNOVER_TYPE_MAP, TURNOVER_TYPE_LABELS, TURNOVER_MULTIPLIER_SCALE } from '../const.ts';

type TurnoverRow = { turnoverType: number; turnoverMultiplier: number };

/** 把 GetTurnoverMultiplierSetting 的回傳整理成 type -> multiplier 的 map。 */
function toMultiplierMap(rows: readonly { turnoverType?: number | null; turnoverMultiplier?: number | null }[]): Map<number, number> {
    const map = new Map<number, number>();
    for (const row of rows) map.set(row.turnoverType ?? 0, row.turnoverMultiplier ?? 0);
    return map;
}

export function registerUpdateTurnoverMultiplierSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_update_turnover_multiplier_setting',
        {
            title: 'Update platform turnover multiplier setting',
            description:
                '修改本平台的「打碼倍率設置」——各類交易在消稽核（清打碼量）時各自要乘上多少倍' +
                '（rajah: WageringPlatform.UpdateTurnoverMultiplierSetting，需要權限節點 ' +
                'Finance.Wagering.Setting.TurnoverMultiplierSetting）。' +
                '**這是會影響全平台會員提款條件的設定，不是顯示設定**：消稽核時 ' +
                '`打碼量 = 該筆交易金額 × (turnoverMultiplier / 10000)`' +
                '（agrabah/src/servers/wagering_back_office/job/eliminate_user_wagering.ts:24-25），' +
                '倍率調高＝同樣的下注/送禮能清掉更多稽核＝所有會員更快達成提款門檻。改之前請先確認你真的要改。' +
                '**以下六點務必先看清楚：**' +
                '**(1) 只會動你指定的 turnoverType，沒帶到的原樣保留**——後端是逐筆 upsert' +
                '（agrabah/src/servers/wagering_back_office/services/wagering_platform.ts:800-855）：' +
                '你傳的 type 若 DB 已有列就 UPDATE、沒有就 INSERT；**沒出現在你傳入陣列裡的 type，' +
                '既不會被刪除、也不會被重設成預設值、更不會被當成「你要求刪除」的差異**。' +
                '本工具只把你指定的那幾筆送出去（縮小寫入面與 audit 噪音）。' +
                '持平說明：全帶四種其實也是安全的——多建出來的那一列值就是 10000，' +
                '與後端惰性初始化建出的列完全相同（wagering_manager.ts:309-313），是 no-op；' +
                '官方 abu 後台每次存檔本來就是四種全送。' +
                '**(2) 新增 vs 更新只能部分判定，回傳的 writeMode 會如實區分**——後端的讀取 API ' +
                '（GetTurnoverMultiplierSetting）會替 DB 沒有的 type 補上預設值 10000 再回傳（同檔 773-778），' +
                '所以「讀到 10000」無法分辨「DB 有一列且值剛好是 10000」與「DB 根本沒有這一列」。' +
                '但反過來確定：**呼叫前的值不等於 10000 ⇒ DB 必定已有列 ⇒ 這次必定是 UPDATE**。' +
                'writeMode 因此只會是 "update"（可確定）或 "unknown"（before 剛好是 10000，無法判定），' +
                '不會硬猜成 insert。' +
                '**(3) 倍率是「實際倍數 × 10000」的整數**——10000 = 1 倍、120000 = 12 倍。' +
                '請傳這個原始整數，不要傳 1.2 這種實際倍數；本工具只接受整數，小數會被 zod 擋下。' +
                '**(4) gameBet 在業務上是唯讀的**——abu 後台的打碼倍率設定彈窗把 gameBet 這格鎖成唯讀' +
                '（abu/platform/src/pages/finance/wagering/TurnoverMultiplierSettingPopup.vue:94-95），' +
                '但 agrabah 後端**沒有**第二道防線、改得動。本工具因此自己加了一道閘門：' +
                '要改 gameBet 必須同時傳 confirmGameBet=true，否則直接擋下。這是本工具的保護，不是後端行為。' +
                '**(5) 後端不驗 turnoverType 值域**（同檔 815-822 直接 insert），傳入未知數值會在資料表' +
                '留下永遠用不到的垃圾列。所以本工具只收四個合法 key，不接受裸數字。' +
                '**(6) 數值本身才是最容易出事的地方，本工具加了兩道閘門**——' +
                '倍率上界限制在 i32 上界 2147483647（rajah 是 i32，DB 欄位是 INT UNSIGNED，' +
                'agrabah/migrations/wagering/202602021944_alter_turnover_multiplier_setting.sql:4；' +
                '超過會在 protobuf int32 編碼時被靜默折成負數）；另外 **turnoverMultiplier=0 ' +
                '（該類交易永遠清不掉打碼量、會員永遠提不了款）、以及相對現值變動達 10 倍以上' +
                '（通常是少打或多打一個零）都需要額外傳 confirmDrasticChange=true**。' +
                '本工具會在寫入前先讀一次現值、寫入後再讀一次，回傳 before / after / changed / writeMode，' +
                '並逐一比對「你沒指定的 type 是否仍等於呼叫前的值」（unchangedVerified）。' +
                '此操作會送出 audit 寫入（同檔 851，但那是 fire-and-forget 的 `audit(...).then()`、未 await、在 transaction 之外，且只記請求值不記 before/after，所以不保證一定落地）。要只讀不改請用 ' +
                'aladdin_platform_wagering_platform_get_turnover_multiplier_setting。' +
                '**這是寫入型 tool**：在 prod 實例上必須先用 AskUserQuestion（或功能相同的方式）明確詢問' +
                '使用者是否要在正式環境執行，取得明確同意後才可帶上 confirm 參數；絕不能自行假設使用者同意。' +
                '非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**注意本工具的 round-trip 只證明 DB 的值，不證明消稽核 job 實際會用到的值**——' +
                'agrabah 的打碼倍率 redis 快取 key 沒有帶 platformId（keys.ts:816-818 回傳裸常數 tmg）、' +
                '是跨平台共用且無 TTL，而新增列的分支不清快取。改完若發現不生效，先懷疑這個快取。',
            inputSchema: {
                multipliers: z.array(z.object({
                    turnoverType: z.enum(TURNOVER_TYPE_KEYS).describe(
                        '打碼類型：gameBet=遊戲下注（業務上唯讀，需 confirmGameBet）／roomGift=直播間送禮／' +
                        'messageBoardGift=大舞台打賞／agentProxyDeposit=代理代存',
                    ),
                    turnoverMultiplier: z.number().int().min(0).max(2147483647).describe(
                        '倍率原始值＝實際倍數 × 10000（10000 = 1 倍、120000 = 12 倍）。只收整數；' +
                        '上界是 i32 上界 2147483647（超過會被 protobuf int32 編碼靜默折成負數）。' +
                        '傳 0 代表該類交易永遠清不掉打碼量，需要 confirmDrasticChange=true',
                    ),
                })).min(1).describe(
                    '要修改的打碼倍率清單。只傳你真的要改的即可——沒帶到的 turnoverType 會原樣保留、不會被重設',
                ),
                confirmGameBet: z.boolean().optional().describe(
                    '要修改 gameBet 時必須明確傳 true。abu 後台把 gameBet 鎖成唯讀、但後端沒擋，' +
                    '這個旗標是本工具替它補的閘門，避免無意間繞過前端的業務規則',
                ),
                confirmDrasticChange: z.boolean().optional().describe(
                    '要把倍率設成 0，或相對目前值變動達 10 倍以上（少打/多打一個零的典型症狀）時，' +
                    '必須明確傳 true。這是本工具替「數量級打錯」加的閘門，不是後端行為',
                ),
                confirm: z.string().optional().describe(
                    `在 prod 實例上執行寫入時必填，值必須是 "${ PROD_CONFIRM_TOKEN }"。` +
                    '必須先向使用者明確詢問並取得同意後才可帶上，絕不能自行假設。非 prod 環境會忽略此欄位',
                ),
            },
        },
        async ({ multipliers, confirmGameBet, confirmDrasticChange, confirm }) => {
            // prod 閘門必須在任何 remote.* / withAutoRelogin 之前呼叫（session.ts:95-110）。
            assertProdConfirmed(confirm);
            const wp = () => remote.wageringBackOffice.wageringPlatform;

            // 重複 turnoverType 會讓「這次到底設成多少」變得不確定（後端逐筆處理、後者覆蓋前者），直接擋下。
            const seen = new Set<string>();
            for (const m of multipliers) {
                if (seen.has(m.turnoverType)) {
                    return asTextResult({
                        success: false,
                        message: `multipliers 裡有重複的 turnoverType「${ m.turnoverType }」。` +
                            '後端會逐筆處理、後面那筆覆蓋前面那筆，結果不明確，請合併成一筆再呼叫。',
                    });
                }
                seen.add(m.turnoverType);
            }

            if (seen.has('gameBet') && confirmGameBet !== true) {
                return asTextResult({
                    success: false,
                    message: 'gameBet 在 abu 後台是唯讀欄位（TurnoverMultiplierSettingPopup.vue:94-95 硬編鎖定），' +
                        'agrabah 後端沒有對應的防線、其實改得動。本工具因此要求明確意圖：' +
                        '確定要改 gameBet 請同時傳 confirmGameBet=true；若不是要改它，請把它從 multipliers 移除。',
                });
            }

            // 第 4 節要求：寫入前先讀現值（用於 before/after 回報與未指定 type 的原樣保留驗證）。
            const beforeRes = await withAutoRelogin(() => wp().GetTurnoverMultiplierSetting());
            if (beforeRes.failed) return asErrorResult(beforeRes, { stage: '寫入前讀取現值失敗，未進行任何寫入' });
            const beforeMap = toMultiplierMap(beforeRes.data?.rows ?? []);

            // 只送呼叫端明確指定的 type（理由見檔頭第 1 點）。
            const payload: TurnoverRow[] = multipliers.map((m) => ({
                turnoverType: TURNOVER_TYPE_MAP[ m.turnoverType ],
                turnoverMultiplier: m.turnoverMultiplier,
            }));

            // 數量級閘門：0（該類交易永遠清不掉打碼量）與「相對現值差 10 倍以上」都要求明確意圖。
            // 這是本工具自己加的，後端不會擋。
            if (confirmDrasticChange !== true) {
                const drastic: string[] = [];
                for (const row of payload) {
                    const before = beforeMap.get(row.turnoverType);
                    const label = TURNOVER_TYPE_LABELS[ row.turnoverType ] ?? String(row.turnoverType);
                    if (row.turnoverMultiplier === 0) {
                        drastic.push(`${ label }：要設成 0，代表該類交易永遠清不掉打碼量、會員永遠提不了款`);
                        continue;
                    }
                    if (before !== undefined && before > 0) {
                        const ratio = row.turnoverMultiplier / before;
                        if (ratio >= 10 || ratio <= 0.1) {
                            drastic.push(`${ label }：${ before } → ${ row.turnoverMultiplier }，相差約 ${ ratio >= 10 ? ratio.toFixed(1) + ' 倍' : '1/' + (1 / ratio).toFixed(1) }（常見於少打或多打一個零）`);
                        }
                    }
                }
                if (drastic.length > 0) {
                    return asTextResult({
                        success: false,
                        message: '偵測到數量級可能打錯的變更，已在送出前擋下（尚未寫入任何東西）。' +
                            '確認無誤請加上 confirmDrasticChange=true 重新呼叫；' +
                            '記得倍率是「實際倍數 × 10000」，1 倍要傳 10000 不是 1。',
                        blocked: drastic,
                        currentValues: [ ...beforeMap.entries() ].map(([ t, v ]) => ({
                            turnoverType: t,
                            turnoverTypeLabel: TURNOVER_TYPE_LABELS[ t ] ?? String(t),
                            turnoverMultiplier: v,
                        })),
                    });
                }
            }

            const writeRes = await withAutoRelogin(() => wp().UpdateTurnoverMultiplierSetting(
                payload.map((row) => TurnoverMultiplierSetting.create(row)),
            ));
            if (writeRes.failed) return asErrorResult(writeRes, { stage: '寫入失敗，請用 aladdin_platform_wagering_platform_get_turnover_multiplier_setting 覆核目前實際值' });

            // 第 4 節要求：round-trip 讀回逐欄比對。
            const afterRes = await withAutoRelogin(() => wp().GetTurnoverMultiplierSetting());
            if (afterRes.failed) {
                // 寫入 RPC 沒報錯，但讀不回來 ⇒ 無法驗證。success 在本工具一律代表「已驗證」，
                // 這裡不能回 true（否則同一個欄位會有兩種強度不同的語意）。
                return asTextResult({
                    success: false,
                    verified: false,
                    writeRpcReportedSuccess: true,
                    message: '寫入 RPC 回報成功，但讀回驗證失敗，**無法確認這次改動是否生效**。' +
                        '這不代表寫入失敗，也不代表成功——請自行用 ' +
                        'aladdin_platform_wagering_platform_get_turnover_multiplier_setting 覆核目前實際值。',
                    readBackError: { errorCode: afterRes.errorCode, message: afterRes.message },
                });
            }
            const afterMap = toMultiplierMap(afterRes.data?.rows ?? []);

            const requestedTypes = new Set(payload.map((p) => p.turnoverType));
            const describe = (type: number) => TURNOVER_TYPE_LABELS[ type ] ?? String(type);

            const changed = payload.map((p) => ({
                turnoverType: p.turnoverType,
                turnoverTypeLabel: describe(p.turnoverType),
                before: beforeMap.get(p.turnoverType) ?? null,
                requested: p.turnoverMultiplier,
                after: afterMap.get(p.turnoverType) ?? null,
                applied: afterMap.get(p.turnoverType) === p.turnoverMultiplier,
                // before 不等於預設值 10000 ⇒ DB 必定已有列 ⇒ 必定是 UPDATE；等於 10000 則無法判定。
                // 讀不到 before（理論上不會發生，後端固定回全部 4 種）時不能推成 update，一律 unknown。
                writeMode: beforeMap.get(p.turnoverType) === undefined
                    ? 'unknown'
                    : (beforeMap.get(p.turnoverType) !== TURNOVER_MULTIPLIER_SCALE ? 'update' : 'unknown'),
                effectiveMultiplierAfter: (afterMap.get(p.turnoverType) ?? 0) / TURNOVER_MULTIPLIER_SCALE,
            }));

            const untouched = [ ...beforeMap.keys() ].filter((t) => !requestedTypes.has(t)).map((t) => ({
                turnoverType: t,
                turnoverTypeLabel: describe(t),
                before: beforeMap.get(t) ?? null,
                after: afterMap.get(t) ?? null,
                unchanged: beforeMap.get(t) === afterMap.get(t),
            }));

            const allApplied = changed.every((c) => c.applied);
            const allUntouchedUnchanged = untouched.every((u) => u.unchanged);

            return asTextResult({
                success: allApplied && allUntouchedUnchanged,
                changed,
                unchangedVerified: {
                    ok: allUntouchedUnchanged,
                    rows: untouched,
                },
                notes: {
                    successMeaning: '本工具的 success=true 代表「寫入成功**且** round-trip 已驗證」，'
                        + '比本 server 其他寫入 tool 的 success（只代表寫入 RPC 沒報錯）嚴格。'
                        + '所以 success=false 不必然代表沒寫進去——請看 verified / writeRpcReportedSuccess 判斷',
                    applied: allApplied
                        ? '所有指定的 turnoverType 讀回值都等於你要求的值'
                        : '**有指定的 turnoverType 讀回值與要求不符**，請檢查 changed 裡 applied=false 的項目',
                    untouched: allUntouchedUnchanged
                        ? '未指定的 turnoverType 讀回值都與呼叫前相同（符合後端「省略即保留」的語意）'
                        : '**未指定的 turnoverType 有值被動到**，這不符合預期，請立即人工覆核',
                    writeMode: 'update = 呼叫前的值不是預設值 10000，DB 必定已有列，這次確定是更新；'
                        + 'unknown = 呼叫前剛好是 10000，讀取 API 會替 DB 沒有的 type 補這個值，'
                        + '所以無法分辨是「更新既有列」還是「新增一列」，本工具不硬猜',
                    cache: '本工具的 round-trip 只證明 DB 的值。agrabah 的打碼倍率 redis 快取 key 沒帶 platformId '
                        + '（keys.ts:816-818）、跨平台共用且無 TTL，新增列的分支又不清快取——'
                        + '若改完發現消稽核行為沒跟著變，先懷疑這個快取，不是本工具沒寫進去',
                    unit: `倍率是實際倍數 × ${ TURNOVER_MULTIPLIER_SCALE }；effectiveMultiplierAfter 是換算後的實際倍數，僅供閱讀`,
                    audit: '後端已送出 audit 寫入，但那是 fire-and-forget（未 await、在 transaction 之外，'
                        + 'wagering_platform.ts:851），且只記請求值不記 before/after，不保證一定落地',
                },
            });
        },
    );
}
