/**
 * tools/get_roulette_reward_by_id.ts — aladdin_platform_roulette_platform_get_roulette_reward_by_id
 *
 * rajah: RoulettePlatform.GetRouletteRewardById(id i32 1) (reward RouletteRewardEdit 1)
 * （rajah/services/roulette_back_office.rajah:338，method 自帶 @Permission "BonusCenter.Lottery"，非 @NoPublic；
 * 該 service 刻意不掛 service 級 @Permission，見同檔 :310-315）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:628-742，
 * methodGetRouletteRewardById）確認有真實 override、真的查 DB，非 notImplemented；
 * 全程只有 loadObject/loadObjects/queryById/queryAmounts，沒有任何寫入，
 * 不落入 checklist 第 1 節警告的「假唯讀 Get」陷阱。
 *
 * 分類：第 1 節「讀取單筆（Get by id，回傳單一 model）」。逐項檢查結果：
 * - **id 不存在的行為**：後端 `loadObject(... 'platform_id = ? AND id = ?')` 回 null 時明確回
 *   `ErrorCode.idNotExists`（11）。2026-08-28 dev 實測確認。
 *   ⚠️ 注意這跟同 domain 的 `GetRouletteRewardList(option.id=...)`（查不到只回空清單、不報錯）語意不同。
 * - **跨租戶風險**：查詢條件同時綁 `platform_id = context.platformId`（roulette_platform.ts:630），
 *   底下每一層巢狀查詢（slot / vip 機率 / CurrencyLink / Localization）也都各自帶 platformId。
 * - **`*ForEdit` 系列欄位逐欄檢查**：本 method 回的 RouletteRewardEdit 相對列表版 RouletteReward
 *   多了四張轉盤圖片（backgroundImage/frameImage/bottomImage/pointerImage，皆為多語 File:Image）
 *   與整包 `slots`（每個 slot 23 個欄位），少了 refCount。逐欄檢查後**沒有**密鑰/token/PII 類欄位，
 *   全部是營運自己填的獎項設定值，可直出。`slots[].progressKey` 在 rajah 標了 @Hide（後台表單不顯示），
 *   但它是進度條型獎項的關聯鍵、寫回時必須原樣帶回，本工具照 checklist 第 2 節 A 級同款理由原樣直出。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證（roulette_platform.ts:628-742）：
 * - `slots` 不是直接 join 出來的：先用 AmountLinkManager 查 `rouletteRewardSlot` 關聯拿到 slot id 陣列，
 *   再 `loadObjects(DbRouletteRewardSlot, 'platform_id = ? AND id IN (?)')`，最後逐 slot 補
 *   icon/guide（Localization）、currencyMin/currencyMax/userLimitCurrency/globalLimitCurrency
 *   （CurrencyLink）、probability（VIP 機率，依 vip_level asc 排序）、slotPositions（AmountLink）。
 *   關聯陣列為空時 `slots` 回空陣列，不報錯。
 * - **i64 欄位散落在巢狀結構**：`slots[].itemExpireTime` 是 i64，四組 CurrencyLink 的 `value` 也都是 i64，
 *   protobufjs decode 後可能是 Long 物件。本工具用 const.ts 既有的 `deepFixLongs` 遞迴轉換整包回傳值
 *   （不是只轉頂層），理由與 point_back_office 系列相同：呼叫端很可能把讀回值原樣餵回
 *   create_or_update_roulette_reward，Long 物件被 JSON.stringify 成字串後會過不了對方的 zod number 檢查。
 * - **數值語意陷阱（rajah @Type 標記）**：`wageringMultiplier` 是 `@Type "Rate"`、`probability` 是
 *   `@Type "Rate:100"`、四組 CurrencyLink 的 value 是 stored 值——都不是人類可讀的百分比/金額，
 *   需要依各自精度換算。本工具**不做換算**（換算率不在 rajah 裡、且寫回時要用原始值），
 *   只在 description 標明，避免呼叫端把 10000 讀成「10000%」或「10000 元」。
 * - `probability` 是**依 VIP 等級排序的陣列**（index 0 = VIP0），長度等於該平台設定過的 VIP 等級數。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - id=1032（wechatRedPacket，refCount=1）：回傳 4 張圖片多語欄位 + 2 個 slot；slot 的 23 個欄位
 *   全數到齊（含 @Hide 的 progressKey）；currencyMin/currencyMax 為 `[{code:'CNY', value:18800}]`、
 *   wageringMultiplier=10000（Rate 型 stored 值，不是 10000 倍）、probability 為長度 16 的整數陣列
 *   （該平台 VIP0~VIP15，值皆 5000）；回傳 JSON 中**沒有**任何 protobufjs Long 物件殘留
 *   （`{low,high,unsigned}` 字樣不存在），deepFixLongs 生效。
 * - id=999999（不存在）：回 errorCode=11（idNotExists），非空物件。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ROULETTE_TYPE_MAP, ROULETTE_REWARD_TYPE_MAP, ROULETTE_REWARD_CURRENCY_TYPE_MAP,
    ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP, ROULETTE_REWARD_LIMIT_TYPE_MAP,
    deepFixLongs, numberToMapKey,
} from '../const.ts';

export function registerGetRouletteRewardByIdTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_get_roulette_reward_by_id',
        {
            title: 'Get one roulette reward (獎勵配置) by id, in edit form',
            description:
                '依 id 取單一轉盤獎勵配置的完整編輯內容，含四張轉盤圖片與全部獎項格子（slots）' +
                '（rajah: RoulettePlatform.GetRouletteRewardById，需要權限節點 BonusCenter.Lottery）。' +
                '合法 id 請先用 aladdin_platform_roulette_platform_get_reward_name_list（列出本平台全部 ' +
                '獎勵配置的 id + 名稱）或 aladdin_platform_roulette_platform_get_roulette_reward_list 取得，不要猜。' +
                'id 不存在（或屬於別平台）回 idNotExists 錯誤（**注意**：get_roulette_reward_list 的 id 篩選' +
                '查不到時是回空清單、不報錯，兩者語意不同）。' +
                '**數值語意陷阱**：slots[].wageringMultiplier 是 Rate 型（stored 值，非百分比數字）、' +
                'slots[].probability 是 Rate:100 型的**依 VIP 等級排序陣列**（index 0 = VIP0，非百分比）、' +
                'currencyMin/currencyMax/userLimitCurrency/globalLimitCurrency 是 CurrencyLink[] 多幣別陣列且 ' +
                'value 為 stored 值（常見 ÷10000 才是顯示金額）。本工具一律不換算、原樣回傳，' +
                '因為寫回 create_or_update_roulette_reward 時必須用原始值。' +
                '這是純讀取查詢（後端全程無寫入），可安全重複呼叫；也是修改獎勵配置前取得「現值基準」的指定來源。',
            inputSchema: {
                id: z.number().int().min(1).describe('獎勵配置 id，來自 get_reward_name_list / get_roulette_reward_list'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteRewardById(input.id));
            if (r.failed) return asErrorResult(r, { hint: 'errorCode=11 是 idNotExists（id 不存在或不屬於當前平台）；請用 get_reward_name_list 確認合法 id' });

            const reward = r.data?.reward;
            if (!reward) return asTextResult({ success: false, message: '後端回應成功但沒有 reward 內容，請重試或改用 get_reward_name_list 確認該 id 是否存在' });

            // i64 散落在 slots 巢狀結構各處（itemExpireTime + 四組 CurrencyLink.value），
            // 統一先遞迴把 protobufjs Long 轉成一般 number，再做 enum 的可讀化。
            const fixed = deepFixLongs(reward) as Record<string, unknown> & {
                rouletteType?: number;
                slots?: Record<string, unknown>[];
            };

            const slots = (fixed.slots ?? []).map((slot) => ({
                ...slot,
                rewardType: numberToMapKey(ROULETTE_REWARD_TYPE_MAP, (slot.rewardType as number) ?? 0),
                rewardCurrencyType: numberToMapKey(ROULETTE_REWARD_CURRENCY_TYPE_MAP, (slot.rewardCurrencyType as number) ?? 0),
                itemExpireType: numberToMapKey(ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP, (slot.itemExpireType as number) ?? 0),
                userLimitType: numberToMapKey(ROULETTE_REWARD_LIMIT_TYPE_MAP, (slot.userLimitType as number) ?? 0),
                globalLimitType: numberToMapKey(ROULETTE_REWARD_LIMIT_TYPE_MAP, (slot.globalLimitType as number) ?? 0),
            }));

            return asTextResult({
                success: true,
                reward: {
                    ...fixed,
                    rouletteType: numberToMapKey(ROULETTE_TYPE_MAP, fixed.rouletteType ?? 0),
                    slots,
                },
                valueNote: 'wageringMultiplier / probability / 各 CurrencyLink.value 都是 stored 原始值，非人類可讀的百分比或金額；probability 陣列 index 對應 VIP 等級（0 = VIP0）',
            });
        },
    );
}
