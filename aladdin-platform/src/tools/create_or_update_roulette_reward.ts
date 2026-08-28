/**
 * tools/create_or_update_roulette_reward.ts — aladdin_platform_roulette_platform_create_or_update_roulette_reward
 *
 * rajah: RoulettePlatform.CreateOrUpdateRouletteReward(reward RouletteRewardEdit 1) (id i32 1)
 * （rajah/services/roulette_back_office.rajah:336，@Permission "BonusCenter.Lottery.RewardConfig"，非 @NoPublic）
 * 內部同時包了 RoulettePlatform.GetUploadImageToken（roulette_back_office.rajah:342）與
 * RoulettePlatform.GetRouletteRewardById（:338）：
 * - `GetUploadImageToken` 依 tool-naming-convention.md「一支 tool 內部呼叫多支 method（Get + 寫入）
 *   用寫入那支命名」與本 server 既有慣例（create_or_update_item.ts / onboard_vendor_game.ts 都把
 *   GetUploadXxxToken 包在寫入 tool 內、不另立 tool），**不另外註冊成獨立 tool**：那支 RPC 單獨拿到
 *   token 對呼叫端沒有用（token 要配合 `POST /upload` 才有意義，且一小時後失效、用過一次即作廢）。
 * - `GetRouletteRewardById` 是第 4 節強制要求的「先讀現值」來源。
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:433-620，
 * methodCreateOrUpdateRouletteReward；:893-938 methodGetUploadImageToken）確認皆有真實 override、
 * 真的寫 DB / 真的建 token，非 notImplemented。
 *
 * 分類：第 4 節「寫入 — Upsert / CreateOrUpdate」，另套第 8 節（上傳 token 類）。
 * 逐項檢查結果：
 * - **後端屬於第 4 節的「模式 3：整包覆蓋、沒有 pre-load」**：`new DbRouletteReward()` 直接由傳入值
 *   賦值後 `updateObject(..., false)`（roulette_platform.ts:454-472）；四張圖片與每個 slot 的
 *   icon/guide/CurrencyLink 也都是 `updateById` 直接覆蓋。因此「先讀現值再合併」是硬性必要，
 *   本工具在 id > 0 時**強制**先呼叫 GetRouletteRewardById。
 * - **第 4 節模式 5（批次陣列型 Upsert）的變形，且比一般情況更危險**：`slots` 是逐筆 upsert
 *   （有 id 走 update、沒 id 走 insert），DB 裡存在但沒出現在傳入陣列的舊 slot **不會被刪除**；
 *   但緊接著的 `amountLinkManager.syncAmounts(..., rouletteRewardSlot, rewardId, ids)`
 *   （roulette_platform.ts:594-597）會把「這個 reward 關聯哪些 slot」整包換成傳入的那批 id——
 *   結果是**被省略的 slot 變成解除關聯的孤兒列**（讀不到、也刪不掉，因為本 domain 沒有任何 Delete API）。
 *   本工具因此**不接受「用一個新陣列取代全部 slots」的語意**：傳入的 slots 一律**疊加**到讀回的現有
 *   slots 上（依 slot id 比對逐欄合併），沒提到的 slot 原樣帶回；真的要移除某個 slot 必須用
 *   `removeSlotIds` 明確指定，並在回傳中警示它會變成孤兒列。
 * - **round-trip 驗證**：寫入後一律再讀一次，回報 changedSlotIds 與 top-level 差異。
 * - **id=0/未帶走新增、id>0 走更新**：本工具明確判斷並在回傳的 `mode` 告知。
 * - **⚠️ 後端不回傳新建的 id**：跟 CreateOrUpdateRouletteConfig 同款，實作從未設定 `response.id`
 *   （roulette_platform.ts:433-620 只 `return GenieResult.success`）。新增時本工具用
 *   「寫入前後 GetRewardNameList 差集」推導 id，並標示 `createdIdSource: 'diff'`。
 * - **⚠️ refCount > 0 擋修**：更新前後端會先 count「引用此 reward 的**啟用中** config」數量，
 *   >0 直接回 `AgrabahErrorCodeEnum.rouletteRewardIdUsed`（roulette_platform.ts:436-445）。
 *   本工具在送出前先用 GetRouletteRewardList(option.id) 讀 refCount，>0 時直接擋下並說明
 *   「要改必須先把引用它的轉盤設定停用」，不讓呼叫端只拿到一個看不懂的錯誤碼。
 * - **⚠️ checkReward 前置驗證**（agrabah/src/servers/roulette_back_office/common/roulette_common.ts:4-45）：
 *   slots 不可為空；miss 型格子不可設任何上限；item 型格子的上限不可用 amount（金額）型；
 *   progress 型格子的 progressKey 不可為空；只要有任何一格設了上限，就必須至少有一格是 miss。
 *   本工具在送出前用同一組規則自行檢查，把後端的 `invalidData + 英文字串` 轉成中文可行動的訊息。
 * - **不可逆性**：本 domain 沒有任何 Delete/Remove method（已 grep 全檔確認），**新建的獎勵配置與
 *   新建的 slot 都無法刪除**。description 已明確警告。
 * - 後端會寫 audit log（SystemIdEnum.roulette，rouletteSlotCreate / rouletteSlotUpdate）。
 *
 * **上傳 token（checklist 第 8 節）**：四張轉盤圖片與每個 slot 的 icon 都走
 * `GetUploadImageToken(type)` 拿 token 再 `POST /upload`。實地查證的 token 性質：
 * - **有效期 1 小時**（agrabah/src/managers/file_manager.ts:12 `FILE_DATA_EXPIRED_TIME = 60*60`，
 *   storeFileData 寫進 cache 時就是這個 TTL）。
 * - **只能用一次**：上傳時後端把狀態由 waiting 改成 uploading，同一 token 再上傳回
 *   `fileTokenStateNotMatch`（file_manager.ts:110-128）。
 * - **不綁呼叫者身份**：FileData 只存 id/status/folder/filename/path/customData 等欄位，
 *   沒有任何 userId/platformId，任何拿到 token 的人都能用它上傳。
 * - **多次呼叫不會使前一個失效**：每次都 `new FileData()` 產生獨立 id，舊 token 在 TTL 內仍有效。
 * - 因此本工具**每上傳一個檔案就即時取一次新 token**、不快取、不重複使用（比照 create_or_update_item.ts）。
 * - **⚠️ `type` 參數在後端被完全忽略**：`methodGetUploadImageToken`
 *   （roulette_platform.ts:893-938）把各通道的 width/height 分支整段註解掉了，實際固定送
 *   `{ maxSize: 1920, format: 'webp' }`，五個通道拿到的 token 完全等價。本工具仍照 rajah 傳對應的
 *   通道值（未來後端恢復分支時行為才會正確），但在 description 據實說明目前不影響結果。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - **更新 + 局部合併驗證**（checklist 第 4 節硬性要求）：對 id=20（refCount=0，3 個 slot）只帶
 *   `name`，回讀後 changedTopLevelFields=["name"]、changedSlotIds=[]、droppedSlotIds=[]；
 *   再只帶 `slots:[{id:37, guaranteedCount:5}]`，回讀後 changedSlotIds=[37]、其餘 slot 與四張圖片
 *   全部原封不動；兩項都逐一還原，最後與測前快照做完整 JSON 比對確認**完全一致**。
 * - **實測抓到並修正的真實 bug**：初版把 `baseSlots` 直接當事後比對基準，但合併階段的
 *   `Object.assign(target, next)` 會就地改寫 `mergedSlots` 的元素，而 `mergedSlots` 是
 *   `baseSlots.filter(...)` 出來的**同一批物件參照**——導致比對基準被連帶改寫、changedSlotIds
 *   永遠算出空陣列（實測 guaranteedCount 明明改成 5 卻回報「沒有變更」）。已改成另存一份
 *   深拷貝 `baseSlotsSnapshot` 當唯一比對基準，重測後 changedSlotIds 正確回報 [37]。
 * - **refCount 守門**：對 id=1032（refCount=1）呼叫，被本工具擋在送出前並回報可行動的中文說明。
 * - **checkReward 守門**：對 id=20 的 miss 格子（id=36）設 userLimitType=count，被本工具擋下
 *   （problems: "rewardType=miss（銘謝惠顧）不可設定任何個人/全服上限"），未執行任何寫入。
 * - **新增分支 + 圖片上傳（GetUploadImageToken 端到端）**：建立一筆 sixPocketRoulette 配置，
 *   帶 backgroundImage 與其中一格的 icon（本機 PNG → GetUploadImageToken → POST /upload），
 *   createdIdSource="diff" 正確推導出新 id=1038，回讀確認兩張圖都拿到真實靜態路徑
 *   （`/static/roulette/...`）、兩個 slot（1078 miss / 1079 currency）欄位與送出值一致、
 *   沒帶 icon 的那格 icon 維持空陣列。
 *   ⚠️ **這筆 reward id=1038（名稱「MCP驗證用獎勵配置」，含 slot 1078/1079）留在 dev 上無法刪除**
 *   ——本 domain 沒有任何 Delete API。需要清掉得由有 DB 權限的人手動處理。
 * - 未實測 `removeSlotIds`（會在 dev 產生刪不掉的孤兒列，且無法還原），該路徑的行為結論來自
 *   後端 `amountLinkManager.syncAmounts` 的原始碼（roulette_platform.ts:594-597），
 *   description 已據實標示為「解除關聯、不刪除」。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RouletteRewardEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ROULETTE_TYPE_MAP, ROULETTE_REWARD_TYPE_MAP, ROULETTE_REWARD_CURRENCY_TYPE_MAP,
    ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP, ROULETTE_REWARD_LIMIT_TYPE_MAP, ROULETTE_UPLOAD_IMAGE_MAP,
    deepFixLongs, numberToMapKey,
} from '../const.ts';

const ROULETTE_TYPE_KEYS = Object.keys(ROULETTE_TYPE_MAP) as [ keyof typeof ROULETTE_TYPE_MAP, ...(keyof typeof ROULETTE_TYPE_MAP)[] ];
const REWARD_TYPE_KEYS = Object.keys(ROULETTE_REWARD_TYPE_MAP) as [ keyof typeof ROULETTE_REWARD_TYPE_MAP, ...(keyof typeof ROULETTE_REWARD_TYPE_MAP)[] ];
const REWARD_CURRENCY_TYPE_KEYS = Object.keys(ROULETTE_REWARD_CURRENCY_TYPE_MAP) as [ keyof typeof ROULETTE_REWARD_CURRENCY_TYPE_MAP, ...(keyof typeof ROULETTE_REWARD_CURRENCY_TYPE_MAP)[] ];
const ITEM_EXPIRE_TYPE_KEYS = Object.keys(ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP) as [ keyof typeof ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP, ...(keyof typeof ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP)[] ];
const LIMIT_TYPE_KEYS = Object.keys(ROULETTE_REWARD_LIMIT_TYPE_MAP) as [ keyof typeof ROULETTE_REWARD_LIMIT_TYPE_MAP, ...(keyof typeof ROULETTE_REWARD_LIMIT_TYPE_MAP)[] ];

const localizedTextSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的文字值'),
}));

const currencyLinkSchema = z.array(z.object({
    code: z.string().describe('幣別代碼，例如 CNY、USD'),
    value: z.number().int().describe('該幣別下的金額（後端 stored 值，非人類可讀金額，本工具不做單位換算）'),
}));

// H9 同構：filePath（stdio）/ fileId（hosted）二選一，見 create_or_update_item.ts 同名 schema 註解。
const fileUploadSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    filePath: z.string().optional().describe('stdio 模式專用：本機檔案絕對路徑，與 fileId 二選一'),
    fileId: z.string().optional().describe('hosted 模式專用：先呼叫 POST /files 上傳取得，與 filePath 二選一'),
}));

const slotSchema = z.object({
    id: z.number().int().min(0).optional().describe('要更新的既有格子 id（來自 get_roulette_reward_by_id）；省略或 0 代表新增一個格子（**新增的格子無法刪除**）'),
    name: z.string().optional().describe('格子名稱（後台用，非玩家可見）'),
    icon: fileUploadSchema.optional().describe('格子圖示，每個語系各帶一組 {code, filePath} 或 {code, fileId}；不帶則沿用既有值'),
    guide: localizedTextSchema.optional().describe('玩家看到的顯示名稱（多語，後端 @Rules "Required"）'),
    rewardType: z.enum(REWARD_TYPE_KEYS).optional().describe('獎勵種類：currency(錢幣)/item(道具)/miss(銘謝惠顧)/progress(進度條)'),
    rewardCurrencyType: z.enum(REWARD_CURRENCY_TYPE_KEYS).optional().describe('錢幣獎勵金額型態：fixed(固定金額，用 currencyMin)/range(區間金額，用 currencyMin~currencyMax)'),
    currencyMin: currencyLinkSchema.optional().describe('獎勵金額下限（fixed 時就用這個欄位），多幣別 stored 值'),
    currencyMax: currencyLinkSchema.optional().describe('獎勵金額上限，多幣別 stored 值'),
    wageringMultiplier: z.number().int().min(0).optional().describe('稽核倍率（rajah @Type "Rate"，stored 值非百分比數字）'),
    itemId: z.number().int().min(0).optional().describe('獎勵道具 id（rewardType=item 時使用），來自 inventory 相關 tool'),
    itemAmount: z.number().int().min(0).optional().describe('獎勵道具數量；rewardType=progress 時這個欄位是進度條的值'),
    itemExpireType: z.enum(ITEM_EXPIRE_TYPE_KEYS).optional().describe('道具到期方式：none(無期限)/absolute(絕對到期時間)/relative(相對小時數)'),
    itemExpireTime: z.number().int().min(0).optional().describe('道具到期時間：absolute 時為 timestamp、relative 時為小時數'),
    probability: z.array(z.number().int().min(0)).optional().describe('中獎機率陣列，**index 對應 VIP 等級（0 = VIP0）**，rajah @Type "Rate:100"，是 stored 值不是百分比數字'),
    userLimitType: z.enum(LIMIT_TYPE_KEYS).optional().describe('個人上限型態：unlimited(無限制)/count(中獎次數)/amount(累積金額)'),
    userLimitCount: z.number().int().min(0).optional().describe('個人中獎次數上限（userLimitType=count 時使用）'),
    userLimitCurrency: currencyLinkSchema.optional().describe('個人累積金額上限（userLimitType=amount 時使用），多幣別 stored 值'),
    globalLimitType: z.enum(LIMIT_TYPE_KEYS).optional().describe('全服上限型態：unlimited/count/amount'),
    globalLimitCount: z.number().int().min(0).optional().describe('全服中獎次數上限（globalLimitType=count 時使用）'),
    globalLimitCurrency: currencyLinkSchema.optional().describe('全服累積金額上限（globalLimitType=amount 時使用），多幣別 stored 值'),
    guaranteedCount: z.number().int().min(0).optional().describe('保底次數，0 代表不保底'),
    slotPositions: z.array(z.number().int()).optional().describe('這個獎項顯示在轉盤上的哪些位置（位置索引陣列）'),
    progressKey: z.string().optional().describe('進度條 key（rewardType=progress 時**必填且不可為空**，後端 checkReward 會擋）'),
});

type PlainSlot = Record<string, unknown> & { id?: number };

/** 上傳一組多語系圖片並合併回既有值（每個檔案即時取一次新 token，不重複使用）。 */
async function uploadRouletteImages(
    label: string,
    channel: number,
    uploads: { code: string; filePath?: string; fileId?: string }[] | undefined,
    existing: { code?: string | null; value?: string | null }[] | undefined,
): Promise<{ merged: { code: string; value: string }[]; errors: string[] }> {
    const merged = (existing ?? []).map((l) => ({ code: l.code ?? '', value: l.value ?? '' }));
    const errors: string[] = [];
    if (!uploads || uploads.length === 0) return { merged, errors };

    for (const { code, filePath, fileId } of uploads) {
        if (filePath !== undefined && fileId !== undefined) { errors.push(`[${ label }:${ code }] 同時提供了 filePath 與 fileId，兩者二選一`); continue; }
        if (filePath === undefined && fileId === undefined) { errors.push(`[${ label }:${ code }] 缺少 filePath 或 fileId`); continue; }

        let resolvedFilePath: string;
        if (fileId !== undefined) {
            const identity = currentIdentityForFiles();
            if (identity === undefined) { errors.push(`[${ label }:${ code }] fileId 僅限 hosted 模式使用；目前是 stdio 連線，請改用 filePath`); continue; }
            const resolved = resolveFileIdForIdentity(fileId, identity);
            if (!resolved.found) { errors.push(`[${ label }:${ code }] fileId 無法使用（${ resolved.reason }）`); continue; }
            resolvedFilePath = resolved.path;
        } else {
            resolvedFilePath = filePath!;
        }

        const tokenR = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetUploadImageToken(channel));
        if (tokenR.failed || !tokenR.data?.token) {
            errors.push(`[${ label }:${ code }] 取得上傳 token 失敗：errorCode=${ tokenR.errorCode } ${ tokenR.message }`);
            continue;
        }
        const uploadR = await uploadFile(tokenR.data.token, resolvedFilePath);
        if (!uploadR.success) { errors.push(`[${ label }:${ code }] ${ uploadR.message }`); continue; }

        const idx = merged.findIndex((ls) => ls.code === code);
        if (idx !== -1) merged[ idx ] = { code, value: uploadR.path! };
        else merged.push({ code, value: uploadR.path! });
    }
    return { merged, errors };
}

/** 與後端 checkReward（roulette_common.ts:4-45）同一組規則，先在 tool 層擋下並給中文說明。 */
function checkSlots(slots: PlainSlot[]): string[] {
    const problems: string[] = [];
    if (slots.length === 0) return [ 'slots 不可為空：一個獎勵配置至少要有一個獎項格子' ];

    let hasLimit = false;
    let hasMiss = false;
    for (const slot of slots) {
        const label = `slot(id=${ slot.id ?? 'new' })`;
        const rewardType = slot.rewardType as number;
        const userLimitType = slot.userLimitType as number;
        const globalLimitType = slot.globalLimitType as number;
        const limited = userLimitType !== ROULETTE_REWARD_LIMIT_TYPE_MAP.unlimited || globalLimitType !== ROULETTE_REWARD_LIMIT_TYPE_MAP.unlimited;

        if (rewardType === ROULETTE_REWARD_TYPE_MAP.miss) {
            hasMiss = true;
            if (limited) problems.push(`${ label }：rewardType=miss（銘謝惠顧）不可設定任何個人/全服上限`);
        } else if (rewardType === ROULETTE_REWARD_TYPE_MAP.item) {
            if (userLimitType === ROULETTE_REWARD_LIMIT_TYPE_MAP.amount || globalLimitType === ROULETTE_REWARD_LIMIT_TYPE_MAP.amount) {
                problems.push(`${ label }：rewardType=item（道具）的上限不可用 amount（累積金額）型，只能用 unlimited 或 count`);
            }
        } else if (rewardType === ROULETTE_REWARD_TYPE_MAP.progress) {
            if (!slot.progressKey) problems.push(`${ label }：rewardType=progress（進度條）的 progressKey 不可為空`);
        } else if (rewardType !== ROULETTE_REWARD_TYPE_MAP.currency) {
            problems.push(`${ label }：rewardType 值不合法（只接受 currency/item/miss/progress）`);
        }

        if (limited) hasLimit = true;
    }
    if (hasLimit && !hasMiss) problems.push('只要有任何一個格子設了上限，整組 slots 就必須至少包含一個 rewardType=miss（銘謝惠顧）的格子');
    return problems;
}

export function registerCreateOrUpdateRouletteRewardTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_create_or_update_roulette_reward',
        {
            title: 'Create or update one roulette reward (獎勵配置), including its slots and images',
            description:
                '新增或更新一個轉盤獎勵配置，含四張轉盤圖片與全部獎項格子（rajah: ' +
                'RoulettePlatform.CreateOrUpdateRouletteReward，需要權限節點 BonusCenter.Lottery.RewardConfig；' +
                '圖片上傳內部走 RoulettePlatform.GetUploadImageToken + POST /upload）。' +
                '**帶 id = 更新既有配置，不帶 id = 新增一筆全新配置**。' +
                '⚠️ **本 domain 沒有任何刪除 API**：新建的獎勵配置與新建的格子都無法刪除，請確認真的要新增再呼叫。' +
                '⚠️ **refCount > 0 時後端拒絕修改**（有啟用中的轉盤設定正在引用它），本工具會先讀 refCount ' +
                '並在送出前擋下；要改請先用 switch_roulette_config_status 把引用它的轉盤設定停用。' +
                '⚠️ **後端是整包覆蓋、不做欄位合併**：本工具強制先用 get_roulette_reward_by_id 讀回現值再疊上你指定的欄位，' +
                '所以更新只要帶「要改的欄位」即可；**不要**繞過本工具直接組 payload 呼叫該 RPC。' +
                '⚠️ **slots 是疊加不是取代**：你傳的 slots 會依 slot id 逐欄合併到現有格子上，沒提到的格子原樣保留。' +
                '真的要移除某個格子必須用 removeSlotIds 明確指定——**而且移除只是解除關聯，那筆格子資料會變成永遠讀不到也刪不掉的孤兒列**。' +
                '⚠️ **後端不回傳新建的 id**（宣告有但實作沒設），新增時本工具用「寫入前後獎勵清單差集」推導 id（createdIdSource=diff）。' +
                '送出前本工具會用與後端 checkReward 相同的規則自行驗證：slots 不可為空、miss 格子不可設上限、' +
                'item 格子的上限不可用 amount 型、progress 格子的 progressKey 不可為空、只要有任一格設了上限就必須有一格是 miss。' +
                '所有金額/機率/倍率欄位都是 stored 原始值（非百分比、非顯示金額），probability 陣列 index 對應 VIP 等級。' +
                '寫入後一律 round-trip 讀回比對，結果放在 verification 欄位。',
            inputSchema: {
                id: z.number().int().min(1).optional().describe('要更新的獎勵配置 id；**省略代表新增一筆全新配置（無法刪除，請謹慎）**'),
                name: z.string().optional().describe('獎勵配置名稱（後端 @Rules "Required"）。新增時必填；更新時省略則沿用現值'),
                rouletteType: z.enum(ROULETTE_TYPE_KEYS).optional().describe('版面格式：sixPocketRoulette(6格)/eightPocketRoulette(8格)/tenPocketRoulette(10格)/fourteenPocketRoulette(14格)/wechatRedPacket(微信紅包)/nineGridRedPacket(九宮格紅包)。新增時必填'),
                backgroundImage: fileUploadSchema.optional().describe('背景圖，每個要更新的語系各帶一組 {code, filePath} 或 {code, fileId}；不帶則沿用既有值'),
                frameImage: fileUploadSchema.optional().describe('外框圖，格式同 backgroundImage'),
                bottomImage: fileUploadSchema.optional().describe('底盤圖，格式同 backgroundImage'),
                pointerImage: fileUploadSchema.optional().describe('指針圖，格式同 backgroundImage'),
                slots: z.array(slotSchema).optional().describe('要新增或修改的獎項格子。**疊加語意**：帶 id 的會合併到既有格子、沒帶 id 的是新增；沒提到的既有格子原樣保留。新增整個配置時必填'),
                removeSlotIds: z.array(z.number().int().min(1)).optional().describe('要從這個配置移除的格子 id。⚠️ 只是解除關聯，資料列會變成讀不到也刪不掉的孤兒，請謹慎使用'),
                confirm: z.string().optional().describe(`prod 環境專用的二次確認字串（非 prod 環境不需要）。需要時填入 ${ PROD_CONFIRM_TOKEN }`),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);
            const isUpdate = input.id !== undefined;

            // ---- 1. 讀現值（更新才有） ----
            let base: Record<string, unknown> = {};
            let baseSlots: PlainSlot[] = [];
            // 合併階段會用 Object.assign 就地改寫 mergedSlots 的元素，而 mergedSlots 是從 baseSlots
            // filter 出來的**同一批物件參照**——若拿 baseSlots 當事後比對基準，會比到已被改寫的值、
            // 永遠算出「沒有變更」。因此另外留一份深拷貝當唯一比對基準（2026-08-28 dev 實測抓到）。
            let baseSlotsSnapshot: PlainSlot[] = [];
            if (isUpdate) {
                const cur = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteRewardById(input.id!));
                if (cur.failed) return asErrorResult(cur, { hint: '讀取現值失敗，未執行任何寫入。errorCode=11 是 idNotExists（id 不存在或不屬於當前平台）' });
                if (!cur.data?.reward) return asTextResult({ success: false, message: `讀取 id=${ input.id } 的現值時後端回應成功但沒有內容，未執行任何寫入` });
                base = deepFixLongs(cur.data.reward) as Record<string, unknown>;
                baseSlots = ((base.slots as PlainSlot[]) ?? []).map((s) => ({ ...s }));
                baseSlotsSnapshot = JSON.parse(JSON.stringify(baseSlots)) as PlainSlot[];

                // refCount 前置檢查：後端 refCount>0 會回 rouletteRewardIdUsed，先給可行動的訊息。
                const listR = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteRewardList(1, 1, { id: input.id!, name: '', types: [] } as never));
                if (!listR.failed) {
                    const row = (listR.data?.rows ?? [])[0];
                    const refCount = row?.refCount ?? 0;
                    if (refCount > 0) {
                        return asTextResult({
                            success: false,
                            mode: 'update',
                            id: input.id,
                            refCount,
                            message: `這個獎勵配置目前被 ${ refCount } 個「啟用中」的轉盤設定引用，後端會拒絕修改（rouletteRewardIdUsed），未執行任何寫入。`
                                + '請先用 aladdin_platform_roulette_platform_get_roulette_config_list 找出引用它的設定，'
                                + '用 aladdin_platform_roulette_platform_switch_roulette_config_status 停用後再回來修改。',
                        });
                    }
                }
            }

            // ---- 2. 圖片上傳並合併 ----
            const uploadErrors: string[] = [];
            const bg = await uploadRouletteImages('backgroundImage', ROULETTE_UPLOAD_IMAGE_MAP.backgroundChannel, input.backgroundImage, base.backgroundImage as never);
            const fr = await uploadRouletteImages('frameImage', ROULETTE_UPLOAD_IMAGE_MAP.frameChannel, input.frameImage, base.frameImage as never);
            const bt = await uploadRouletteImages('bottomImage', ROULETTE_UPLOAD_IMAGE_MAP.bottomChannel, input.bottomImage, base.bottomImage as never);
            const pt = await uploadRouletteImages('pointerImage', ROULETTE_UPLOAD_IMAGE_MAP.pointerChannel, input.pointerImage, base.pointerImage as never);
            uploadErrors.push(...bg.errors, ...fr.errors, ...bt.errors, ...pt.errors);

            // ---- 3. slots 疊加合併 ----
            const removeIds = new Set(input.removeSlotIds ?? []);
            const mergedSlots: PlainSlot[] = baseSlots.filter((s) => !removeIds.has(s.id ?? 0));
            const notFoundRemoveIds = [ ...removeIds ].filter((id) => !baseSlots.some((s) => s.id === id));

            for (const patch of input.slots ?? []) {
                const target = patch.id ? mergedSlots.find((s) => s.id === patch.id) : undefined;
                if (patch.id && !target) {
                    uploadErrors.push(`slots 裡指定的 id=${ patch.id } 不屬於這個獎勵配置（或已被 removeSlotIds 移除）`);
                    continue;
                }
                const existing: PlainSlot = target ?? { id: 0 };
                const icon = await uploadRouletteImages(`slot(${ patch.id ?? 'new' }).icon`, ROULETTE_UPLOAD_IMAGE_MAP.slotIconChannel, patch.icon, existing.icon as never);
                uploadErrors.push(...icon.errors);

                const next: PlainSlot = {
                    ...existing,
                    id: patch.id ?? 0,
                    name: patch.name ?? (existing.name ?? ''),
                    icon: icon.merged,
                    guide: patch.guide ?? (existing.guide ?? []),
                    rewardType: patch.rewardType ? ROULETTE_REWARD_TYPE_MAP[ patch.rewardType ] : (existing.rewardType ?? ROULETTE_REWARD_TYPE_MAP.currency),
                    rewardCurrencyType: patch.rewardCurrencyType ? ROULETTE_REWARD_CURRENCY_TYPE_MAP[ patch.rewardCurrencyType ] : (existing.rewardCurrencyType ?? ROULETTE_REWARD_CURRENCY_TYPE_MAP.fixed),
                    currencyMin: patch.currencyMin ?? (existing.currencyMin ?? []),
                    currencyMax: patch.currencyMax ?? (existing.currencyMax ?? []),
                    wageringMultiplier: patch.wageringMultiplier ?? (existing.wageringMultiplier ?? 0),
                    itemId: patch.itemId ?? (existing.itemId ?? 0),
                    itemAmount: patch.itemAmount ?? (existing.itemAmount ?? 0),
                    itemExpireType: patch.itemExpireType ? ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP[ patch.itemExpireType ] : (existing.itemExpireType ?? ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP.none),
                    itemExpireTime: patch.itemExpireTime ?? (existing.itemExpireTime ?? 0),
                    probability: patch.probability ?? (existing.probability ?? []),
                    userLimitType: patch.userLimitType ? ROULETTE_REWARD_LIMIT_TYPE_MAP[ patch.userLimitType ] : (existing.userLimitType ?? ROULETTE_REWARD_LIMIT_TYPE_MAP.unlimited),
                    userLimitCount: patch.userLimitCount ?? (existing.userLimitCount ?? 0),
                    userLimitCurrency: patch.userLimitCurrency ?? (existing.userLimitCurrency ?? []),
                    globalLimitType: patch.globalLimitType ? ROULETTE_REWARD_LIMIT_TYPE_MAP[ patch.globalLimitType ] : (existing.globalLimitType ?? ROULETTE_REWARD_LIMIT_TYPE_MAP.unlimited),
                    globalLimitCount: patch.globalLimitCount ?? (existing.globalLimitCount ?? 0),
                    globalLimitCurrency: patch.globalLimitCurrency ?? (existing.globalLimitCurrency ?? []),
                    guaranteedCount: patch.guaranteedCount ?? (existing.guaranteedCount ?? 0),
                    slotPositions: patch.slotPositions ?? (existing.slotPositions ?? []),
                    progressKey: patch.progressKey ?? (existing.progressKey ?? ''),
                };
                if (target) Object.assign(target, next);
                else mergedSlots.push(next);
            }

            // ---- 4. 送出前檢查 ----
            const problems = [ ...uploadErrors ];
            if (notFoundRemoveIds.length > 0) problems.push(`removeSlotIds 裡的 ${ notFoundRemoveIds.join(',') } 不屬於這個獎勵配置`);
            const name = input.name ?? ((base.name as string) ?? '');
            if (!name) problems.push('name 是必填（後端 @Rules "Required"）');
            problems.push(...checkSlots(mergedSlots));
            if (problems.length > 0) {
                return asTextResult({ success: false, mode: isUpdate ? 'update' : 'create', message: '參數／上傳檢查未通過，未執行任何寫入', problems });
            }

            // ---- 5. 新增前記下既有 id（後端不回傳新建 id） ----
            let idsBefore: number[] = [];
            if (!isUpdate) {
                const nameListR = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRewardNameList());
                if (nameListR.failed) return asErrorResult(nameListR, { hint: '新增前取得既有獎勵清單失敗（用於事後推導新建 id），未執行任何寫入' });
                idsBefore = (nameListR.data?.rows ?? []).map((row) => row.id ?? 0);
            }

            // ---- 6. 寫入 ----
            const payload = RouletteRewardEdit.create({
                id: input.id ?? 0,
                name,
                rouletteType: input.rouletteType ? ROULETTE_TYPE_MAP[ input.rouletteType ] : ((base.rouletteType as number) ?? ROULETTE_TYPE_MAP.sixPocketRoulette),
                backgroundImage: bg.merged,
                frameImage: fr.merged,
                bottomImage: bt.merged,
                pointerImage: pt.merged,
                slots: mergedSlots,
            } as never);
            const w = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.CreateOrUpdateRouletteReward(payload));
            if (w.failed) {
                return asErrorResult(w, {
                    mode: isUpdate ? 'update' : 'create',
                    hint: 'rouletteRewardIdUsed 代表有啟用中的轉盤設定正在引用它；invalidData 通常是 checkReward 規則沒過（訊息內含後端原始英文說明）',
                });
            }

            // ---- 7. round-trip 驗證 ----
            let newId = input.id ?? 0;
            let createdIdSource: string | null = null;
            if (!isUpdate) {
                const nameListR = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRewardNameList());
                if (!nameListR.failed) {
                    const added = (nameListR.data?.rows ?? []).map((row) => row.id ?? 0).filter((id) => !idsBefore.includes(id));
                    if (added.length === 1) { newId = added[0]!; createdIdSource = 'diff'; }
                    else if (added.length > 1) { createdIdSource = `ambiguous(${ added.join(',') })`; }
                }
            }
            if (!newId) {
                return asTextResult({
                    success: true, mode: 'create', verified: false, createdId: null, createdIdSource,
                    message: '新增的 RPC 已成功回應，但無法推導出新建的 id（後端不回傳 id，且清單差集不唯一）。請用 aladdin_platform_roulette_platform_get_reward_name_list 自行確認。',
                });
            }

            const after = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteRewardById(newId));
            if (after.failed || !after.data?.reward) {
                return asTextResult({
                    success: true, mode: isUpdate ? 'update' : 'create', id: newId, createdIdSource, verified: false,
                    message: '寫入的 RPC 已成功回應，但回讀驗證失敗，請自行用 get_roulette_reward_by_id 覆核',
                    verifyError: after.failed ? { errorCode: after.errorCode, message: after.message } : null,
                });
            }

            const afterReward = deepFixLongs(after.data.reward) as Record<string, unknown>;
            const afterSlots = ((afterReward.slots as PlainSlot[]) ?? []);
            const changedTopLevel = [ 'name', 'rouletteType', 'backgroundImage', 'frameImage', 'bottomImage', 'pointerImage' ]
                .filter((k) => JSON.stringify(base[ k ] ?? null) !== JSON.stringify(afterReward[ k ] ?? null));
            const changedSlotIds = afterSlots
                .filter((s) => {
                    const b = baseSlotsSnapshot.find((x) => x.id === s.id);
                    return !b || JSON.stringify(b) !== JSON.stringify(s);
                })
                .map((s) => s.id);
            const droppedSlotIds = baseSlotsSnapshot.filter((b) => !afterSlots.some((s) => s.id === b.id)).map((b) => b.id);

            return asTextResult({
                success: true,
                mode: isUpdate ? 'update' : 'create',
                id: newId,
                createdIdSource,
                verified: true,
                verification: {
                    requestedFields: Object.keys(input).filter((k) => k !== 'id' && k !== 'confirm'),
                    changedTopLevelFields: isUpdate ? changedTopLevel : null,
                    changedSlotIds: isUpdate ? changedSlotIds : afterSlots.map((s) => s.id),
                    droppedSlotIds: isUpdate ? droppedSlotIds : [],
                    note: 'changedTopLevelFields / changedSlotIds 應該只包含你這次明確指定要改的部分；droppedSlotIds 非空代表有格子被解除關聯（變成刪不掉的孤兒列）',
                },
                after: {
                    ...afterReward,
                    rouletteType: numberToMapKey(ROULETTE_TYPE_MAP, (afterReward.rouletteType as number) ?? 0),
                    slots: afterSlots.map((s) => ({
                        ...s,
                        rewardType: numberToMapKey(ROULETTE_REWARD_TYPE_MAP, (s.rewardType as number) ?? 0),
                        rewardCurrencyType: numberToMapKey(ROULETTE_REWARD_CURRENCY_TYPE_MAP, (s.rewardCurrencyType as number) ?? 0),
                        itemExpireType: numberToMapKey(ROULETTE_REWARD_ITEM_EXPIRE_TYPE_MAP, (s.itemExpireType as number) ?? 0),
                        userLimitType: numberToMapKey(ROULETTE_REWARD_LIMIT_TYPE_MAP, (s.userLimitType as number) ?? 0),
                        globalLimitType: numberToMapKey(ROULETTE_REWARD_LIMIT_TYPE_MAP, (s.globalLimitType as number) ?? 0),
                    })),
                },
                deleteWarning: isUpdate ? null : '⚠️ 獎勵配置與獎項格子都沒有刪除 API，這筆新建的資料無法刪除',
            });
        },
    );
}
