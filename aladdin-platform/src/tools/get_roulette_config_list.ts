/**
 * tools/get_roulette_config_list.ts — aladdin_platform_roulette_platform_get_roulette_config_list
 *
 * rajah: RoulettePlatform.GetRouletteConfigList(page i32 1, pageSize i32 2, option GetRouletteConfigOption 3)
 * (rows [RouletteConfig] 1, totalPage i32 2)
 * （rajah/services/roulette_back_office.rajah:319，@Permission "BonusCenter.Lottery.LotteryConfig"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:43-108，
 * methodGetRouletteConfigList）確認有真實 override、真的查 DB，非 base class 的 notImplemented。
 *
 * 分類：第 2 節「讀取清單」。option 沒有 id 欄位（不是 A 級），但**也不必套 B 級的「逐頁掃描到底」
 * 要求**——同 service 已經有用業務鍵直接查的 sibling：`GetConfigNameList`（一次列出本平台全部
 * config 的 id+多語名稱，不分頁）與 `GetRouletteConfigById(id)`。依 checklist 第 2 節 B 級與第 5 節
 * 「若有 sibling 直接查詢介面，禁止自己重新發明 List 全部 + 逐頁比對」的規定，本工具維持單純的
 * 分頁清單，定位單筆請改用上面兩支 tool，本工具內部不做任何跨頁掃描。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證（roulette_platform.ts:43-108）：
 * - `option.name` 是**多語名稱模糊搜尋**，實作先去 `id_localizations` 撈 `value LIKE %name%
 *   AND platform_id = ? AND service_id = rouletteConfigName AND code = ?`，這裡的 `code` 就是
 *   `option.code`。因此 **name 一定要搭配 code（語言代碼，如 zh-CN）**，只給 name 不給 code 會用
 *   `code = ''` 去查，撈不到任何 target_id，後端接著硬塞 `RC.id in (0)` → 回空清單（不報錯）。
 *   本工具在 handler 進入點用命令式檢查擋下這個組合（不是 zod schema 層——inputSchema 傳的是
 *   ZodRawShape，結構上掛不了 superRefine；初版註解誤寫成 superRefine，2026-08-28 review 指出後更正），
 *   不讓 agent 拿到「無聲空清單」的誤導結果。
 * - `option.rewardName` 是獎勵設定名稱（roulette_rewards.name，單一語系純字串）的 LIKE 模糊搜尋，
 *   跟 name 是兩個不同的東西（一個是 config 的多語名稱、一個是它關聯的 reward 名稱）。
 * - `option.statuses` 宣告型別是 [ActiveStatusEnum]（enabled=1/disabled=2），但實作直接
 *   `RC.status IN (?)` 打在 roulette_configs.status（StatusEnum）欄位上，兩個 enum 的 1/2 值相同，
 *   所以語意可對上；空陣列 = 不篩選。
 * - 回傳只有 `totalPage`，**沒有 totalRow**（跟同 domain 的 GetRouletteRecordList 不同），
 *   呼叫端無法從回傳得知總筆數。
 * - **totalPage 只有 page=1 時才是真值**：共用 helper `getPageData`
 *   （agrabah/src/common/database_helper.ts:204-230）只在 `page === 1` 時才跑 count query，
 *   其他頁一律回 `totalPage = 0`。2026-08-28 dev 實測復現（pageSize=3 時 page=1 回 totalPage=7、
 *   page=7 回 totalPage=0 但 rows 有 1 筆）。本工具據此在非第一頁回傳 `totalPage: null` +
 *   說明欄位，不把後端那個 0 原樣吐給呼叫端（會被誤讀成「沒有任何資料」）；翻頁終止條件改用
 *   checklist 第 2 節建議的 `rows.length < pageSize`。
 * - `pageSize` 是裸 i32（不是 PageSizeEnum），後端只有 `pageSize === 0 ? DefaultPageSize(100) :
 *   pageSize` 這一行，**沒有上界 clamp**。依 checklist 第 2 節「裸 i32 不要賭一次塞極大 pageSize
 *   取代翻頁」的規定，本工具把 pageSize 上限收在 200（該 codebase PageSizeEnum 的伺服器端上限），
 *   不開放任意大值。
 * - `name`（多語）與 `currencyAmount`（[CurrencyLink]，value 是 i64）在後端逐筆補齊；
 *   currencyAmount **只有 costType=currency 的列才會被填**，costType=item 的列固定是空陣列。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - 不帶篩選 pageSize=3：page=1 回 totalPage=7（測試當下本平台共 19 筆設定，id 為 8~22 與 1025~1031；
 *   同 session 稍後 create_or_update_roulette_config 的新增分支驗收又多了一筆 id=1036，之後重跑數字會差 1）。
 * - **覆蓋 checklist 第 2 節「目標不在第一頁」的驗收要求**：page=7 仍回傳 1 筆真實資料（id=8
 *   「抽獎設定」），但 totalPage 回 0——這就是上面那條 getPageData 只在第一頁跑 count 的實證，
 *   本工具據此改成非第一頁回 totalPage=null。page=2 亦覆核過（3 筆、totalPage=null）。
 * - name="紅包"+code="zh-CN" 命中 7 筆；只給 name 不給 code 被本工具擋下（回可行動的說明，
 *   而不是讓後端無聲回空清單）。
 * - rewardName="抽紅包" 命中 2 筆；statuses=["disabled"] 命中 3 筆且每列 status 皆為 disabled。
 * - pageSize=200 一次取回全部 19 筆，逐列檢查確認 **costType=item 的 4 列（id 1029/15/14/13）
 *   currencyAmount 皆為空陣列**，與後端只在 costType=currency 分支才查 CurrencyLinkManager 的實作一致。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetRouletteConfigOption } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ACTIVE_STATUS_MAP, ROULETTE_COST_TYPE_MAP, ROULETTE_RESET_TYPE_MAP, STATUS_MAP,
    numberToMapKey, toPlainCurrencyLinks,
} from '../const.ts';

const ACTIVE_STATUS_KEYS = Object.keys(ACTIVE_STATUS_MAP) as [ keyof typeof ACTIVE_STATUS_MAP, ...(keyof typeof ACTIVE_STATUS_MAP)[] ];

export function registerGetRouletteConfigListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_get_roulette_config_list',
        {
            title: "List the current platform's roulette (lottery) configs",
            description:
                '分頁查詢本平台的轉盤設定列表（rajah: RoulettePlatform.GetRouletteConfigList，需要權限節點 ' +
                'BonusCenter.Lottery.LotteryConfig；後台「優惠中心／抽獎機制／抽獎設定」列表頁）。' +
                '**要定位單一設定不要用這支**：本 method 的篩選條件都是模糊搜尋、沒有 id 欄位，' +
                '請改用 aladdin_platform_roulette_platform_get_config_name_list（列出全部 id+名稱）' +
                '再用 aladdin_platform_roulette_platform_get_roulette_config_by_id 取單筆完整內容。' +
                '**name 必須搭配 code**（後端拿 code 去 id_localizations 比對語言，只給 name 會無聲回空清單），' +
                '本工具會在參數層擋下只給 name 的呼叫。rewardName 是「關聯的獎勵設定名稱」的模糊搜尋，' +
                '跟 name（設定本身的多語名稱）不是同一個欄位。' +
                '回傳**只有 totalPage、沒有 totalRow**，無法得知總筆數；而且 **totalPage 只有 page=1 時是真值**' +
                '（後端共用分頁 helper 只在第一頁跑 count），非第一頁本工具回傳 totalPage=null，' +
                '請改用「rows 筆數 < pageSize 即最後一頁」判斷終點。' +
                'currencyAmount（每抽消費金額）只在 costType=currency 的列才有值，且是 CurrencyLink[] ' +
                '多幣別陣列、value 為 stored 值（非人類可讀金額，依幣別精度換算，常見 ÷10000），本工具不換算。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(200).optional()
                    .describe('每頁筆數，1~200，省略時送 0 由後端套用預設值 100。上限 200 是本工具加的保護（後端對這個裸 i32 參數沒有上界檢查）'),
                name: z.string().optional().describe('轉盤設定名稱模糊搜尋（多語名稱）。**必須同時提供 code**，否則後端一定回空清單'),
                code: z.string().optional().describe('language code（如 zh-CN / en-US），name 模糊搜尋時要比對哪個語系的翻譯值；不搭配 name 時無作用'),
                rewardName: z.string().optional().describe('關聯的獎勵設定名稱模糊搜尋（單一語系純字串，非多語）'),
                statuses: z.array(z.enum(ACTIVE_STATUS_KEYS)).optional()
                    .describe('狀態篩選：enabled(啟用)/disabled(停用)，可多選；省略或空陣列 = 不篩選'),
            },
        },
        async (input) => {
            if (input.name && !input.code) {
                return asTextResult({
                    success: false,
                    message: '帶了 name 就必須同時帶 code（語言代碼，如 zh-CN）：後端用 code 去 id_localizations 比對語系，'
                        + 'code 為空時查不到任何 target_id，會無聲回傳空清單而不是報錯。'
                        + '可先呼叫 aladdin_platform_roulette_platform_get_config_name_list 看現有設定的 showName 用哪些語言代碼。',
                });
            }

            const option = GetRouletteConfigOption.create({
                name: input.name ?? '',
                code: input.code ?? '',
                rewardName: input.rewardName ?? '',
                statuses: (input.statuses ?? []).map((s) => ACTIVE_STATUS_MAP[ s ]),
            });

            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteConfigList(
                input.page ?? 1,
                input.pageSize ?? 0,
                option,
            ));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                status: numberToMapKey(STATUS_MAP, row.status ?? 0),
                costType: numberToMapKey(ROULETTE_COST_TYPE_MAP, row.costType ?? 0),
                resetType: numberToMapKey(ROULETTE_RESET_TYPE_MAP, row.resetType ?? 0),
                currencyAmount: toPlainCurrencyLinks(row.currencyAmount),
            }));

            const page = input.page ?? 1;
            return asTextResult({
                success: true,
                page,
                // 後端只在 page=1 跑 count，其他頁固定回 0；直接透傳那個 0 會被誤讀成「查無資料」。
                totalPage: page === 1 ? (r.data?.totalPage ?? 0) : null,
                pagingNote: page === 1
                    ? '本 method 不回傳 totalRow，無法得知總筆數'
                    : '本 method 不回傳 totalRow；且 totalPage 只有 page=1 時才是真值（後端只在第一頁跑 count），故此處為 null。判斷是否最後一頁請用「rows 筆數 < pageSize」',
                rows,
            });
        },
    );
}
