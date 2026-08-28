/**
 * tools/get_roulette_reward_list.ts — aladdin_platform_roulette_platform_get_roulette_reward_list
 *
 * rajah: RoulettePlatform.GetRouletteRewardList(page i32 1, pageSize i32 2, option GetRouletteRewardOption 3)
 * (rows [RouletteReward] 1, totalPage i32 2)
 * （rajah/services/roulette_back_office.rajah:334，@Permission "BonusCenter.Lottery.RewardConfig"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:370-431，
 * methodGetRouletteRewardList）確認有真實 override、真的查 DB，非 notImplemented。
 *
 * 分類：第 2 節「讀取清單」**A 級**——`option.id` 是可鎖定單一目標的欄位
 * （後端 `if (option.id > 0) conditions.push('id = ?')`，roulette_platform.ts:381-384），
 * 不是「只有範圍鍵 + 分頁」的 B 級，因此不需要逐頁掃描到底的機制。
 * A 級要求「zod schema 對照 rajah `model GetRouletteRewardOption` 全部欄位，**包含 @Hide 欄位**」：
 * 該 model 只有 id / name / types 三個欄位且都沒有 @Hide，三個都已列出，無遺漏。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證（roulette_platform.ts:370-431）：
 * - `option.id > 0` 才生效（傳 0 = 不篩選），`option.name` 是 roulette_rewards.name 的 LIKE 模糊搜尋
 *   （單一語系純字串，**不是**多語欄位，所以不像 config 列表那樣需要搭配語言代碼），
 *   `option.types` 是 RouletteTypeEnum 陣列、空陣列 = 不篩選。
 * - 回傳的 `refCount` 是後端逐筆額外 count 出來的：
 *   `count(roulette_configs, 'platform_id = ? AND reward_id = ? AND status = enabled')`
 *   ——**只算「啟用中」的 config**，被停用中的 config 引用不會計入。這個數字就是
 *   CreateOrUpdateRouletteReward 的擋修條件（refCount > 0 → rouletteRewardIdUsed），
 *   所以它在 rajah 標了 @Hide（後台表單不顯示）但對 API 呼叫端非常關鍵，本工具原樣直出。
 * - 回傳只有 `totalPage`，沒有 totalRow；且共用 helper `getPageData`
 *   （agrabah/src/common/database_helper.ts:204-217）只在 `page === 1` 時跑 count，
 *   其他頁一律回 `totalPage = 0`。本工具在非第一頁回傳 `totalPage: null` 而非透傳那個 0。
 * - `pageSize` 是裸 i32（非 PageSizeEnum），後端只有 `pageSize === 0 ? DefaultPageSize(100) : pageSize`，
 *   沒有上界 clamp；依 checklist 第 2 節本工具自行把上限收在 200。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - 不帶篩選 pageSize=3：page=1 回 totalPage=6（本平台共 16~18 筆），page=2 回 totalPage=null
 *   且仍有 3 筆資料（覆蓋 checklist 第 2 節「目標不在第一頁」的驗收要求）。
 * - id=1032 精準命中單筆（refCount=1）；name="紅包" 模糊命中 3 筆（含 refCount=3 的 id=19）；
 *   types=[nineGridRedPacket,wechatRedPacket] 篩出 8 筆且 rouletteType 皆為這兩種。
 * - **id=999999（不存在）回 success + 空清單、不報錯**——跟同 domain 的
 *   `GetRouletteConfigById`（回 idNotExists 錯誤）語意不同，因為這裡 id 只是 WHERE 條件而非主鍵查詢。
 *   description 已標明，避免呼叫端誤把「空清單」讀成「查詢失敗」或反之。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetRouletteRewardOption } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ROULETTE_TYPE_MAP, numberToMapKey } from '../const.ts';

const ROULETTE_TYPE_KEYS = Object.keys(ROULETTE_TYPE_MAP) as [ keyof typeof ROULETTE_TYPE_MAP, ...(keyof typeof ROULETTE_TYPE_MAP)[] ];

export function registerGetRouletteRewardListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_get_roulette_reward_list',
        {
            title: "List the current platform's roulette reward (獎勵配置) settings",
            description:
                '分頁查詢本平台的轉盤獎勵配置列表（rajah: RoulettePlatform.GetRouletteRewardList，需要權限節點 ' +
                'BonusCenter.Lottery.RewardConfig；後台「優惠中心／抽獎機制／獎勵配置」列表頁）。' +
                '獎勵配置（Reward）是轉盤的獎項版面，一個轉盤設定（Config）關聯一個 Reward，Reward 內含多個獎項格子（Slot）。' +
                'id 可精準鎖定單一筆（**省略**即不篩選——本工具的 schema 要求 id >= 1，不要傳 0）；**id 不存在時回空清單、不報錯**' +
                '（跟 get_roulette_config_by_id 回 idNotExists 錯誤的語意不同）。name 是純字串模糊搜尋（單一語系，' +
                '不像轉盤設定的名稱那樣需要搭配語言代碼）。' +
                '**refCount 是關鍵欄位**：它是「目前有幾個**啟用中**的轉盤設定引用這個獎勵配置」，' +
                'refCount > 0 時後端會拒絕修改這個獎勵配置（rouletteRewardIdUsed），' +
                '要改必須先把引用它的轉盤設定停用。被「已停用」的設定引用不會計入 refCount。' +
                '回傳只有 totalPage、沒有 totalRow；且 **totalPage 只有 page=1 時是真值**' +
                '（後端共用分頁 helper 只在第一頁跑 count），非第一頁本工具回 totalPage=null，' +
                '請用「rows 筆數 < pageSize 即最後一頁」判斷終點。這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(200).optional()
                    .describe('每頁筆數，1~200，省略時送 0 由後端套用預設值 100。上限 200 是本工具加的保護（後端對這個裸 i32 參數沒有上界檢查）'),
                id: z.number().int().min(1).optional().describe('獎勵配置 id，精準鎖定單一筆；省略 = 不篩選'),
                name: z.string().optional().describe('獎勵配置名稱模糊搜尋（純字串、單一語系，不需要語言代碼）'),
                types: z.array(z.enum(ROULETTE_TYPE_KEYS)).optional().describe(
                    '版面格式篩選（RouletteTypeEnum）：sixPocketRoulette(6格)/eightPocketRoulette(8格)/' +
                    'tenPocketRoulette(10格)/fourteenPocketRoulette(14格)/wechatRedPacket(微信紅包)/' +
                    'nineGridRedPacket(九宮格紅包)，可多選；省略或空陣列 = 不篩選',
                ),
            },
        },
        async (input) => {
            const option = GetRouletteRewardOption.create({
                id: input.id ?? 0,
                name: input.name ?? '',
                types: (input.types ?? []).map((t) => ROULETTE_TYPE_MAP[ t ]),
            });

            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteRewardList(
                input.page ?? 1,
                input.pageSize ?? 0,
                option,
            ));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                rouletteType: numberToMapKey(ROULETTE_TYPE_MAP, row.rouletteType ?? 0),
            }));

            const page = input.page ?? 1;
            // F12（2026-08-28 最終覆核）：pagingNote 叫呼叫端用「rows 筆數 < pageSize」判斷終點，
            // 但省略 pageSize 時它並不知道實際頁大小（後端把 0 當 serverDefault 套用 DefaultPageSize=100，
            // agrabah/src/common/database_helper.ts:11）。這裡明確回報本次真正生效的頁大小。
            const effectivePageSize = input.pageSize ?? 100;
            return asTextResult({
                success: true,
                page,
                effectivePageSize,
                totalPage: page === 1 ? (r.data?.totalPage ?? 0) : null,
                pagingNote: page === 1
                    ? '本 method 不回傳 totalRow，無法得知總筆數'
                    : '本 method 不回傳 totalRow；且 totalPage 只有 page=1 時才是真值（後端只在第一頁跑 count），故此處為 null。判斷是否最後一頁請用「rows 筆數 < pageSize」',
                refCountNote: 'refCount = 引用此獎勵配置的「啟用中」轉盤設定數量；> 0 時無法修改該獎勵配置',
                rows,
            });
        },
    );
}
