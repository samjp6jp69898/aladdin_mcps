/**
 * tools/create_home_page_popup.ts — aladdin_platform_ad_home_page_pop_up_platform_create_config
 *
 * rajah: AdHomePagePopUpPlatform.CreateConfig(payload AdHomePagePopUpCreate 1) ()
 * （advertisement_back_office.rajah:101，需要 @Permission "Advertisement.HomePagePopUp.Create"）
 *
 * 對應前端頁面：「廣告管理」→「首頁彈窗」→新增，abu/platform/src/pages/advertisement/popup/AdHomePagePopupFormDialog.vue。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（非空殼，真的寫 DB）：
 * `ad_home_page_pop_up.ts:81-83` methodCreateConfig → `cache_manager.ts:242-293` createPlatformAd。
 *
 * **CreateConfig 沒有回傳值（連 id 都沒有）**：rajah 簽名 `() ()`，所以本工具無法用「回傳 id 讀回驗證」
 * 這個第 3 節標準模式，改用 title+sortOrder 到 GetConfigs 反查比對做 round-trip（見下方 handler）。
 * 建議呼叫端使用有辨識度的 title（例如帶固定前綴），避免反查時同 title+sortOrder 撞到既有資料。
 *
 * **關鍵安全事實**：`createPlatformAd`（cache_manager.ts:249）寫死 `status: StatusEnum.disabled`——
 * 不管 payload 裡有沒有帶 status（rajah AdHomePagePopUpCreate 本來就沒有 status 欄位），新建立的彈窗
 * **一律強制為停用狀態**，不會在前台顯示，需另外呼叫 SetStatus 才會生效。這大幅降低了誤建立造成
 * 實際曝光給真實使用者的風險。
 *
 * **rajah `@Rules "Required"` 與後端實際必填不一致（method-category-checklist.md §11 已知陷阱模式）**：
 * `AdHomePagePopUpCreate` 只有 title/sortOrder/platformVisible/displayCondition/displayMoment 掛
 * `@Rules "Required"`，但後端 `createPlatformAd` 內的 Normalize* 函式（cache_manager.ts:548-825）
 * 對 timeRange、rolesVisible、thumbnails、forward 同樣會在缺漏時丟出例外（→ errorCode=adInvalidConfig），
 * 只是 rajah 沒有標註。本工具 zod schema 把這些也列為必填，如實反映後端真實行為而非 rajah 表面宣告：
 * - `NormalizeTimeRange`（cache_manager.ts:565-584）：timeRange 不可為 null；`always=false` 時
 *   startTimestamp/endTimestamp 皆須 >0 且 end>start。
 * - `NormalizeRolesVisible`（cache_manager.ts:587-634）：陣列不可空；每筆至少一個分類非 null；
 *   vipLevel/userLevel/agent/ventureAgent 四個分類各自的 `all` 欄位其實是 **StatusEnum**（非 bool，
 *   容易誤判）——`all ??= disabled(2)`，只有明確設成 `unknown(0)` 時才會檢查 `list` 不可空；
 *   `enabled(1)` 與預設的 `disabled(2)` 都會跳過 list 檢查（前端 RolesEditor.vue:250 用
 *   `cfg.all === StatusEnum.enabled` 判斷「全選」，`disabled` 語意上等同「此分類不啟用」）。
 *   為避免呼叫端誤用這個容易搞混的三態欄位，本工具的 zod schema 把它簡化成語意清楚的
 *   `mode: 'all' | 'specific'` 二選一（'all' 內部轉 enabled、'specific' 內部轉 unknown 且強制 ids 非空），
 *   不直接暴露原始三態欄位。`userId` 分類 rajah 有定義但後端這支 Normalize 函式完全沒有驗證它
 *   （不在解構清單內），效果未經測試，如實告知。
 * - `NormalizePlatformVisible`（cache_manager.ts:637-646）：`all` 是純 bool（非上面 RoleConfigList
 *   的 StatusEnum，兩者型別不同，不要混淆），`all=false` 時 `list` 不可空。
 * - `NormalizeThumbnails`（cache_manager.ts:686-703）：陣列不可空；依 `platformVisible` 決定
 *   `forPC`/`forMobile` 何者必填（含桌面平台需要 forPC、含非桌面平台需要 forMobile）。本工具為求
 *   一致與簡單，**每筆固定都上傳 forPC 與 forMobile 兩張圖**（多傳不影響驗證，只有少傳才會出錯），
 *   不依 platformVisible 動態判斷該不該傳。
 * - `NormalizeForward`（cache_manager.ts:771-825，@Union，完整 11 個 variant 見 advertisement.rajah:33-56）：
 *   必須且只能指定恰好一個 variant，本工具在 handler 內明確檢查（不是 zod-level union，因為 zod 難以
 *   優雅表達「物件裡恰好一個 key 有值」，改用執行期檢查給出清楚錯誤訊息）。
 *
 * **2026-08-25 獨立 review 抓到、已修正的兩個真實 bug**（見 `normalizeForwardValue()`）：
 * 1. `activity`/`games`/`live` 三個 variant 在 rajah 是「包一層 wrapper 物件」的 model
 *    （`AdActivityLinkList{activities}`/`AdGameLinkList{games}`/`AdLiveLinkList{links}`），不是裸陣列；
 *    修正前 zod schema 收裸陣列後直接原樣塞進 payload，後端 `activity.activities`/`games.games`/
 *    `live.links` 讀到 undefined，100% 會被 `NormalizeForward` 拒絕（adInvalidConfig）。
 * 2. `internal` 底層是 protobuf int32 enum，修正前把 zod 收到的字串 key（如 "Entertainment"）直接
 *    塞進 payload，未經 `AD_INTERNAL_LINK_MAP` 轉數字，字串在 int32 欄位會被強制轉型成 0，對應不到
 *    任何 `AdInternalLinkEnum` 成員，同樣 100% 會被拒絕。
 * 這兩個 bug 修正前（none 以外的 variant 幾乎都受影響）沒有被最初的 dev 實測涵蓋到（最初實測只測了
 * `forward=none`），修正後已針對可用的 9 個 variant 逐一重新實測，見下方與 README 記錄。
 *
 * **第三個已知限制（結構性、非本工具能修）：`customer`/`roulette` 兩個 variant 不開放**。rajah 源碼
 * （advertisement.rajah:33-56）定義了完整 11 個 variant，但 2026-08-25 實測發現 `abu/platform` 目前
 * 生成的 `types.gen.json` 的 `AdForwardConfig.oneofs.valueType.oneof` 只列到 `fission`（9 個成員，
 * customer=10/roulette=11 完全缺席，`fields` 區塊同樣沒有這兩個欄位定義）——protobufjs 對 schema
 * 未宣告的欄位不會編碼進送出的 bytes，帶了 `forward.customer`/`forward.roulette` 會在協定層被靜默丟棄，
 * 送到後端變成空的 forward 物件，回傳誤導性的「Only one forward type must be specified」（跟真的帶兩個
 * variant 撞掉是同一個錯誤訊息，難以分辨）。根因是 `abu/platform` 沒有在 rajah 加上這兩個 variant後
 * 重新跑 `rajah generate-abu.sh`（.rajah 源碼與生成程式碼不同步），不是這支 MCP tool 的程式錯誤，也不是
 * 這次任務範圍能修（regenerate 會動到整個 abu/platform 的生成程式碼，屬於另一個獨立變更）。本工具的
 * zod schema 因此刻意不開放這兩個 variant，避免呼叫端帶了卻悄悄失敗——待 abu/platform 重新生成後可再補上。
 *
 * 圖片上傳沿用既有 {code, filePath}（stdio）/{code, fileId}（hosted）二選一模式（H9），呼叫
 * `AdHomePagePopUpPlatform.GetCreateUploadToken()`（無參數，advertisement_back_office.rajah:110）
 * 取得單次使用 token 後上傳。
 *
 * 2026-08-25 dev（pk-platform.alddev.com）實測：見 handler 呼叫處與 README 記錄。改用真正的 MCP
 * StdioClientTransport + tools/call 驗證（非直接 import remote.gen.ts 繞過 MCP 層），連 zod
 * inputSchema 驗證與 registerTool handler 本身都一併測到。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AdHomePagePopUpCreate, AdSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP } from '../const.ts';

const DISPLAY_CONDITION_MAP = { None: 0, NotRecharged: 1, HasRecharged: 2 } as const;
const DISPLAY_MOMENT_MAP = { PerDay: 1, PerLogin: 2 } as const;
// AppTypeEnum（common.rajah:2334-2353）——排除 all=99（"搜尋用"，非真實平台，platformVisible.all 用
// 獨立的 bool 欄位表達「全平台」，不透過這個列舉值）與 unknown=0。
const APP_TYPE_MAP = {
    iosWeb: 1, androidWeb: 8, desktopWeb: 2, iosApp: 3, androidApp: 4, iosWrapper: 5, androidWrapper: 6,
} as const;
const APP_TYPE_KEYS = Object.keys(APP_TYPE_MAP) as [ keyof typeof APP_TYPE_MAP, ...(keyof typeof APP_TYPE_MAP)[] ];
// AdInternalLinkEnum（advertisement.rajah:90-115）
const AD_INTERNAL_LINK_MAP = {
    Entertainment: 1, Sport: 2, Live: 3, Deposit: 4, Withdraw: 5, VipPrivilege: 6, Shop: 7, Backpack: 8,
    CustomerService: 9, ActivityHomePage: 10, QuestCenter: 11, NotificationCenter: 12, PhoneBinding: 13,
    WalletCenter: 14, AwardingCenter: 15, VentureAgentPromo: 16, GeneralAgentPromo: 17, RedeemDiamonds: 18,
    ContributionRank: 19, RevenueRank: 20, IWantGoLive: 21, StageHomePage: 22, BonusWallet: 23, FixedRank: 24,
} as const;
const AD_INTERNAL_LINK_KEYS = Object.keys(AD_INTERNAL_LINK_MAP) as [ keyof typeof AD_INTERNAL_LINK_MAP, ...(keyof typeof AD_INTERNAL_LINK_MAP)[] ];

// RoleConfigList（common.rajah:1609-1615）的 `all` 是 StatusEnum 三態，容易誤用（見檔頭註解），
// 對外簡化成語意清楚的 mode。導出讓未來的 EditConfig tool 可以直接重用，不必重寫一份。
export const roleConfigListSchema = z.object({
    mode: z.enum([ 'all', 'specific' ]).describe(
        "'all'=此分類全部成員皆可見（忽略 ids）；'specific'=只有 ids 列出的成員可見（ids 必填、不可空，" +
        '後端會直接拒絕空陣列）',
    ),
    ids: z.array(z.number().int()).optional().describe(
        "mode='specific' 時必填。id 語意依分類而定：vipLevel 傳 VIP 等級設定 id、userLevel 傳會員層級 id、" +
        'agent/ventureAgent 傳代理 id、userId 傳會員 id（此分類後端實際未驗證，效果未經測試）',
    ),
}).refine(
    (v) => v.mode !== 'specific' || (v.ids !== undefined && v.ids.length > 0),
    { message: "mode='specific' 時 ids 必填且不可為空陣列", path: [ 'ids' ] },
).describe('角色可見性設定，一個分類的開關');

export function buildRoleConfigList(input: { mode: 'all' | 'specific'; ids?: number[] } | undefined): { all: number; list: number[] } | undefined {
    if (!input) return undefined;
    return {
        all: input.mode === 'all' ? STATUS_MAP.enabled : STATUS_MAP.unknown,
        list: input.ids ?? [],
    };
}

export const roleConfigSchema = z.object({
    userId: roleConfigListSchema.optional(),
    vipLevel: roleConfigListSchema.optional(),
    userLevel: roleConfigListSchema.optional(),
    agent: roleConfigListSchema.optional(),
    ventureAgent: roleConfigListSchema.optional(),
}).describe('一筆角色可見性設定，至少要帶一個分類（userId/vipLevel/userLevel/agent/ventureAgent 其中之一）');

export const adForwardSchema = z.object({
    none: z.boolean().optional().describe('不跳轉（值本身不重要，只要是這個 variant）'),
    external: z.string().optional().describe('外部連結 URL'),
    embedded: z.string().optional().describe('內嵌頁面內容（URL）'),
    activity: z.array(z.object({ activityId: z.number().int(), name: z.string() })).optional().describe('跳轉活動清單'),
    internal: z.enum(AD_INTERNAL_LINK_KEYS).optional().describe('跳轉 App 內部頁面'),
    announce: z.object({ announcementId: z.number().int(), name: z.string() }).optional().describe('跳轉公告'),
    games: z.array(z.object({ gameId: z.number().int(), name: z.string() })).optional().describe('跳轉遊戲清單'),
    live: z.array(z.object({ liveId: z.string(), name: z.string() })).optional().describe('跳轉直播間清單'),
    fission: z.string().optional().describe('裂變活動 key，來自 aladdin_platform_ad_home_page_pop_up_platform_get_fission_activity_options 回傳的 rows[].key'),
    // customer/roulette 刻意不開放，見檔頭「已知限制」——abu/platform 目前生成的 types.gen.json 缺這兩個
    // 欄位（前端 codegen 落後於 rajah 源碼），帶了會被協定層靜默丟棄、造成後端回「Only one forward type
    // must be specified」這種誤導性錯誤，不如直接不開放，避免呼叫端誤用。
}).describe(
    '廣告跳轉目標，9 個欄位中必須且只能帶恰好一個（none/external/embedded/activity/internal/announce/games/live/fission）。' +
    'rajah 定義另有 customer/roulette 兩個 variant，但目前 abu/platform 生成的程式碼缺這兩個欄位（見檔頭「已知限制」），本工具刻意不開放，避免呼叫端帶了卻被靜默丟棄。',
);

export function pickForwardVariant(forward: Record<string, unknown>): { key: string; value: unknown } | { error: string } {
    const set = Object.entries(forward).filter(([ , v ]) => v !== undefined);
    if (set.length !== 1) {
        return { error: `forward 必須且只能帶恰好一個 variant，目前帶了 ${ set.length } 個（${ set.map(([ k ]) => k).join(',') || '無' }）` };
    }
    return { key: set[ 0 ][ 0 ], value: set[ 0 ][ 1 ] };
}

/**
 * 把 `pickForwardVariant` 選出的 (key, value) 轉成 AdForwardConfig 真正要的資料形狀。
 * 2026-08-25 獨立 review 抓到的兩個 bug（修正前 100% 會被後端拒絕，見同段修正紀錄）：
 * - `activity`/`games`/`live` 三個 variant 在 rajah 是「包一層 wrapper 物件」的 model
 *   （`AdActivityLinkList{activities}`/`AdGameLinkList{games}`/`AdLiveLinkList{links}`，
 *   advertisement.rajah:46,66-69,49,123-126,50,134-137），不是裸陣列；zod schema 為了呼叫端
 *   好寫，直接收裸陣列，這裡負責包成後端要的 wrapper 形狀。
 * - `internal` 欄位底層是 protobuf int32 enum，zod schema 為了可讀性收字串 key（如 "Entertainment"），
 *   這裡必須用 `AD_INTERNAL_LINK_MAP` 轉成數字——不轉的話字串會被 protobufjs 強制轉型成 0，
 *   對應不到任何 `AdInternalLinkEnum` 成員，後端一律回 adInvalidConfig。
 * 其餘 variant（none/external/embedded/announce/fission）資料形狀與 zod schema
 * 收到的形狀一致，原樣通過即可。
 */
export function normalizeForwardValue(key: string, value: unknown): unknown {
    switch (key) {
        case 'activity': return { activities: value };
        case 'games': return { games: value };
        case 'live': return { links: value };
        case 'internal': return AD_INTERNAL_LINK_MAP[ value as keyof typeof AD_INTERNAL_LINK_MAP ];
        default: return value;
    }
}

const uploadOneOfSchema = z.object({
    filePath: z.string().optional().describe('stdio 模式專用：本機圖片檔案的絕對路徑。與 fileId 二選一，不可同時/都不提供'),
    fileId: z.string().optional().describe('hosted 模式專用：先呼叫 POST /files 上傳圖片取得的 fileId。與 filePath 二選一，不可同時/都不提供'),
});

/**
 * 逐筆上傳 thumbnails（每筆固定上傳 forPC + forMobile 兩張圖，見檔頭「NormalizeThumbnails」說明）。
 * 每張圖各自呼叫一次 GetCreateUploadToken（無參數，token 單次使用、1 小時過期）。
 */
async function uploadThumbnails(
    thumbnails: { code: string; forPC: { filePath?: string; fileId?: string }; forMobile: { filePath?: string; fileId?: string } }[],
): Promise<{ merged: { code: string; forPC: string; forMobile: string }[]; errors: string[] }> {
    const merged: { code: string; forPC: string; forMobile: string }[] = [];
    const errors: string[] = [];

    function resolvePath(label: string, upload: { filePath?: string; fileId?: string }): string | null {
        if (upload.filePath !== undefined && upload.fileId !== undefined) {
            errors.push(`[${ label }] 同時提供了 filePath 與 fileId，兩者二選一`);
            return null;
        }
        if (upload.filePath === undefined && upload.fileId === undefined) {
            errors.push(`[${ label }] 缺少 filePath 或 fileId`);
            return null;
        }
        if (upload.fileId !== undefined) {
            const identity = currentIdentityForFiles();
            if (identity === undefined) {
                errors.push(`[${ label }] fileId 僅限 hosted 模式使用；目前是 stdio 連線，請改用 filePath`);
                return null;
            }
            const resolved = resolveFileIdForIdentity(upload.fileId, identity);
            if (!resolved.found) {
                errors.push(`[${ label }] fileId 無法使用（${ resolved.reason }）`);
                return null;
            }
            return resolved.path;
        }
        return upload.filePath!;
    }

    for (const { code, forPC, forMobile } of thumbnails) {
        const pcPath = resolvePath(`${ code }/forPC`, forPC);
        const mobilePath = resolvePath(`${ code }/forMobile`, forMobile);
        if (pcPath === null || mobilePath === null) continue;

        const pcTokenR = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetCreateUploadToken());
        if (pcTokenR.failed || !pcTokenR.data?.token) {
            errors.push(`[${ code }/forPC] 取得上傳 token 失敗：errorCode=${ pcTokenR.errorCode } ${ pcTokenR.message }`);
            continue;
        }
        const pcUploadR = await uploadFile(pcTokenR.data.token, pcPath);
        if (!pcUploadR.success) {
            errors.push(`[${ code }/forPC] ${ pcUploadR.message }`);
            continue;
        }

        const mobileTokenR = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetCreateUploadToken());
        if (mobileTokenR.failed || !mobileTokenR.data?.token) {
            errors.push(`[${ code }/forMobile] 取得上傳 token 失敗：errorCode=${ mobileTokenR.errorCode } ${ mobileTokenR.message }`);
            continue;
        }
        const mobileUploadR = await uploadFile(mobileTokenR.data.token, mobilePath);
        if (!mobileUploadR.success) {
            errors.push(`[${ code }/forMobile] ${ mobileUploadR.message }`);
            continue;
        }

        merged.push({ code, forPC: pcUploadR.path, forMobile: mobileUploadR.path });
    }

    return { merged, errors };
}

export function registerCreateHomePagePopupTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ad_home_page_pop_up_platform_create_config',
        {
            title: 'Create a home page popup ad on this platform',
            description:
                '在本平台「廣告管理」→「首頁彈窗」新增一筆廣告設定（rajah: AdHomePagePopUpPlatform.CreateConfig，' +
                '需要權限節點 Advertisement.HomePagePopUp.Create）。' +
                '**新建立的廣告一律強制為停用（disabled）狀態**（後端寫死，與 payload 內容無關），不會出現在前台，' +
                '需另外用有 SetStatus 權限的方式啟用才會生效——本工具本身不提供啟用功能。' +
                'CreateConfig 這支 RPC 沒有回傳值（連 id 都沒有），本工具建立後會用 title+sortOrder 反查 GetConfigs ' +
                '做 round-trip 驗證，若查無結果只代表「反查失敗」（回傳 message 註明），不代表建立失敗——建議帶有辨識度的 ' +
                'title（例如固定前綴）降低撞名風險。' +
                '以下欄位雖然 rajah 沒有標 Required，但後端實際會擋（errorCode=adInvalidConfig）：timeRange、' +
                'rolesVisible（至少一筆、至少一個分類）、thumbnails（至少一筆，每筆固定要求 forPC+forMobile 兩張圖）、' +
                'forward（恰好一個 variant）——本工具 zod schema 已如實列為必填。' +
                'rolesVisible 各分類的 all/list 語意複雜（原始欄位是 StatusEnum 三態），已簡化成 mode: all|specific，' +
                "'all'=該分類全選、'specific'=只有 ids 列出的成員可見（ids 必填）。" +
                'forward 是 9 選 1 的跳轉目標 union，恰好帶一個欄位（none 表示不跳轉）；rajah 另有 customer/roulette ' +
                '兩個 variant，因 abu/platform 生成程式碼目前缺這兩個欄位（前端 codegen 落後於 rajah 源碼），本工具刻意不開放。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion 明確詢問使用者' +
                '是否要在正式環境執行，取得同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境會忽略 confirm。',
            inputSchema: {
                title: z.string().min(1).describe('廣告標題'),
                sortOrder: z.number().int().min(0).describe('排序，數字越小越前面'),
                timeRange: z.object({
                    always: z.boolean().describe('true=長期展示（不需要 startTimestamp/endTimestamp）；false=指定區間展示'),
                    startTimestamp: z.number().int().optional().describe('展示起始時間（毫秒 epoch），always=false 時必填且需 >0'),
                    endTimestamp: z.number().int().optional().describe('展示結束時間（毫秒 epoch），always=false 時必填、需 >0 且大於 startTimestamp'),
                }).describe('展示時間區間，後端必填（rajah 未標 Required，但實測會擋）'),
                guestVisible: z.boolean().optional().describe('是否對訪客（未登入）可見，預設 false'),
                rolesVisible: z.array(roleConfigSchema).min(1).describe(
                    '角色可見性設定，至少一筆；後端必填（rajah 未標 Required，但實測會擋，見說明）',
                ),
                platformVisible: z.object({
                    all: z.boolean().describe('true=全平台（忽略 list）；false=只有 list 列出的裝置類型可見（list 必填、不可空）'),
                    list: z.array(z.enum(APP_TYPE_KEYS)).optional().describe('all=false 時必填的裝置類型清單'),
                }).describe('裝置類型可見性（AppTypeEnum），後端必填'),
                displayCondition: z.enum([ 'None', 'NotRecharged', 'HasRecharged' ]).describe('首存條件：None=無限制／NotRecharged=無首存／HasRecharged=已首存'),
                displayMoment: z.enum([ 'PerDay', 'PerLogin' ]).describe('顯示時機：PerDay=每日一次／PerLogin=每次登入'),
                thumbnails: z.array(z.object({
                    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
                    forPC: uploadOneOfSchema.describe('PC 端用圖'),
                    forMobile: uploadOneOfSchema.describe('行動端用圖（H5/App/Lite 共用）'),
                })).min(1).describe('縮圖清單，至少一筆；後端必填。每筆固定要求 forPC+forMobile 兩張圖（多傳不影響驗證）'),
                forward: adForwardSchema,
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const forwardPick = pickForwardVariant(input.forward);
            if ('error' in forwardPick) return asTextResult({ success: false, message: forwardPick.error });

            const uploadResult = await uploadThumbnails(input.thumbnails);
            if (uploadResult.errors.length > 0) {
                return asTextResult({ success: false, message: '縮圖上傳失敗，未送出任何建立請求', errors: uploadResult.errors });
            }

            const rolesVisible = input.rolesVisible.map((role) => ({
                userId: buildRoleConfigList(role.userId),
                vipLevel: buildRoleConfigList(role.vipLevel),
                userLevel: buildRoleConfigList(role.userLevel),
                agent: buildRoleConfigList(role.agent),
                ventureAgent: buildRoleConfigList(role.ventureAgent),
            }));

            const platformVisible = {
                all: input.platformVisible.all,
                list: (input.platformVisible.list ?? []).map((k: keyof typeof APP_TYPE_MAP) => APP_TYPE_MAP[ k ]),
            };

            const payload = AdHomePagePopUpCreate.create({
                title: input.title,
                sortOrder: input.sortOrder,
                timeRange: input.timeRange,
                guestVisible: input.guestVisible ?? false,
                rolesVisible,
                platformVisible,
                displayCondition: DISPLAY_CONDITION_MAP[ input.displayCondition ],
                displayMoment: DISPLAY_MOMENT_MAP[ input.displayMoment ],
                thumbnails: uploadResult.merged,
                forward: { [ forwardPick.key ]: normalizeForwardValue(forwardPick.key, forwardPick.value) },
            });

            const r = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.CreateConfig(payload));
            if (r.failed) return asErrorResult(r);

            // round-trip：CreateConfig 無回傳值，改用 title+sortOrder 反查剛建立的那筆（見檔頭說明）。
            const checkR = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetConfigs(
                AdSearch.create({ title: input.title }), 1, 200,
            ));
            const matched = !checkR.failed
                ? checkR.data?.rows?.filter((row) => row.title === input.title && row.sortOrder === input.sortOrder)
                    .sort((a, b) => (b.createdAtTimestamp ?? 0) - (a.createdAtTimestamp ?? 0))[ 0 ]
                : undefined;

            return asTextResult({
                success: true,
                message: '已呼叫 CreateConfig 成功（errorCode=0）；新建立的廣告一律為停用狀態，不會出現在前台',
                readBack: matched ?? { note: '反查未命中（可能是 title 篩選超過 200 筆撞頂，或反查當下尚未同步），不代表建立失敗，請自行到後台確認', title: input.title, sortOrder: input.sortOrder },
            });
        },
    );
}
