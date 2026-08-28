/**
 * tools/create_or_update_roulette_config.ts — aladdin_platform_roulette_platform_create_or_update_roulette_config
 *
 * rajah: RoulettePlatform.CreateOrUpdateRouletteConfig(config RouletteConfigEdit 1) (id i32 1)
 * （rajah/services/roulette_back_office.rajah:321，method 自帶 @Permission "BonusCenter.Lottery"，非 @NoPublic；
 * 該 service 刻意不掛 service 級 @Permission，見同檔 :310-315）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:121-226，
 * methodCreateOrUpdateRouletteConfig）確認有真實 override、真的在 transaction 內寫 DB，非 notImplemented。
 *
 * 分類：第 4 節「寫入 — Upsert / CreateOrUpdate」，另套第 6 節（config.status 是狀態欄位）。
 * 逐項檢查結果：
 * - **後端屬於第 4 節的「模式 3：真正整包覆蓋、完全沒有 pre-load」**：實作 `new DbRouletteConfig()`
 *   後把 rewardId/status/costType/costItemAmount/costItemId/expireDays/resetType/resetTime 八個欄位
 *   全部從呼叫端傳入的 config 賦值，再 `transaction.updateObject(dbRouletteConfig, false)`
 *   （roulette_platform.ts:146-172）——**沒有先 load 現有列**，任何沒帶到的欄位都會被寫成
 *   protobuf 預設值（數字 0）。多語 name/guide 也是 `localizationManager.updateById` 直接覆蓋。
 *   因此第 4 節「先讀現值、只覆蓋要改欄位」在這支是**硬性必要**而非保險做法：本工具在 id > 0 時
 *   **強制**先呼叫 GetRouletteConfigById 取得完整現值，再把呼叫端明確指定的欄位疊上去。
 * - **round-trip 驗證**：寫入後一律再讀一次，逐欄比對「沒有要求變更的欄位」是否等於呼叫前的值，
 *   結果放在回傳的 `verification` 裡（含 `unchangedFieldsOk` 與 `changed` 明細）。
 * - **id=0/未帶走新增、id>0 走更新**：本工具明確判斷並在回傳的 `mode` 欄位告知呼叫端。
 * - **⚠️ 後端沒有回傳新建的 id**：rajah 宣告回傳 `(id i32 1)`，但實作從頭到尾**沒有設定
 *   `response.id`**（roulette_platform.ts:121-226，最後只 `return GenieResult.success`），
 *   所以新增時 RPC 回來的 id 恆為 0。本工具改用「寫入前後各呼叫一次 GetConfigNameList 取差集」
 *   還原新建的 id，並在回傳中標明這是推導值（`createdIdSource: 'diff'`）。
 * - **⚠️ costType=item 時後端完全不驗證 costItemId 是否存在**：實作只拿
 *   `inventoryBackOffice.inventoryPlatform.GetItemNamesById([costItemId])` 的 `rows[0].name`
 *   去組 audit log 的文字（roulette_platform.ts:130-141）。而該 RPC 的實作是
 *   `ids.map(id => ItemName.create({ id }))` 再補多語名稱
 *   （agrabah/src/servers/inventory_back_office/services/inventory_platform.ts:1341-1355）——
 *   **不管 id 存不存在都固定回一列**，不存在時只是 `name` 為空陣列。
 *   2026-08-28 dev 實測復現：送 costItemId=99999 後端照單全收、寫進 DB，只有 audit log 文字不完整。
 *   本工具因此自行擋在前面：呼叫同一支 inventory RPC，要求 `rows[0].name` **非空**才放行
 *   （空名稱＝這個 id 在本平台沒有對應道具）。
 *   ⚠️ 初版審查時作者誤判成「rows 為空 → rows[0].name 拋 TypeError」，實測證明不是，已修正。
 * - **⚠️ costType 由 currency 改成 item 時，舊的消費金額 CurrencyLink 不會被清掉**：後端只有
 *   `if (config.costType === currency)` 才呼叫 currencyLinkManager.updateById，反向不做清除
 *   （roulette_platform.ts:180-185）。殘留值不會被前台使用（前台也看 costType），但下次改回
 *   currency 而沒帶 currencyAmount 時會沿用舊值——description 已標明。
 * - **第 6 節（狀態欄位）**：`status` 是 ActiveStatusEnum（enabled/disabled）。本 method 不是專門的
 *   狀態轉換 API，只想改狀態請改用 aladdin_platform_roulette_platform_switch_roulette_config_status
 *   （那支有獨立權限節點 ...Status.Toggle，且不會整包覆蓋其他欄位）。
 * - **不可逆性**：`expireDays < 1` 會被後端擋（invalidData）。**整個 roulette_back_office.rajah
 *   沒有任何 Delete/Remove method**（已 grep 全檔確認），所以**新增出來的轉盤設定無法透過 API 刪除**，
 *   只能停用。description 已明確警告，避免呼叫端隨手建立測試資料。
 * - 後端會寫 audit log（SystemIdEnum.roulette，rouletteConfigCreate / rouletteConfigUpdate）。
 *
 * 順帶查到的後端疑似 bug（不在本工具修補範圍，只記錄）：寫 audit log 前
 * `transaction.loadObject(DbRouletteReward, 'id = ?', [dbRouletteConfig.id])`
 * （roulette_platform.ts:196）用的是 **config 的 id** 去查 reward 表，應該是 `config.rewardId`；
 * 影響僅限 audit log 內記錄的 rewardName 可能不對，不影響實際寫入的設定資料。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - **更新 + 局部合併驗證**（checklist 第 4 節硬性要求）：對 id=1030 只帶 `expireDays: 101`，
 *   回讀後 changedFields=["expireDays"]、unchangedFieldsOk=true，name / guide / currencyAmount /
 *   rewardId / status / resetType / resetTime 全部維持原值；再帶 `expireDays: 100` 還原。
 * - **參數守門**：expireDays=0 被 zod 擋在 tool 層；create 分支缺 name/rewardId/currencyAmount 時
 *   回 problems 清單且未執行任何寫入。
 * - **道具存在性守門（實測發現並修正的真實缺陷）**：初版用 `rows.length === 0` 判斷道具是否存在，
 *   實測送 costItemId=99999 竟然**通過檢查並成功寫入 DB**（config 1030 一度被改成 costType=item /
 *   costItemId=99999）。追查後端發現 GetItemNamesById 對任何 id 都固定回一列，改用「`rows[0].name`
 *   是否為空」判斷後重測：99999 被正確擋下且未寫入、合法道具 id=60（config 1029）正常放行。
 *   誤改的 config 1030 已用同一支 tool 逐欄還原，並與測前快照做完整 JSON 比對確認**完全一致**。
 * - **新增分支**：建立一筆 status=disabled 的設定，createdIdSource="diff" 正確推導出新 id=1036，
 *   回讀後 mismatchedVsSent 為空（存進去的值與送出值完全一致）。
 *   ⚠️ **這筆 id=1036（名稱「MCP驗證用-可停用」）留在 dev 上無法刪除**——本 domain 沒有任何
 *   Delete API，只能停用（已是停用狀態）。需要清掉的話得由有 DB 權限的人手動處理。
 * - 沒有測試 costType 由 currency 改成 item 後舊 CurrencyLink 是否殘留這個情境的完整還原路徑
 *   （會在 dev 留下難以還原的中間狀態），該行為的結論來自後端原始碼（roulette_platform.ts:180-185
 *   只有 currency 分支會呼叫 currencyLinkManager），未經實測驗證，description 已據實標示為
 *   「不會被清掉」的推論。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RouletteConfigEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ACTIVE_STATUS_MAP, ROULETTE_COST_TYPE_MAP, ROULETTE_RESET_TYPE_MAP, STATUS_MAP,
    numberToMapKey, toPlainCurrencyLinks, toPlainNumber,
} from '../const.ts';

const ACTIVE_STATUS_KEYS = Object.keys(ACTIVE_STATUS_MAP) as [ keyof typeof ACTIVE_STATUS_MAP, ...(keyof typeof ACTIVE_STATUS_MAP)[] ];
const COST_TYPE_KEYS = Object.keys(ROULETTE_COST_TYPE_MAP) as [ keyof typeof ROULETTE_COST_TYPE_MAP, ...(keyof typeof ROULETTE_COST_TYPE_MAP)[] ];
const RESET_TYPE_KEYS = Object.keys(ROULETTE_RESET_TYPE_MAP) as [ keyof typeof ROULETTE_RESET_TYPE_MAP, ...(keyof typeof ROULETTE_RESET_TYPE_MAP)[] ];

const localizedTextSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的文字值'),
}));

const currencyLinkSchema = z.array(z.object({
    code: z.string().describe('幣別代碼，例如 CNY、USD'),
    value: z.number().int().describe('該幣別下的金額（後端 stored 值，非人類可讀金額，本工具不做單位換算）'),
}));

type PlainConfig = {
    id?: number | null;
    name?: { code?: string | null; value?: string | null }[] | null;
    guide?: { code?: string | null; value?: string | null }[] | null;
    rewardId?: number | null;
    status?: number | null;
    costType?: number | null;
    costItemId?: number | null;
    costItemAmount?: number | null;
    currencyAmount?: { code?: string | null; value?: unknown }[] | null;
    expireDays?: number | null;
    resetType?: number | null;
    resetTime?: number | null;
};

/** 回傳給呼叫端看的可讀版本，也用來做寫入前後的逐欄比對。 */
function readable(c: PlainConfig) {
    return {
        id: c.id ?? 0,
        name: (c.name ?? []).map((l) => ({ code: l.code, value: l.value })),
        guide: (c.guide ?? []).map((l) => ({ code: l.code, value: l.value })),
        rewardId: c.rewardId ?? 0,
        status: numberToMapKey(STATUS_MAP, c.status ?? 0),
        costType: numberToMapKey(ROULETTE_COST_TYPE_MAP, c.costType ?? 0),
        costItemId: c.costItemId ?? 0,
        costItemAmount: c.costItemAmount ?? 0,
        currencyAmount: toPlainCurrencyLinks(c.currencyAmount),
        expireDays: c.expireDays ?? 0,
        resetType: numberToMapKey(ROULETTE_RESET_TYPE_MAP, c.resetType ?? 0),
        resetTime: c.resetTime ?? 0,
    };
}

export function registerCreateOrUpdateRouletteConfigTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_create_or_update_roulette_config',
        {
            title: 'Create or update one roulette (lottery) config',
            description:
                '新增或更新一個轉盤設定（rajah: RoulettePlatform.CreateOrUpdateRouletteConfig，需要權限節點 ' +
                'BonusCenter.Lottery）。**帶 id = 更新既有設定，不帶 id = 新增一筆全新設定**。' +
                '⚠️ **新增出來的轉盤設定無法刪除**——整個 roulette 後台沒有任何 Delete API，建錯了只能停用，' +
                '請確認真的要新增再呼叫。' +
                '⚠️ **後端是整包覆蓋、不做欄位合併**：更新時本工具會強制先讀回現值再把你指定的欄位疊上去，' +
                '所以更新只需要帶「要改的欄位」；但**不要**繞過本工具直接組 payload 呼叫該 RPC，會把沒帶到的欄位歸零。' +
                '新增時 rewardId / name / expireDays / costType / resetType 為必填（後端 @Rules "Required"）；' +
                'costType=currency 要帶 currencyAmount、costType=item 要帶 costItemId + costItemAmount。' +
                'rewardId 請先用 aladdin_platform_roulette_platform_get_reward_name_list 取得合法值，' +
                'costItemId 請先用 aladdin_platform_inventory_platform_list_items / list_enabled_items_all 取得——' +
                '本工具會先驗證 costItemId 真的存在再送出——**後端對這個欄位完全沒有存在性檢查**，' +
                '不存在的道具 id 會被安靜寫進設定（2026-08-28 dev 實測復現）。' +
                '⚠️ costType 從 currency 改成 item 時，後端**不會清掉**舊的消費金額設定，日後改回 currency ' +
                '而沒帶 currencyAmount 會沿用舊值。' +
                '⚠️ **後端不回傳新建的 id**（宣告有但實作沒設），新增時本工具用「寫入前後的設定清單差集」推導 id，' +
                '回傳的 createdIdSource=diff 就是這個意思；極端情況（同時有別人也在新增）可能推導不出來。' +
                '只想改啟用/停用狀態請改用 aladdin_platform_roulette_platform_switch_roulette_config_status，' +
                '不要用這支（那支有獨立權限節點且不會覆蓋其他欄位）。' +
                '寫入後本工具一律 round-trip 讀回並逐欄比對，結果放在 verification 欄位。',
            inputSchema: {
                id: z.number().int().min(1).optional().describe('要更新的轉盤設定 id；**省略代表新增一筆全新設定（無法刪除，請謹慎）**'),
                name: localizedTextSchema.optional().describe('轉盤名稱（多語）。新增時必填；更新時省略則沿用現值'),
                guide: localizedTextSchema.optional().describe('抽獎說明（多語 RichText，值是 HTML 片段如 <p>…</p>）。更新時省略則沿用現值'),
                rewardId: z.number().int().min(1).optional().describe('關聯的獎勵配置 id，來自 get_reward_name_list。新增時必填'),
                status: z.enum(ACTIVE_STATUS_KEYS).optional().describe('啟用狀態：enabled/disabled。更新時省略則沿用現值；只想改狀態請改用 switch_roulette_config_status'),
                costType: z.enum(COST_TYPE_KEYS).optional().describe('每抽的消費方式：currency(貨幣) 或 item(道具)。新增時必填'),
                currencyAmount: currencyLinkSchema.optional().describe('每抽消費金額（多幣別，stored 值）。costType=currency 時必填'),
                costItemId: z.number().int().min(0).optional().describe('每抽消費的道具 id（來自 inventory 相關 tool）。costType=item 時必填且需 >= 1；填 0 代表清空（僅在 costType=currency 時有意義）'),
                costItemAmount: z.number().int().min(0).optional().describe('每抽消費的道具數量。costType=item 時必填且需 >= 1；填 0 代表清空（僅在 costType=currency 時有意義）'),
                expireDays: z.number().int().min(1).optional().describe('獎勵領取過期天數，必須 >= 1（後端對 <1 回 invalidData）。新增時必填'),
                resetType: z.enum(RESET_TYPE_KEYS).optional().describe('重置週期：none(不重置)/weekly(每週)/monthly(每月)。新增時必填'),
                resetTime: z.number().int().min(0).optional().describe('重置時間點（resetType=weekly 時為星期幾、monthly 時為幾號；resetType=none 時填 0）'),
                confirm: z.string().optional().describe(`prod 環境專用的二次確認字串（非 prod 環境不需要）。需要時填入 ${ PROD_CONFIRM_TOKEN }`),
            },
        },
        async (input) => {
            // prod 環境的伺服器端 confirm 閘門（非 prod 直接放行）；被擋下時會拋 ProdConfirmRequiredError，
            // 由 http.ts / stdio 的包裝層轉成錯誤回應，比照 create_or_update_item.ts 的既有用法。
            assertProdConfirmed(input.confirm);

            const isUpdate = input.id !== undefined;

            // ---- 1. 取得基準值（更新才有；新增時基準是空的） ----
            let base: PlainConfig = {};
            if (isUpdate) {
                const cur = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteConfigById(input.id!));
                if (cur.failed) return asErrorResult(cur, { hint: '讀取現值失敗，未執行任何寫入。errorCode=11 是 idNotExists（id 不存在或不屬於當前平台）' });
                if (!cur.data?.config) return asTextResult({ success: false, message: `讀取 id=${ input.id } 的現值時後端回應成功但沒有內容，未執行任何寫入` });
                base = cur.data.config as PlainConfig;
            }

            // ---- 2. 合併：呼叫端明確指定的欄位覆蓋基準值，其餘原樣帶回 ----
            const merged = {
                id: input.id ?? 0,
                name: input.name ?? (base.name ?? []),
                guide: input.guide ?? (base.guide ?? []),
                rewardId: input.rewardId ?? (base.rewardId ?? 0),
                status: input.status ? ACTIVE_STATUS_MAP[ input.status ] : (base.status ?? ACTIVE_STATUS_MAP.disabled),
                costType: input.costType ? ROULETTE_COST_TYPE_MAP[ input.costType ] : (base.costType ?? ROULETTE_COST_TYPE_MAP.currency),
                costItemId: input.costItemId ?? (base.costItemId ?? 0),
                costItemAmount: input.costItemAmount ?? (base.costItemAmount ?? 0),
                currencyAmount: input.currencyAmount
                    ?? (base.currencyAmount ?? []).map((l) => ({ code: l.code ?? '', value: toPlainNumber(l.value) ?? 0 })),
                expireDays: input.expireDays ?? (base.expireDays ?? 0),
                resetType: input.resetType ? ROULETTE_RESET_TYPE_MAP[ input.resetType ] : (base.resetType ?? ROULETTE_RESET_TYPE_MAP.none),
                resetTime: input.resetTime ?? (base.resetTime ?? 0),
            };

            // ---- 3. 送出前的必填/一致性檢查（後端 @Rules "Required" 與已知的未處理例外） ----
            const problems: string[] = [];
            if (merged.name.length === 0) problems.push('name 是必填（多語名稱至少一個語系）');
            if (!merged.rewardId) problems.push('rewardId 是必填，請先用 aladdin_platform_roulette_platform_get_reward_name_list 取得合法值');
            if (merged.expireDays < 1) problems.push('expireDays 必須 >= 1（後端對 <1 直接回 invalidData）');
            if (merged.costType === ROULETTE_COST_TYPE_MAP.currency && merged.currencyAmount.length === 0) {
                problems.push('costType=currency 時 currencyAmount 是必填');
            }
            if (merged.costType === ROULETTE_COST_TYPE_MAP.item) {
                if (!merged.costItemId) problems.push('costType=item 時 costItemId 是必填');
                if (!merged.costItemAmount) problems.push('costType=item 時 costItemAmount 是必填');
            }
            if (problems.length > 0) {
                return asTextResult({ success: false, mode: isUpdate ? 'update' : 'create', message: '參數檢查未通過，未執行任何寫入', problems });
            }

            // costType=item：後端完全不驗證 costItemId 是否存在（見檔頭），不存在的 id 會被安靜寫進 DB。
            // GetItemNamesById 對任何 id 都固定回一列，所以存在與否要看 name 是不是空的。
            if (merged.costType === ROULETTE_COST_TYPE_MAP.item) {
                const itemR = await withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.GetItemNamesById([ merged.costItemId ]));
                if (itemR.failed) {
                    return asErrorResult(itemR, { hint: `驗證 costItemId=${ merged.costItemId } 是否存在時失敗，未執行任何寫入`, mode: isUpdate ? 'update' : 'create' });
                }
                const itemName = (itemR.data?.rows ?? [])[0]?.name ?? [];
                if (itemName.length === 0) {
                    return asTextResult({
                        success: false,
                        mode: isUpdate ? 'update' : 'create',
                        message: `costItemId=${ merged.costItemId } 在本平台查不到對應道具（名稱為空），未執行任何寫入。`
                            + '後端對這個欄位沒有任何存在性檢查，若直接送出會把無效的道具 id 安靜寫進設定，'
                            + '請先用 aladdin_platform_inventory_platform_list_items / list_enabled_items_all 取得合法 id。',
                    });
                }
            }

            // ---- 4. 新增前先記下現有 id 清單，供事後推導新 id（後端不回傳新建 id） ----
            let idsBefore: number[] = [];
            if (!isUpdate) {
                const listR = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetConfigNameList());
                if (listR.failed) return asErrorResult(listR, { hint: '新增前取得既有設定清單失敗（用於事後推導新建 id），未執行任何寫入' });
                idsBefore = (listR.data?.rows ?? []).map((row) => row.id ?? 0);
            }

            // ---- 5. 寫入 ----
            const payload = RouletteConfigEdit.create(merged);
            const w = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.CreateOrUpdateRouletteConfig(payload));
            if (w.failed) return asErrorResult(w, { mode: isUpdate ? 'update' : 'create', hint: '寫入失敗；errorCode 對應 invalidData 時最常見成因是 expireDays < 1' });

            // ---- 6. round-trip 驗證 ----
            let newId = input.id ?? 0;
            let createdIdSource: string | null = null;
            if (!isUpdate) {
                const listR = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetConfigNameList());
                if (!listR.failed) {
                    const added = (listR.data?.rows ?? []).map((row) => row.id ?? 0).filter((id) => !idsBefore.includes(id));
                    if (added.length === 1) { newId = added[0]!; createdIdSource = 'diff'; }
                    else if (added.length > 1) { createdIdSource = `ambiguous(${ added.join(',') })`; }
                }
            }

            if (!newId) {
                return asTextResult({
                    success: true,
                    mode: 'create',
                    verified: false,
                    createdId: null,
                    createdIdSource,
                    message: '新增的 RPC 已成功回應，但無法推導出新建的 id（後端不回傳 id，且清單差集不唯一）。'
                        + '請用 aladdin_platform_roulette_platform_get_config_name_list 自行確認。',
                });
            }

            const after = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteConfigById(newId));
            if (after.failed || !after.data?.config) {
                return asTextResult({
                    success: true,
                    mode: isUpdate ? 'update' : 'create',
                    id: newId,
                    createdIdSource,
                    verified: false,
                    message: '寫入的 RPC 已成功回應，但回讀驗證失敗，請自行用 get_roulette_config_by_id 覆核',
                    verifyError: after.failed ? { errorCode: after.errorCode, message: after.message } : null,
                });
            }

            const beforeReadable = isUpdate ? readable(base) : null;
            const afterReadable = readable(after.data.config as PlainConfig);
            const expectedReadable = readable({ ...merged, id: newId } as PlainConfig);

            // 逐欄比對：哪些欄位跟寫入前不同（更新才有基準可比）、以及實際結果是否等於預期送出值。
            const changed: string[] = [];
            const mismatched: string[] = [];
            for (const key of Object.keys(afterReadable) as (keyof typeof afterReadable)[]) {
                if (beforeReadable && JSON.stringify(beforeReadable[ key ]) !== JSON.stringify(afterReadable[ key ])) changed.push(key);
                if (JSON.stringify(expectedReadable[ key ]) !== JSON.stringify(afterReadable[ key ])) mismatched.push(key);
            }

            return asTextResult({
                success: true,
                mode: isUpdate ? 'update' : 'create',
                id: newId,
                createdIdSource,
                verified: true,
                verification: {
                    requestedFields: Object.keys(input).filter((k) => k !== 'id' && k !== 'confirm'),
                    changedFields: changed,
                    unchangedFieldsOk: beforeReadable
                        ? changed.every((k) => Object.prototype.hasOwnProperty.call(input, k))
                        : null,
                    mismatchedVsSent: mismatched,
                    note: 'changedFields 應該只包含你這次明確指定的欄位；mismatchedVsSent 非空代表後端存進去的值跟送出的不一致（例如金額精度或 enum 轉換），需人工確認',
                },
                before: beforeReadable,
                after: afterReadable,
                deleteWarning: isUpdate ? null : '⚠️ 轉盤設定沒有任何刪除 API，這筆新建的設定只能停用、無法刪除',
            });
        },
    );
}
