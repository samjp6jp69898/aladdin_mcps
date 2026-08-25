/**
 * tools/create_or_update_item.ts — aladdin_platform_inventory_platform_create_or_update_item
 *
 * rajah: InventoryPlatform.CreateOrUpdateItem（inventory_back_office.rajah:433，upsert 語意）
 *
 * 對應前端頁面：「商城」→「道具」（abu/platform/src/pages/uncategorized/ItemList.vue），
 * StoreItemModel.updateOrCreate() 直接送出完整 ItemEdit，不做欄位級 partial 判斷——
 * 後端也是同樣行為（見下段「整包覆蓋」）。
 *
 * **id>0=更新 / id 未帶或 0=新增**（agrabah inventory_platform.ts:92-113）：
 * - 更新時後端會先 loadObject 撈現有列，**category 不可變更**（帶了不同的 category 會回
 *   invalidItemCategory），本工具在呼叫前先做同樣檢查提早攔下、給更明確的錯誤訊息。
 * - 新增時後端強制 status=enabled（StatusEnum 的整體啟用/停用另有獨立的
 *   UpdateItemStatus method，不在這支 tool 的職責內，ItemEdit.status 本身也標了
 *   @NoEdit，不開放這裡編輯）。
 *
 * **commonDetail/depositWithdrawDetail 是整包覆蓋，不是欄位級 partial merge**
 * （2026-08-25 讀 agrabah 原始碼證實，非猜測）：`ItemDetailBase.setValidDetailByItem`
 * （servers/inventory_back_office/logics/item_detail_base.ts:49-61）與
 * `DepositAndWithdrawCoupon.setValidDetailByItem`（item_deposit_and_withdraw_detail.ts:25-37）
 * 都是直接用「本次請求帶的巢狀物件」重建一個全新的 DB detail 物件，**沒有先讀舊值合併**——
 * 跟 ItemEdit 頂層欄位（`dbItem.from(item)` 全欄位覆蓋）是同一種語意。所以本工具遵照
 * method-category-checklist.md 第 4 節「先讀現值、只覆寫要改欄位」的通用要求，在欄位層級
 * （含 commonDetail/depositWithdrawDetail 內部）做合併，呼叫端不需要每次都帶完整巢狀物件。
 *
 * **category 決定要不要帶 commonDetail 或 depositWithdrawDetail，兩者互斥、不會同時處理**
 * （ItemDetailLogic.getLogic 依 category 只挑一個 logic class，
 * agrabah servers/inventory_back_office/logics/index.ts:18-28）：
 * - roomGift / roomGuardGift：commonDetail 必填 lottie（動畫圖示）+ lottieDuration（>0）。
 * - roomGuard：commonDetail 必填 timeLimit（正整數），不需要 lottie。
 * - lotteryTicket：commonDetail 必填 lotteryId（正整數，對應既有抽獎機，本 POC 未提供查詢 tool）。
 * - messageBoardGift / rename / broadcast：**不需要**、也不會用到 commonDetail 或
 *   depositWithdrawDetail（EmptyItemDetail，帶了會被忽略）。
 * - depositAndWithdrawCoupon：depositWithdrawDetail 必填 paymentType/paymentMethodId +
 *   discountMode，並依 discountMode 決定要填 discountAmount 還是 discountPercent+discountMax，
 *   wageringMultiplier 一律必填；這些金額欄位是 CurrencyLink[]（每個幣別代碼各一筆），
 *   本工具原樣透傳、不做「必須涵蓋全部啟用幣別」的預先檢查，交由後端驗證。
 * - **realStuff（實體道具）結構性不可用**：agrabah 的 ItemDetailLogicClasses 沒有對應的
 *   logic class（agrabah servers/inventory_back_office/logics/index.ts:18-28
 *   註解掉的 `RealStuff` class 從未接上），呼叫必定回 invalidItemCategory，這不是本工具的
 *   限制，是後端目前就不支援，因此本工具的 category 列舉不收錄 realStuff。
 * - **roomMount 同樣不收錄在本工具的 category 列舉——這是獨立審查（2026-08-25 fable5
 *   reviewer-b）發現、經本檔作者讀原始碼複驗證實的後端既有 bug**：
 *   `RoomMount.validateOtherDetail()`（agrabah logics/item_common_detail.ts:75-91）第一行呼叫
 *   `super.validate()`，而 `ItemDetailBase.validate()`（logics/item_detail_base.ts:99-105）
 *   末行呼叫 `this.validateOtherDetail()`——`this` 動態綁定回 `RoomMount` 實例，兩者互相呼叫
 *   形成同步無窮遞迴，帶 category=roomMount 呼叫 CreateOrUpdateItem 必定 stack overflow。
 *   前端 2026-08-05 起隱藏 roomMount（StoreItemModel.ts:192）所以從未被踩到；這是後端 bug，
 *   不是本工具能修的範圍，回報給操作者知悉即可，工具本身直接排除這個選項避免 agent 誤觸。
 * - 目前 abu/platform 前端 UI 只開放 unknown（請選擇）/roomGift/messageBoardGift/lotteryTicket
 *   四種（2026-08-05 業務裁定隱藏其餘類別，StoreItemModel.ts:191-193），其餘類別
 *   （roomGuardGift/roomGuard/rename/broadcast/depositAndWithdrawCoupon）
 *   後端結構上仍支援、本工具也開放呼叫，但沒有對應的後台頁面可以核對結果，
 *   使用前建議先跟操作者確認業務上是否真的要透過非 UI 路徑建立這類道具。
 *
 * **權限節點缺口（如實揭露，非本工具問題）**：CreateOrUpdateItem 這支 RPC 在 rajah
 * 沒有掛 `@Permission`（inventory_back_office.rajah:431 的 `# @Permission "Store"`
 * 是註解，不生效；`Store.Item.Create`/`Store.Item.Ops.Edit` 是純前端 Placeholder 節點，
 * 後端 RPC 層未做集中權限攔截，2026-08-25 讀 agrabah 生成碼與 rajah 源檔證實）。
 *
 * **icon/lottie 上傳**：都是「每個語言各自一個檔案」，icon 走
 * GetUploadItemImageToken、lottie 走 GetUploadLottieToken（兩支不同 token，
 * 不可混用）。icon 支援 {code, filePath} stdio / {code, fileId} hosted 二選一，與
 * onboard_vendor_game.ts 完全同構；**lottie 目前只支援 stdio 模式的 {code, filePath}**——
 * hosted 模式的 `POST /files` 端點型別白名單只接受 png/jpeg/webp（magic bytes 判定，
 * files.ts:72-97/152），lottie 是 JSON 動畫檔，連取得 fileId 這一步都會被拒絕，
 * 結構上無法用於 hosted（2026-08-25 fable5 reviewer-b 發現、複驗證實），schema 已排除
 * lottie 的 fileId 欄位。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ItemEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, ITEM_CATEGORY_MAP, PAYMENT_TYPE_MAP, DISCOUNT_MODE_MAP, formatCurrencyLinks } from '../const.ts';

const DEPOSIT_WITHDRAW_CURRENCY_FIELDS = [ 'discountAmount', 'discountPercent', 'discountMax', 'paymentMin', 'paymentMax', 'wageringMultiplier' ] as const;

/**
 * ListItems 回傳的道具列，depositWithdrawDetail 內的 CurrencyLink[].value 是 i64
 * （decode 後為 Long 物件，見 const.ts toPlainNumber 註解），逐筆轉成一般數字再回給 agent。
 * list_items.ts 的回傳也共用這支，確保兩邊格式一致。
 */
export function formatItemRow(row: Record<string, unknown>): Record<string, unknown> {
    const detail = row.depositWithdrawDetail as Record<string, unknown> | undefined;
    if (!detail) return row;
    const formattedDetail = { ...detail };
    for (const field of DEPOSIT_WITHDRAW_CURRENCY_FIELDS) formattedDetail[ field ] = formatCurrencyLinks(detail[ field ]);
    return { ...row, depositWithdrawDetail: formattedDetail };
}

const LIST_PAGE_SIZE = 200;
const LIST_SCAN_PAGE_CAP = 20; // method-category-checklist.md 第 2 節 B 級要求：總掃描上限 20 頁 × 200 筆 = 4000 筆

const statusToggle = z.enum([ 'enabled', 'disabled' ]);

const localizedTextSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的文字值'),
})).optional();

const currencyLinkSchema = z.array(z.object({
    code: z.string().describe('幣別代碼，例如 CNY、USD'),
    value: z.number().describe('該幣別下的金額（後端實際儲存值，本工具不做單位換算）'),
})).optional();

// H9 同構：filePath（stdio）/ fileId（hosted）二選一，見 onboard_vendor_game.ts 同名 schema 的註解。
const fileUploadSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    filePath: z.string().optional().describe('stdio 模式專用：本機檔案絕對路徑，與 fileId 二選一'),
    fileId: z.string().optional().describe('hosted 模式專用：先呼叫 POST /files 上傳取得，與 filePath 二選一'),
})).optional();

/**
 * lottie 專用：只開放 filePath（stdio），不開放 fileId——hosted 模式的 `POST /files`
 * 型別白名單只接受 png/jpeg/webp（magic bytes 判定，files.ts:72-97/152），lottie 是
 * JSON 動畫檔，連取得 fileId 這一步都會被拒絕，結構上不可能透過 hosted 模式上傳。
 */
const lottieUploadSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    filePath: z.string().describe('本機 lottie JSON 檔案絕對路徑（僅支援 stdio 模式，hosted 模式結構上無法上傳此類型檔案）'),
})).optional();

function mergeLocalizedStrings(
    entries: { code: string; value: string }[] | undefined,
    existing: { code: string; value: string }[] | undefined,
): { code: string; value: string }[] {
    const merged = [ ...(existing ?? []) ];
    if (!entries) return merged;
    for (const { code, value } of entries) {
        const idx = merged.findIndex((ls) => ls.code === code);
        if (idx !== -1) merged[ idx ] = { code, value };
        else merged.push({ code, value });
    }
    return merged;
}

/** 依 tokenFetcher（GetUploadItemImageToken 或 GetUploadLottieToken）上傳一組多語系檔案並合併回既有值。 */
async function uploadLocalizedFiles(
    label: string,
    uploads: { code: string; filePath?: string; fileId?: string }[] | undefined,
    existing: { code: string; value: string }[] | undefined,
    getToken: () => Promise<{ failed: boolean; errorCode: number; message: string; data: { token: string } | null }>,
): Promise<{ merged: { code: string; value: string }[]; errors: string[] }> {
    const merged = [ ...(existing ?? []) ];
    const errors: string[] = [];
    if (!uploads || uploads.length === 0) return { merged, errors };

    for (const { code, filePath, fileId } of uploads) {
        if (filePath !== undefined && fileId !== undefined) {
            errors.push(`[${ label }:${ code }] 同時提供了 filePath 與 fileId，兩者二選一`);
            continue;
        }
        if (filePath === undefined && fileId === undefined) {
            errors.push(`[${ label }:${ code }] 缺少 filePath 或 fileId`);
            continue;
        }

        let resolvedFilePath: string;
        if (fileId !== undefined) {
            const identity = currentIdentityForFiles();
            if (identity === undefined) {
                errors.push(`[${ label }:${ code }] fileId 僅限 hosted 模式使用；目前是 stdio 連線，請改用 filePath`);
                continue;
            }
            const resolved = resolveFileIdForIdentity(fileId, identity);
            if (!resolved.found) {
                errors.push(`[${ label }:${ code }] fileId 無法使用（${ resolved.reason }）`);
                continue;
            }
            resolvedFilePath = resolved.path;
        } else {
            resolvedFilePath = filePath!;
        }

        const tokenR = await getToken();
        if (tokenR.failed || !tokenR.data?.token) {
            errors.push(`[${ label }:${ code }] 取得上傳 token 失敗：errorCode=${ tokenR.errorCode } ${ tokenR.message }`);
            continue;
        }

        const uploadR = await uploadFile(tokenR.data.token, resolvedFilePath);
        if (!uploadR.success) {
            errors.push(`[${ label }:${ code }] ${ uploadR.message }`);
            continue;
        }

        const idx = merged.findIndex((ls) => ls.code === code);
        if (idx !== -1) merged[ idx ] = { code, value: uploadR.path };
        else merged.push({ code, value: uploadR.path });
    }

    return { merged, errors };
}

/**
 * ListItemsSearch 沒有 id 篩選欄位，找既有道具只能逐頁掃描比對 id（比照 upsert_game.ts 的
 * findGameRowByBusinessKey）。export 供 list_items 領域內其他需要「先讀現值」的 tool
 * （如 update_item_status.ts）共用，不重新發明一套。
 */
export async function findItemById(id: number) {
    let totalPage = 1;
    let scannedPages = 0;
    for (let page = 1; page <= Math.min(totalPage, LIST_SCAN_PAGE_CAP); page++) {
        const search = { category: 0, name: '', status: 0 };
        const listR = await withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.ListItems(search as never, page, LIST_PAGE_SIZE));
        if (listR.failed) return { listR, matchedRow: undefined, scannedPages } as const;
        scannedPages++;
        totalPage = listR.data?.totalPage ?? 1;
        const matchedRow = listR.data?.rows?.find((row) => row.id === id);
        if (matchedRow) return { listR: undefined, matchedRow, scannedPages } as const;
    }
    return { listR: undefined, matchedRow: undefined, scannedPages, hitScanCap: totalPage > LIST_SCAN_PAGE_CAP } as const;
}

export function registerCreateOrUpdateItemTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_inventory_platform_create_or_update_item',
        {
            title: 'Create or update a store item (upsert)',
            description:
                '新增或編輯「商城 → 道具」的一筆道具（rajah: InventoryPlatform.CreateOrUpdateItem，upsert 語意）。' +
                'id 未帶或帶 0 → 新增；id>0 → 更新（會先確認該 id 存在，且 category 不可與既有值不同，' +
                '否則直接回錯誤，不會呼叫後端）。' +
                'commonDetail/depositWithdrawDetail 在後端是整包覆蓋語意（沒有先讀舊值合併），本工具已在呼叫前' +
                '自動讀現值並合併你有帶的欄位，沒帶的欄位維持原值，你不需要每次都帶完整巢狀物件。' +
                'category 決定要不要帶 commonDetail 或 depositWithdrawDetail、兩者互斥：' +
                'roomGift/roomGuardGift 需要 commonDetail.lottie+lottieDuration；' +
                'roomGuard 只需要 commonDetail.timeLimit；' +
                'lotteryTicket 需要 commonDetail.lotteryId；' +
                'messageBoardGift/rename/broadcast 不需要任何 detail；' +
                'depositAndWithdrawCoupon 需要 depositWithdrawDetail（paymentType/paymentMethodId/discountMode 必填，' +
                '依 discountMode 決定填 discountAmount 或 discountPercent+discountMax，wageringMultiplier 必填，' +
                '這些都是「每個幣別代碼各一筆」的 CurrencyLink 陣列，本工具不預先檢查是否涵蓋全部啟用幣別，交由後端驗證）。' +
                'unknown/realStuff/roomMount 這三個 category 值不在選項內：unknown/realStuff 是後端沒有對應實作，呼叫必定回 ' +
                'invalidItemCategory；roomMount 是後端既有 bug（RoomMount 的驗證邏輯與共用基底類別互相呼叫形成無窮遞迴，帶這個值' +
                '呼叫必定 stack overflow），三者皆非本工具限制，是後端目前的真實狀態。' +
                '目前前端 UI 只開放 roomGift/messageBoardGift/lotteryTicket 三種（2026-08-05 業務裁定隱藏其餘），' +
                '其餘類別後端仍支援但沒有對應頁面可核對，使用前建議先與操作者確認業務需求。' +
                'icon 走 GetUploadItemImageToken，支援每個語言各帶一組 {code, filePath}（stdio）或 {code, fileId}（hosted）二選一；' +
                'commonDetail.lottie 走 GetUploadLottieToken，**只支援 {code, filePath}（stdio）**——hosted 模式的 POST /files ' +
                '型別白名單只接受 png/jpeg/webp，lottie 是 JSON 動畫檔，結構上無法透過 hosted 模式上傳。' +
                '完成後會自動讀回最新資料（逐頁掃描比對 id）一併回傳以便核對。' +
                'prod 執行前確認（H38 同構機制）：正式環境需先用 AskUserQuestion 取得使用者明確同意才可帶 confirm 參數。',
            inputSchema: {
                id: z.number().int().min(0).optional().describe('道具 id；未帶或 0 表示新增，>0 表示更新既有道具'),
                category: z.enum(Object.keys(ITEM_CATEGORY_MAP) as [ keyof typeof ITEM_CATEGORY_MAP ]).describe(
                    '道具類別（新增時必填；更新時若帶了與既有值不同的類別會被拒絕——後端不允許變更類別）。' +
                    'unknown/realStuff/roomMount 不在選項內，見上方 description 的說明',
                ),
                backpackVisible: statusToggle.optional().describe('是否在背包顯示；不帶則沿用既有值（新增時必填，因為沒有既有值可沿用）'),
                name: localizedTextSchema.describe('道具名稱，每個要更新的語言各帶一組 {code, value}，不帶則沿用既有值'),
                description: localizedTextSchema.describe('道具說明（富文本），格式同 name'),
                icon: fileUploadSchema.describe('道具圖示，每個要更新的語言各帶一組 {code, filePath} 或 {code, fileId}，不帶則沿用既有值'),
                commonDetail: z.object({
                    lottieDuration: z.number().int().optional().describe('動畫圖示時長（roomGift/roomGuardGift 必填，需 >0）'),
                    lottie: lottieUploadSchema.describe('動畫圖示檔案，每個要更新的語言各帶一組 {code, filePath}（只支援 stdio），走 GetUploadLottieToken（roomGift/roomGuardGift 必填）'),
                    timeLimit: z.number().int().positive().optional().describe('時效天數（roomGuard 必填，正整數）'),
                    guardInterval: z.number().int().optional().describe('守護時長'),
                    lotteryId: z.number().int().positive().optional().describe('抽獎機 id（lotteryTicket 必填，正整數，對應既有抽獎機，本 POC 未提供查詢 tool）'),
                }).optional().describe('一般細項設定，只有 roomGift/roomGuardGift/roomGuard/lotteryTicket 需要，見上方分類說明'),
                depositWithdrawDetail: z.object({
                    paymentType: z.enum(Object.keys(PAYMENT_TYPE_MAP) as [ keyof typeof PAYMENT_TYPE_MAP ]).optional().describe('支付類型：deposit=充值、withdraw=提現（必填）'),
                    paymentMethodId: z.number().int().min(0).optional().describe('支付方法 id（必填）'),
                    paymentChannelId: z.number().int().min(0).optional().describe('支付通道 id'),
                    discountMode: z.enum(Object.keys(DISCOUNT_MODE_MAP) as [ keyof typeof DISCOUNT_MODE_MAP ]).optional().describe('優惠方式：bonus=固定金額、percent=百分比（必填）'),
                    discountAmount: currencyLinkSchema.describe('優惠金額（discountMode=bonus 時使用）'),
                    discountPercent: currencyLinkSchema.describe('優惠百分比（discountMode=percent 時使用）'),
                    discountMax: currencyLinkSchema.describe('最高優惠上限（discountMode=percent 時使用）'),
                    paymentMin: currencyLinkSchema.describe('支付最小限額'),
                    paymentMax: currencyLinkSchema.describe('支付最大限額'),
                    wageringMultiplier: currencyLinkSchema.describe('稽核倍率（必填）'),
                }).optional().describe('充提細項設定，只有 depositAndWithdrawCoupon 需要，見上方分類說明'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);
            const id = input.id ?? 0;

            let base: Record<string, unknown> | undefined;
            if (id > 0) {
                const found = await findItemById(id);
                if (found.listR?.failed) return asErrorResult(found.listR);
                if (!found.matchedRow) {
                    return asTextResult({
                        success: false,
                        message: `找不到 id=${ id } 的既有道具（已掃描 ${ found.scannedPages } 頁${ found.hitScanCap ? '，已觸及掃描上限' : '' }）`,
                    });
                }
                base = found.matchedRow as Record<string, unknown>;
                if (input.category !== undefined && ITEM_CATEGORY_MAP[ input.category ] !== base.category) {
                    return asTextResult({
                        success: false,
                        message: `不可變更道具類別：既有類別為 ${ base.category }（數值），帶入的 category="${ input.category }" 不同，後端會拒絕此操作`,
                    });
                }
            } else if (input.category === undefined || input.backpackVisible === undefined) {
                return asTextResult({ success: false, message: '新增道具時 category 與 backpackVisible 皆為必填' });
            }

            const iconResult = await uploadLocalizedFiles(
                'icon', input.icon, base?.icon as { code: string; value: string }[] | undefined,
                () => withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.GetUploadItemImageToken()),
            );
            const baseCommonDetail = base?.commonDetail as Record<string, unknown> | undefined;
            const lottieResult = await uploadLocalizedFiles(
                'lottie', input.commonDetail?.lottie, baseCommonDetail?.lottie as { code: string; value: string }[] | undefined,
                () => withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.GetUploadLottieToken()),
            );
            const uploadErrors = [ ...iconResult.errors, ...lottieResult.errors ];
            if (uploadErrors.length > 0) {
                return asTextResult({ success: false, message: '部分檔案上傳失敗，未送出任何更新（避免部分寫入）', errors: uploadErrors });
            }

            const commonDetailOverrides: Record<string, unknown> = {};
            if (input.commonDetail) {
                const { lottie: _lottie, ...rest } = input.commonDetail;
                for (const [ k, v ] of Object.entries(rest)) if (v !== undefined) commonDetailOverrides[ k ] = v;
                commonDetailOverrides.lottie = lottieResult.merged;
            }
            const mergedCommonDetail = input.commonDetail
                ? { ...(baseCommonDetail ?? {}), ...commonDetailOverrides }
                : baseCommonDetail;

            const baseDepositDetail = base?.depositWithdrawDetail as Record<string, unknown> | undefined;
            let mergedDepositDetail: Record<string, unknown> | undefined = baseDepositDetail;
            if (input.depositWithdrawDetail) {
                const { paymentType, discountMode, discountAmount, discountPercent, discountMax, paymentMin, paymentMax, wageringMultiplier, ...rest } = input.depositWithdrawDetail;
                const overrides: Record<string, unknown> = {};
                for (const [ k, v ] of Object.entries(rest)) if (v !== undefined) overrides[ k ] = v;
                if (paymentType !== undefined) overrides.paymentType = PAYMENT_TYPE_MAP[ paymentType ];
                if (discountMode !== undefined) overrides.discountMode = DISCOUNT_MODE_MAP[ discountMode ];
                if (discountAmount !== undefined) overrides.discountAmount = discountAmount;
                if (discountPercent !== undefined) overrides.discountPercent = discountPercent;
                if (discountMax !== undefined) overrides.discountMax = discountMax;
                if (paymentMin !== undefined) overrides.paymentMin = paymentMin;
                if (paymentMax !== undefined) overrides.paymentMax = paymentMax;
                if (wageringMultiplier !== undefined) overrides.wageringMultiplier = wageringMultiplier;
                mergedDepositDetail = { ...(baseDepositDetail ?? {}), ...overrides };
            }

            const merged = ItemEdit.create({
                ...(base ?? {}),
                id,
                category: input.category !== undefined ? ITEM_CATEGORY_MAP[ input.category ] : (base?.category as never),
                backpackVisible: input.backpackVisible !== undefined ? STATUS_MAP[ input.backpackVisible ] : (base?.backpackVisible as never),
                name: input.name !== undefined ? mergeLocalizedStrings(input.name, base?.name as never) : (base?.name as never),
                description: input.description !== undefined ? mergeLocalizedStrings(input.description, base?.description as never) : (base?.description as never),
                icon: iconResult.merged,
                commonDetail: mergedCommonDetail,
                depositWithdrawDetail: mergedDepositDetail,
            });

            const upsertR = await withAutoRelogin(() => remote.inventoryBackOffice.inventoryPlatform.CreateOrUpdateItem(merged));
            if (upsertR.failed) return asErrorResult(upsertR);

            if (id > 0) {
                const check = await findItemById(id);
                if (check.listR?.failed) {
                    return asTextResult({
                        success: true,
                        message: `道具已更新，但讀回驗證失敗（errorCode=${ check.listR.errorCode } ${ check.listR.message }），無法確認寫入結果`,
                        item: null,
                    });
                }
                const formattedItem = check.matchedRow ? formatItemRow(check.matchedRow as Record<string, unknown>) : null;
                return asTextResult({ success: true, message: '道具已更新', item: formattedItem });
            }

            // rajah CreateOrUpdateItem 沒有回傳值（Empty response），新增時後端不會告知新 id，
            // 無法在這裡做 round-trip 驗證；如需確認請另外呼叫 aladdin_platform_inventory_platform_list_items
            // 依 category/name 查詢剛新增的道具。
            return asTextResult({ success: true, message: '道具已新增（rajah 未回傳新 id，如需核對請用 list_items 依 category/name 查詢）' });
        },
    );
}
