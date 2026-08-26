/**
 * tools/create_or_update_activity_ranking_setting.ts —
 * aladdin_platform_ranking_platform_create_or_update_activity_ranking_setting
 *
 * rajah: RankingPlatform.CreateOrUpdateActivityRankingSetting(@Validate setting ActivityRankingSetting 1)
 * （ranking_back_office.rajah:102，需要 @Permission "BonusCenter.AcRanking"）——新增或編輯一筆
 * 活動排行榜設定（後台「優惠中心 > 活動排行榜」的新增/編輯彈窗）。`setting.id`：0/省略＝新增，
 * 帶既有 id＝編輯。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（agrabah/src/servers/ranking_back_office/services/
 * ranking_platform.ts:80-201，methodCreateOrUpdateActivityRankingSetting，真的寫 DB，非
 * placeholder）並 dev 實測（pk-platform.alddev.com，帳號 landon001，建立 id=1021 測試資料、
 * 更新、觀察欄位、最後停用清理，過程詳見下方）：
 *
 * - **新增時**：5 個時間欄位（stopRankingTimestamp/startTimestamp/endTimestamp/
 *   exhibitStartTimestamp/exhibitEndTimestamp）皆為必填且不可為過去時間，任一落在過去會被拒絕
 *   （dev 實測 errorCode=4101 rankingActivitySettingTimestampInPast）。status 由後端強制設為
 *   enabled，呼叫端傳什麼都無效。
 * - **編輯時（id>0）**：後端會先用 id+platformId 讀現有列（讀不到回 errorCode=12，
 *   dev 實測確認），成功後**無條件忽略呼叫端傳入的 status / rankingAtTimestamp / 5 個時間欄位**，
 *   一律沿用資料庫既有值——即使呼叫端刻意傳不同值也不會生效。本工具因此在編輯模式下固定重用
 *   讀現值取得的這些欄位，不讓呼叫端誤以為改了時間就真的改了。
 * - **⚠️ periodReset 是一個已驗證的後端行為缺口**：rajah 定義標了 `@NoEdit` 且註解寫「建立後
 *   不可修改」，但實測發現 `methodCreateOrUpdateActivityRankingSetting` 的更新路徑**沒有**把
 *   periodReset 復原成現有值（不像 status/時間欄位那樣被保護）——2026-08-26 dev 實測對已建立
 *   的活動（periodReset=none）呼叫更新並帶 periodReset=daily，**真的改成功了**。這不是本工具
 *   刻意開放的功能，是後端既有的保護缺口；本工具預設在編輯模式下沿用現有 periodReset（除非呼叫端
 *   明確要求變更），並在說明中如實揭露這個缺口，避免呼叫端誤以為「反正改不了就隨便傳」。
 * - name/description/rule（多語）、minimumAmount（CurrencyLink[]）、rankingTarget+targetIds、
 *   maxRanking、rankingType、refreshInterval、showUserBoolean 在編輯時**整包覆蓋，沒有 partial
 *   merge**——本工具依 method-category-checklist.md 第 4 節規則，編輯前一律先讀現值
 *   （ListActivityRankingSetting 找對應 id），只覆蓋呼叫端明確帶到的欄位，其餘原樣帶回。
 * - **新增後端不回傳 id**（rajah 簽名沒有回傳值）：本工具靠寫入前後 ListActivityRankingSetting
 *   的 id 集合差異反推新建 id（同 create_or_update_activity_tab.ts 的既有做法）。
 * - **這組 service 沒有 Delete method**：測試資料只能用 ChangeActivityRankingSettingStatus 設為
 *   disabled，無法真正刪除；2026-08-26 dev 實測留下的 id=1021 測試列已設回 disabled。
 * - i64 欄位（各 timestamp、minimumAmount[].value）實測回傳十進位字串，本工具用 const.ts 的
 *   toPlainNumber/toPlainCurrencyLinks 轉成一般數字。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ActivityRankingSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    RANKING_TYPE_MAP, RANKING_TYPE_KEYS,
    RANKING_TARGET_MAP, RANKING_TARGET_KEYS,
    ACTIVITY_RANKING_PERIOD_RESET_MAP, ACTIVITY_RANKING_PERIOD_RESET_KEYS,
    toPlainNumber, toPlainCurrencyLinks,
} from '../const.ts';

const localizationSchema = z.array(z.object({ code: z.string(), value: z.string() }));
const currencyLinkSchema = z.array(z.object({ code: z.string(), value: z.number() }));

async function findById(id: number) {
    const r = await withAutoRelogin(() => remote.rankingBackOffice.rankingPlatform.ListActivityRankingSetting(1, 200));
    const row = r.data?.rows?.find((existing) => existing.id === id);
    return { failed: r.failed, errorCode: r.errorCode, message: r.message, row };
}

export function registerCreateOrUpdateActivityRankingSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ranking_platform_create_or_update_activity_ranking_setting',
        {
            title: 'Create or update an activity ranking setting',
            description:
                '新增或編輯本平台一筆活動排行榜設定（rajah: RankingPlatform.CreateOrUpdateActivityRankingSetting，' +
                '需要權限節點 BonusCenter.AcRanking）。省略 id 或帶 0 ＝新增（此時 name/description/maxRanking/' +
                'rankingType/minimumAmount/rankingTarget/refreshInterval/showUserBoolean/5 個時間欄位皆為必填）；' +
                '帶既有 id ＝編輯（本工具已先讀現值，只覆蓋你有帶到的欄位，其餘沿用現值）。' +
                '5 個時間欄位（stopRankingTimestamp/startTimestamp/endTimestamp/exhibitStartTimestamp/' +
                'exhibitEndTimestamp，皆為毫秒 timestamp）只在**新增**時生效且不可為過去時間；**編輯時無論傳什麼' +
                '都會被後端忽略**，一律沿用建立時的原值，無法事後修改活動時間區間。' +
                '⚠️ periodReset（none/daily/weekly）rajah 宣告不可編輯，但 2026-08-26 dev 實測發現後端實際上** ' +
                '沒有保護這個欄位**，編輯時真的可以改成功——這是後端既有缺口非設計功能。本工具編輯模式預設沿用現有' +
                'periodReset，只有明確帶這個參數才會嘗試變更，請勿依賴此路徑常態使用。' +
                'rankingTarget=all 時 targetIds 不需要填（後端會忽略）。' +
                '**這組 service 沒有刪除方法**，要下架用 ' +
                'aladdin_platform_ranking_platform_change_activity_ranking_setting_status 設為 disabled。' +
                '**2026-08-26 dev 實測**涵蓋：過去時間新增被拒絕（errorCode=4101）、不存在 id 編輯被拒絕' +
                '（errorCode=12）、真實新增+部分欄位編輯+讀回驗證+periodReset 缺口驗證，測試資料已設回 disabled。',
            inputSchema: {
                id: z.number().int().optional().describe('活動排行榜設定 id；省略或 0 ＝新增，既有 id ＝編輯'),
                name: localizationSchema.optional().describe('多語名稱陣列 {code, value}；新增必填，編輯不帶則沿用現值'),
                description: localizationSchema.optional().describe('多語內容陣列；新增必填，編輯不帶則沿用現值'),
                maxRanking: z.number().int().min(1).max(300).optional().describe('最大展示名次（1-300）；新增必填，編輯不帶則沿用現值'),
                rankingType: z.enum(RANKING_TYPE_KEYS).optional().describe('排行依據：winLose 營利金額(Win-Bet) / validBet 有效投注；新增必填'),
                minimumAmount: currencyLinkSchema.optional().describe('依據門檻，CurrencyLink 陣列 {code, value}；新增必填'),
                rankingTarget: z.enum(RANKING_TARGET_KEYS).optional().describe('依據指向：gameBrand 遊戲品牌 / game 單一遊戲 / all 全部；新增必填'),
                targetIds: z.array(z.number().int()).optional().describe('依據指向的目標 id 清單；rankingTarget=all 時不需要填'),
                refreshInterval: z.number().int().min(1).optional().describe('刷新時間（分）；新增必填'),
                showUserBoolean: z.boolean().optional().describe('是否展示自身排名；新增必填（預設視為 false）'),
                rule: localizationSchema.optional().describe('規則說明（多語富文字）；不帶則沿用現值（新增預設空陣列）'),
                periodReset: z.enum(ACTIVITY_RANKING_PERIOD_RESET_KEYS).optional().describe(
                    '週期重置：none 未啟用 / daily 每日 / weekly 每週一；新增必填。' +
                    '⚠️ 編輯時原則上不應變更（rajah @NoEdit），只有明確帶這個參數才會嘗試變更，且已知後端目前未真正保護此欄位。',
                ),
                stopRankingTimestamp: z.number().int().optional().describe('結算時間（毫秒 timestamp）；僅新增時生效，不可為過去時間'),
                startTimestamp: z.number().int().optional().describe('週期開始時間（毫秒 timestamp）；僅新增時生效，不可為過去時間'),
                endTimestamp: z.number().int().optional().describe('週期結束時間（毫秒 timestamp）；僅新增時生效，不可為過去時間'),
                exhibitStartTimestamp: z.number().int().optional().describe('展示開始時間（毫秒 timestamp）；僅新增時生效，不可為過去時間'),
                exhibitEndTimestamp: z.number().int().optional().describe('展示結束時間（毫秒 timestamp）；僅新增時生效，不可為過去時間'),
            },
        },
        async (input) => {
            const isCreate = !input.id;

// eslint-disable-next-line @typescript-eslint/no-explicit-any
            let base: any = {
                id: 0, name: [], description: [], maxRanking: 0, rankingType: 0, minimumAmount: [],
                rankingTarget: 0, targetIds: [], refreshInterval: 0, periodReset: 0,
                stopRankingTimestamp: 0, startTimestamp: 0, endTimestamp: 0,
                exhibitStartTimestamp: 0, exhibitEndTimestamp: 0, showUserBoolean: false, rule: [],
            };

            if (!isCreate) {
                const found = await findById(input.id!);
                if (found.failed) return asErrorResult(found);
                if (!found.row) {
                    return asTextResult({ success: false, message: `找不到 id=${ input.id } 的活動排行榜設定` });
                }
                base = found.row;
            } else {
                const requiredForCreate = [
                    [ 'name', input.name ], [ 'description', input.description ], [ 'maxRanking', input.maxRanking ],
                    [ 'rankingType', input.rankingType ], [ 'minimumAmount', input.minimumAmount ],
                    [ 'rankingTarget', input.rankingTarget ], [ 'refreshInterval', input.refreshInterval ],
                    [ 'periodReset', input.periodReset ], [ 'stopRankingTimestamp', input.stopRankingTimestamp ],
                    [ 'startTimestamp', input.startTimestamp ], [ 'endTimestamp', input.endTimestamp ],
                    [ 'exhibitStartTimestamp', input.exhibitStartTimestamp ], [ 'exhibitEndTimestamp', input.exhibitEndTimestamp ],
                ] as const;
                const missing = requiredForCreate.filter(([ , value ]) => value === undefined).map(([ key ]) => key);
                if (missing.length > 0) {
                    return asTextResult({ success: false, message: `新增活動排行榜設定缺少必填欄位：${ missing.join(', ') }` });
                }
            }

            const setting = ActivityRankingSetting.create({
                id: input.id ?? 0,
                name: input.name ?? base.name,
                description: input.description ?? base.description,
                maxRanking: input.maxRanking ?? base.maxRanking,
                rankingType: input.rankingType !== undefined ? RANKING_TYPE_MAP[ input.rankingType ] : base.rankingType,
                minimumAmount: input.minimumAmount ?? base.minimumAmount,
                rankingTarget: input.rankingTarget !== undefined ? RANKING_TARGET_MAP[ input.rankingTarget ] : base.rankingTarget,
                targetIds: input.targetIds ?? base.targetIds,
                refreshInterval: input.refreshInterval ?? base.refreshInterval,
                periodReset: input.periodReset !== undefined ? ACTIVITY_RANKING_PERIOD_RESET_MAP[ input.periodReset ] : base.periodReset,
                // 編輯時這 5 個時間欄位後端一律忽略、沿用既有值；新增時才會真的生效。
                stopRankingTimestamp: isCreate ? input.stopRankingTimestamp : base.stopRankingTimestamp,
                startTimestamp: isCreate ? input.startTimestamp : base.startTimestamp,
                endTimestamp: isCreate ? input.endTimestamp : base.endTimestamp,
                exhibitStartTimestamp: isCreate ? input.exhibitStartTimestamp : base.exhibitStartTimestamp,
                exhibitEndTimestamp: isCreate ? input.exhibitEndTimestamp : base.exhibitEndTimestamp,
                showUserBoolean: input.showUserBoolean ?? base.showUserBoolean ?? false,
                rule: input.rule ?? base.rule ?? [],
            });

            const idsBefore = isCreate
                ? new Set((await withAutoRelogin(() => remote.rankingBackOffice.rankingPlatform.ListActivityRankingSetting(1, 200))).data?.rows?.map((row) => row.id) ?? [])
                : null;

            const r = await withAutoRelogin(() => remote.rankingBackOffice.rankingPlatform.CreateOrUpdateActivityRankingSetting(setting));
            if (r.failed) return asErrorResult(r);

            let resultId = input.id ?? 0;
            if (isCreate) {
                const after = await withAutoRelogin(() => remote.rankingBackOffice.rankingPlatform.ListActivityRankingSetting(1, 200));
                const newRow = !after.failed ? after.data?.rows?.find((row) => !idsBefore!.has(row.id)) : undefined;
                resultId = newRow?.id ?? 0;
                return asTextResult({
                    success: true,
                    message: resultId > 0 ? '新增成功' : '新增成功，但無法從清單差異反推出新 id，請人工用清單工具核對',
                    id: resultId,
                    readBack: newRow ? { ...newRow, minimumAmount: toPlainCurrencyLinks(newRow.minimumAmount), stopRankingTimestamp: toPlainNumber(newRow.stopRankingTimestamp), startTimestamp: toPlainNumber(newRow.startTimestamp), endTimestamp: toPlainNumber(newRow.endTimestamp), exhibitStartTimestamp: toPlainNumber(newRow.exhibitStartTimestamp), exhibitEndTimestamp: toPlainNumber(newRow.exhibitEndTimestamp) } : null,
                });
            }

            const found = await findById(resultId);
            const readBack = found.row
                ? { ...found.row, minimumAmount: toPlainCurrencyLinks(found.row.minimumAmount), stopRankingTimestamp: toPlainNumber(found.row.stopRankingTimestamp), startTimestamp: toPlainNumber(found.row.startTimestamp), endTimestamp: toPlainNumber(found.row.endTimestamp), exhibitStartTimestamp: toPlainNumber(found.row.exhibitStartTimestamp), exhibitEndTimestamp: toPlainNumber(found.row.exhibitEndTimestamp) }
                : null;
            return asTextResult({ success: true, message: '更新成功', id: resultId, readBack });
        },
    );
}
