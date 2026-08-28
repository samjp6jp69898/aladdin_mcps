/**
 * tools/create_or_update_live_category.ts — aladdin_platform_live_platform_create_or_update_live_category
 *
 * rajah: LivePlatform.CreateOrUpdateLiveCategory(liveCategory LiveCategoryEdit 1)（無回傳值）
 * （rajah/services/live_back_office.rajah:74；LiveCategoryEdit 定義於同檔 24-40 行；
 * client 路徑 remote.liveBackOffice.livePlatform）。
 *
 * 本工具內部另外會呼叫 `LivePlatform.GetLiveCategories`（讀現值 + round-trip）與
 * `LivePlatform.GetUploadImageToken`（:81，換圖時才呼叫）。依 tool-naming-convention.md
 * 「一支 tool 內部呼叫多支 method（Get 讀現值 + 另一支 method 寫入）用寫入的那一支命名」，
 * 對外身分就是 `create_or_update_live_category`。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、service 無 `@NoPublic`、
 * agrabah 對應實作是真實 override（agrabah/src/servers/live_back_office/services/
 * live_platform.ts:237-280，methodCreateOrUpdateLiveCategory），非 base class 的 notImplemented。
 * 權限現況見 get_live_tabs.ts 檔頭（`Live*` 整族權限節點在 rajah 全被註解掉），不重複。
 *
 * 分類：第 4 節「Upsert / CreateOrUpdate」為主，第 8 節「敏感資料 / 憑證 / PII 類」中的
 * 「上傳/建立用 token 類」那一條為輔（換圖時）。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * ⚠️ 最重要的一件事：**不把 `status` 一起帶回去，會把它歸零**
 * ══════════════════════════════════════════════════════════════════════════
 * 這正是 method-category-checklist.md 第 4 節模式 2 點名的「`assignKey` 數字欄位地雷」，
 * 而且本 method 是真的踩得到（2026-08-28 逐層讀 source 確認的完整鏈路）：
 *
 * 1. 後端 update 分支用 `DbLiveCategory.create(liveCategory)`（live_platform.ts:243）建出要寫入的
 *    ORM 物件，`create` → `from()` → 對每個欄位呼叫 `assignKey`
 *    （agrabah/src/database_types/base.ts:6-17、19-23、26-31）。
 * 2. `assignKey` 的條件是
 *    `if ((source.hasOwnProperty(key) && source[key] !== null) || source[key] === 0)`。
 *    protobufjs 解碼出來的 message，**沒帶到的欄位不是 own property、而是讀到 prototype 上的
 *    型別預設值**：字串是 `''`、數字/enum 是 `0`。
 *    - 字串欄位（icon/background/squareImage/bannerImage）：`hasOwnProperty` 為 false 且
 *      `'' === 0` 也是 false → **不會**被指派 → 維持 undefined。
 *    - 數字欄位（status）：`source.status === 0` 為 **true** → **會**被指派成 0。
 * 3. `updateObject(dbLiveCategory, false)`
 *    （agrabah/src/engines/relational_database/mysql/mysql_relational_database_engine.ts:206-243）
 *    只跳過 `undefined` 的欄位，`0` 是有效值 → `status` 被寫成 0（unknown）。
 *
 * 也就是說：只想改名稱、沒帶 status 的呼叫，會**順手把這個分類的狀態改成 unknown(0)**。
 * 本工具因此一律把讀到的現值 `status` 原樣帶回去，並且**不開放 status 當作輸入參數**——
 * 要啟停請用 `aladdin_platform_live_platform_update_live_category_status`（`status` 在 rajah
 * 上本來就標 `@Readonly`，本 method 不是設計來改狀態的）。
 * 這條在 create 分支不成立：後端在 insert 前顯式 `dbLiveCategory.status = StatusEnum.enabled`
 * （:259），新建的分類必定是 enabled。
 *
 * **這不是紙上推論，2026-08-28 已在 dev 用原始 RPC 做過負面驗證**：對本輪自建的測試分類
 * id=1007（當時 status=1）送出一個「只帶 id + name、不帶 status」的 `LiveCategoryEdit`，
 * RPC 回 errorCode=0（成功），讀回後 `status` 變成 **0**。驗證完立刻用
 * `UpdateLiveCategoryStatus(1007, enabled)` 復原成 1。透過本工具做同一件事（只帶 name）則
 * 讀回 status 仍是 1——地雷確實存在，且確實被本工具擋住。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 其他已查證的後端行為
 * ══════════════════════════════════════════════════════════════════════════
 * - **跨平台防護**：update 前先 `SELECT id FROM live_categories WHERE id = ? AND platform_id = ?`
 *   （:248），查不到回 `objectNotFound`（errorCode=14）。本工具另外會先用 GetLiveCategories
 *   擋一次，不存在的 id 根本不送 RPC。
 * - **name 是逐語系合併不是覆蓋**：走 `LocalizationManager.updateById`
 *   （agrabah/src/managers/localization_manager.ts:61-64），逐語系 UPDATE、找不到才 INSERT，
 *   沒帶到的語系原樣保留。傳空陣列等於不動。
 * - **四個圖片欄位是單一字串**（不是多語陣列，與直播頁籤的 icon 相反），沒帶時依上面第 2 點
 *   不會被覆蓋；本工具仍一律把現值原樣帶回，讓「先讀現值只覆蓋要改欄位」這件事不依賴
 *   protobuf 稀疏編碼的細節成立。
 * - **後端 audit 記錯 action（既有 bug，不影響資料正確性）**：create 分支把 actionId 設成
 *   `AdminActionIdEnum.liveTabCreate`（:266），但 `liveCategoryCreate = 1111` 其實是存在的
 *   （agrabah/src/generated/services.gen.ts:17632）。所以「新增直播分類」在稽核紀錄裡會被記成
 *   「新增直播頁籤」。這是後端的既有 bug，本工具無法在呼叫端修正，只能如實告知。
 * - **沒有任何 delete method**：建立出來的分類刪不掉，只能用
 *   `aladdin_platform_live_platform_update_live_category_status` 停用。
 *
 * ══════════════════════════════════════════════════════════════════════════
 * 圖片欄位（第 8 節「上傳/建立用 token 類」）
 * ══════════════════════════════════════════════════════════════════════════
 * 四個圖片欄位存的是後端檔案路徑（如 `/static/live/xxxx`），不是任意字串。本工具每個圖片欄位
 * 都接受三選一：
 * - `path`：直接指定一個既有路徑（例如從 GetLiveCategories 讀到的值）。
 * - `filePath`：stdio 模式，本機圖片絕對路徑，由本工具負責上傳。
 * - `fileId`：hosted 模式，先 `POST /files` 拿到的 fileId。
 * 後兩者會走 `GetUploadImageToken(type)` 取得單次性 token 再 `uploadFile()` 上傳，
 * 型別分別對應 `LiveUploadImageEnum` 的 categoryIcon=2 / categoryBackground=3 /
 * categorySquareImage=4 / categoryBannerImage=5（rajah:16-22）。token 是一次性的，
 * 每張圖各自取一次、不重用（比照 create_home_page_popup.ts 的既有作法）。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { LiveCategoryEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    LIVE_UPLOAD_IMAGE_TYPE, liveImageInputSchema, resolveLiveImagePath, type LiveImageInput,
} from './live_image_upload.ts';

/** 本檔用到的四個分類圖片欄位，對應 LiveUploadImageEnum 的四個值（見 live_image_upload.ts）。 */
const CATEGORY_IMAGE_TYPE = {
    icon: LIVE_UPLOAD_IMAGE_TYPE.categoryIcon,
    background: LIVE_UPLOAD_IMAGE_TYPE.categoryBackground,
    squareImage: LIVE_UPLOAD_IMAGE_TYPE.categorySquareImage,
    bannerImage: LIVE_UPLOAD_IMAGE_TYPE.categoryBannerImage,
} as const;
type CategoryImageField = keyof typeof CATEGORY_IMAGE_TYPE;

const localizedTextSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的分類名稱'),
}));

function mergeLocalizedStrings(
    entries: { code: string; value: string }[] | undefined,
    existing: { code?: string | null; value?: string | null }[] | null | undefined,
): { code: string; value: string }[] {
    const merged = (existing ?? []).map((ls) => ({ code: ls.code ?? '', value: ls.value ?? '' }));
    if (!entries) return merged;

    for (const { code, value } of entries) {
        const idx = merged.findIndex((ls) => ls.code === code);
        if (idx !== -1) merged[ idx ] = { code, value };
        else merged.push({ code, value });
    }

    return merged;
}

export function registerCreateOrUpdateLiveCategoryTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_live_platform_create_or_update_live_category',
        {
            title: 'Create or update one live-stream category on this platform',
            description:
                '新增或修改本平台的一個直播分類（rajah: LivePlatform.CreateOrUpdateLiveCategory），對應' +
                '後台「直播管理 > 直播分類」的編輯彈窗。不帶 id（或 id=0）表示新增，帶既有 id 表示修改。' +
                '修改時本工具會先呼叫 GetLiveCategories 讀現值，只覆蓋你有帶到的欄位，其餘原樣帶回；' +
                'id 不存在時先擋下、不送出 RPC。' +
                '⚠️ **這支 RPC 有一個會誤傷資料的後端行為，本工具已代為擋掉**：後端建 ORM 物件時，' +
                '對「沒帶到的數字欄位」會把 protobuf 預設值 0 當成有效值寫進 DB，因此如果只帶 name ' +
                '就呼叫，這個分類的 status 會被順手改成 unknown(0)。本工具一律把讀到的現值 status ' +
                '原樣帶回，所以**不開放 status 當輸入**；要啟用/停用請改用 ' +
                'aladdin_platform_live_platform_update_live_category_status。' +
                '（字串欄位沒有這個問題，但本工具同樣把現值帶回，不依賴這個細節。）' +
                'name 是**逐語系合併**（只覆蓋你帶到的語系代碼，其餘語系維持原值，帶空陣列等於不動）。' +
                '四個圖片欄位 icon／background／squareImage／bannerImage 各自接受 path（既有後端路徑）／' +
                'filePath（stdio 模式本機絕對路徑，本工具負責上傳）／fileId（hosted 模式先 POST /files 取得）' +
                '三選一；走上傳時本工具會自動取一次性的 GetUploadImageToken 再上傳。' +
                '⚠️ 新增時後端不回傳新 id，本工具用寫入前後的 id 集合差異反推；無法唯一辨識時列出候選 id。' +
                '⚠️ 新建的分類狀態一定是 enabled（後端在 insert 前寫死）。' +
                '⚠️ 後端稽核紀錄有既有 bug：新增分類會被記成「新增直播頁籤」（actionId 用了 liveTabCreate' +
                '而不是存在的 liveCategoryCreate），資料本身正確，只有稽核標籤錯。' +
                '⚠️ 本 service 沒有任何 delete method——建立出來的分類刪不掉，只能停用，新增前請確認。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）向使用者明確詢問是否要在正式環境執行，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會' +
                '忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(0).optional().describe(
                    '要修改的分類 id（來自 aladdin_platform_live_platform_get_live_categories）；省略或 0 表示新增一筆',
                ),
                name: localizedTextSchema.optional().describe(
                    '分類名稱多語系陣列；新增時必填（rajah 上標 @Rules "Required"），修改時省略沿用現值、有帶則逐語系合併',
                ),
                icon: liveImageInputSchema.optional().describe('分類圖示；省略沿用現值'),
                background: liveImageInputSchema.optional().describe('分類背景圖；省略沿用現值'),
                squareImage: liveImageInputSchema.optional().describe('分類方形圖；省略沿用現值'),
                bannerImage: liveImageInputSchema.optional().describe('分類橫幅圖；省略沿用現值'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, name, icon, background, squareImage, bannerImage, confirm }) => {
            assertProdConfirmed(confirm);

            const beforeR = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveCategories());
            if (beforeR.failed) return asErrorResult(beforeR);
            const beforeRows = beforeR.data?.rows ?? [];

            const isEdit = id !== undefined && id > 0;
            let current: (typeof beforeRows)[number] | undefined;

            if (isEdit) {
                current = beforeRows.find((r) => r.id === id);
                if (!current) {
                    return asTextResult({
                        success: false,
                        message: `找不到 id=${ id } 的直播分類，未送出寫入請求。請先用 `
                            + 'aladdin_platform_live_platform_get_live_categories 確認可用的 id',
                    });
                }
            }

            const nextName = mergeLocalizedStrings(name, current?.name);
            if (!isEdit && nextName.length === 0) {
                return asTextResult({ success: false, message: '新增直播分類時 name 為必填（至少一組 {code, value}）' });
            }

            // 圖片：有帶就解析（可能含上傳），沒帶就沿用現值。任何一張失敗就整個中止，
            // 不做「部分成功」——避免留下一半新圖一半舊圖、呼叫端還以為全部成功。
            const errors: string[] = [];
            const inputs: Record<CategoryImageField, LiveImageInput | undefined> = {
                icon, background, squareImage, bannerImage,
            };
            const resolved: Record<CategoryImageField, string> = {
                icon: current?.icon ?? '',
                background: current?.background ?? '',
                squareImage: current?.squareImage ?? '',
                bannerImage: current?.bannerImage ?? '',
            };
            for (const field of Object.keys(inputs) as CategoryImageField[]) {
                const input = inputs[ field ];
                if (input === undefined) continue;
                const path = await resolveLiveImagePath(field, CATEGORY_IMAGE_TYPE[ field ], input, errors);
                if (path !== null) resolved[ field ] = path;
            }
            if (errors.length > 0) {
                return asTextResult({
                    success: false,
                    message: '圖片參數處理失敗，未送出寫入請求（已上傳的檔案不會被引用，可忽略）',
                    errors,
                });
            }

            const payload = LiveCategoryEdit.create({
                id: id ?? 0,
                name: nextName,
                icon: resolved.icon,
                background: resolved.background,
                squareImage: resolved.squareImage,
                bannerImage: resolved.bannerImage,
                // 見檔頭：不帶 status 會被後端當成「要設成 0」寫進 DB，一律原樣帶回現值。
                // 新增時後端會自己覆寫成 enabled，這裡帶什麼都不影響。
                ...(isEdit ? { status: current!.status } : {}),
            });

            const writeR = await withAutoRelogin(
                () => remote.liveBackOffice.livePlatform.CreateOrUpdateLiveCategory(payload),
            );
            if (writeR.failed) return asErrorResult(writeR);

            const afterR = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveCategories());
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    mode: isEdit ? 'update' : 'create',
                    message: '寫入 RPC 回報成功，但寫入後讀回驗證失敗，無法確認實際結果，請自行用 '
                        + 'aladdin_platform_live_platform_get_live_categories 確認',
                    verifyError: { errorCode: afterR.errorCode, message: afterR.message },
                });
            }
            const afterRows = afterR.data?.rows ?? [];

            if (isEdit) {
                const after = afterRows.find((r) => r.id === id);
                return asTextResult({
                    success: true,
                    mode: 'update',
                    message: after
                        ? '修改完成，請比對 category 內容確認未指定的欄位（含 status）都維持原值'
                        : '寫入 RPC 已成功，但讀回時比對不到這個 id，請自行用 get_live_categories 確認目前狀態',
                    category: after ?? null,
                });
            }

            const beforeIds = new Set(beforeRows.map((r) => r.id));
            const newIds = afterRows.filter((r) => !beforeIds.has(r.id)).map((r) => r.id);
            if (newIds.length === 1) {
                return asTextResult({
                    success: true,
                    mode: 'create',
                    message: '新增完成（提醒：本 service 沒有 delete method，這筆分類之後只能停用、無法刪除）',
                    category: afterRows.find((r) => r.id === newIds[ 0 ]) ?? null,
                });
            }
            return asTextResult({
                success: true,
                mode: 'create',
                message: newIds.length === 0
                    ? '新增完成，但寫入後讀回比對不到新增的分類（可能被同時間的其他操作影響），請自行用 get_live_categories 確認'
                    : `新增完成，但無法唯一辨識新建的分類 id（偵測到 ${ newIds.length } 筆新 id，可能有其他人同時也在新增），候選 id 列於 candidateIds`,
                candidateIds: newIds,
            });
        },
    );
}
