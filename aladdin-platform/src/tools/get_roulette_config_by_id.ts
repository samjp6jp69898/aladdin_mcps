/**
 * tools/get_roulette_config_by_id.ts — aladdin_platform_roulette_platform_get_roulette_config_by_id
 *
 * rajah: RoulettePlatform.GetRouletteConfigById(id i32 1) (config RouletteConfigEdit 1)
 * （rajah/services/roulette_back_office.rajah:323，method 自帶 @Permission "BonusCenter.Lottery"，
 * 非 @NoPublic）
 *
 * ⚠️ 權限節點是**逐 method 標註、不會從上一個 method 延續**，而且這個 service **刻意不掛 service 級
 * @Permission**（roulette_back_office.rajah:310-315 有明文說明：GetConfigNameList 是跨一級菜單共用的
 * 下拉來源，掛在 service 標頭會讓沒自綁節點的 method 都被套上 BonusCenter.Lottery、擋掉只有廣告或商城
 * 權限的角色）。初版註解誤寫成「service 標頭 + 上一個 method 起算」，2026-08-28 review 指出後已更正。
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:229-263，
 * methodGetRouletteConfigById）確認有真實 override、真的查 DB，非 notImplemented。
 * 方法名雖是 `Get` 前綴，實作全程只有 loadObject/queryById（無任何寫入、無 claim/consume 語意），
 * 不落入 checklist 第 1 節警告的「假唯讀 Get」陷阱。
 *
 * 分類：第 1 節「讀取單筆（Get by id，回傳單一 model）」。逐項檢查結果：
 * - **id 不存在的行為**：後端 `loadObject(... 'platform_id = ? AND id = ?')` 回 null 時明確回
 *   `ErrorCode.idNotExists`（非空 struct、非拋例外）。2026-08-28 dev 實測確認。
 * - **跨租戶風險**：查詢條件已同時綁 `platform_id = context.platformId`（roulette_platform.ts:231），
 *   別平台的 config id 會落到 null → idNotExists 分支。2026-08-28 dev 實測以本平台清單以外的
 *   id（1/2/3/1000；本平台實際擁有的是 8~22 與 1025~1031）探測，全部回 idNotExists；
 *   ⚠️ 這幾個 id 是否真的屬於其他平台未另外查 DB 佐證，跨租戶隔離的直接證據仍是上面那行 SQL 條件。
 * - **`*ForEdit` 系列欄位比顯示版多**：本 method 回的 `RouletteConfigEdit` 相對列表版
 *   `RouletteConfig` 多了 `rewardId`（關聯的獎勵設定 id）與 `guide`（抽獎說明，RichText 多語），
 *   少了 `rewardName`。逐欄檢查後沒有密鑰/token/PII 類欄位，全部是營運自己填的設定值，可直出。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證（roulette_platform.ts:229-263）：
 * - `name`（LocalizationServiceIdEnum.rouletteConfigName）與 `guide`
 *   （rouletteConfigGuide）都是另外用 LocalizationManager 補上的多語陣列。
 * - `currencyAmount`（[CurrencyLink]，value 是 i64）**只有 costType=currency 時才會被填**，
 *   costType=item 時後端根本不查 CurrencyLinkManager，欄位維持空陣列（不是 0、不是 null）。
 * - `status` 在 rajah 宣告是 ActiveStatusEnum（enabled=1/disabled=2），但實際存的是
 *   roulette_configs.status（StatusEnum）；兩者 1/2 相同，本工具用完整 STATUS_MAP 反查 key，
 *   遇到 ActiveStatusEnum 沒有的值（如 frozen=3）也不會顯示成裸數字。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - id=1031（costType=currency）：回傳完整設定，currencyAmount=[{code:CNY,value:10000}]、
 *   guide 為多語 RichText（`<p>抽一次一元</p>`）、rewardId=1032。
 * - id=1029（costType=item）：currencyAmount=[] 如預期，costItemId=60/costItemAmount=1。
 * - id=999999（不存在）：回 errorCode=11（genie ErrorCode.idNotExists，
 *   genie/src/common/error_code.ts:13），非空物件。⚠️ 共用的 asErrorResult 只反查
 *   AgrabahErrorCodeEnum，genie 內建錯誤碼會顯示成 errorName="(未知錯誤碼)"，這是既有共用
 *   行為（非本工具引入），本工具用 hint 欄位補上人話說明。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ROULETTE_COST_TYPE_MAP, ROULETTE_RESET_TYPE_MAP, STATUS_MAP,
    numberToMapKey, toPlainCurrencyLinks,
} from '../const.ts';

export function registerGetRouletteConfigByIdTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_get_roulette_config_by_id',
        {
            title: 'Get one roulette (lottery) config by id, in edit form',
            description:
                '依 id 取單一轉盤設定的完整編輯內容（rajah: RoulettePlatform.GetRouletteConfigById，' +
                '需要權限節點 BonusCenter.Lottery）。' +
                '合法 id 請先用 aladdin_platform_roulette_platform_get_config_name_list（列出本平台全部 ' +
                'config 的 id + 多語名稱）或 aladdin_platform_roulette_platform_get_roulette_config_list 取得，' +
                '不要自己猜數字。id 不存在（或屬於別的平台）一律回 idNotExists 錯誤，不會回空物件。' +
                '相對列表版多了 rewardId（關聯的獎勵設定 id）與 guide（抽獎說明，RichText 多語）。' +
                'currencyAmount（每抽消費金額）只有 costType=currency 時才有值，costType=item 時固定是空陣列；' +
                '它是 CurrencyLink[] 多幣別陣列、value 為 stored 值（非人類可讀金額，依幣別精度換算，' +
                '常見 ÷10000），本工具不換算。' +
                '這是純讀取查詢（後端全程無寫入），可安全重複呼叫；也是呼叫 ' +
                'aladdin_platform_roulette_platform_create_or_update_roulette_config 做更新前，' +
                '取得「現值基準」的指定來源。',
            inputSchema: {
                id: z.number().int().min(1).describe('轉盤設定 id，來自 get_config_name_list / get_roulette_config_list'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteConfigById(input.id));
            if (r.failed) return asErrorResult(r, { hint: 'id 不存在或不屬於當前平台時後端回 idNotExists；請用 get_config_name_list 確認合法 id' });

            const c = r.data?.config;
            if (!c) return asTextResult({ success: false, message: '後端回應成功但沒有 config 內容，請重試或改用 get_config_name_list 確認該 id 是否存在' });

            return asTextResult({
                success: true,
                config: {
                    ...c,
                    status: numberToMapKey(STATUS_MAP, c.status ?? 0),
                    costType: numberToMapKey(ROULETTE_COST_TYPE_MAP, c.costType ?? 0),
                    resetType: numberToMapKey(ROULETTE_RESET_TYPE_MAP, c.resetType ?? 0),
                    currencyAmount: toPlainCurrencyLinks(c.currencyAmount),
                },
            });
        },
    );
}
