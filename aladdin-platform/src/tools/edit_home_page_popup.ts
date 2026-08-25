/**
 * tools/edit_home_page_popup.ts — aladdin_platform_ad_home_page_pop_up_platform_edit_config
 *
 * rajah: AdHomePagePopUpPlatform.EditConfig(id i32 1, payload AdHomePagePopUpEdit 2) ()
 * （advertisement_back_office.rajah:107，需要 @Permission "Advertisement.HomePagePopUp.Operate.Edit"）
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（非空殼，真的寫 DB）：
 * `ad_home_page_pop_up.ts` methodEditConfig → `cache_manager.ts:295-365` updatePlatformAd。
 *
 * **與 CreateConfig 的關鍵差異**：
 * - `updatePlatformAd` 的 `config` 物件**不含 status**（`cache_manager.ts:297-304`），`existing.from(config)`
 *   只會覆寫 config 裡有的欄位（`database_types/advertisement.ts:67-92` 的 `from()` 逐欄 `if (x != null)`
 *   判斷），status 完全不受影響——**編輯不會動到目前的啟用/停用狀態**（跟 Create 永遠強制 disabled 不同）。
 * - `updateObject(existing, false)`（`cache_manager.ts:332`，第二參數 false）：**沒有** SetStatus 那種
 *   `errorCode=10 nothingChanged` 陷阱，內容完全沒變時一樣回 `errorCode=0` 成功。
 *
 * **本 service 一樣沒有帶 id 的單筆查詢 method**（同 SetStatus 的限制）。但 `AdHomePagePopUpEdit`
 * 跟 `AdHomePagePopUpCreate` 欄位結構完全相同（title/sortOrder/timeRange/guestVisible/rolesVisible/
 * platformVisible/displayCondition/displayMoment/thumbnails/forward，見 rajah:48-69 vs :72-93），且
 * `Normalize*` 系列驗證要求（timeRange/rolesVisible/platformVisible/thumbnails/forward 皆不可空，同
 * CreateConfig 檔頭列的陷阱）意味著**這支 RPC 本質上是整包覆蓋，不支援後端側的部分更新**——`.from()`
 * 雖然逐欄 `!= null` 判斷，但呼叫端建構 `config` 時每個欄位都一定有值（來自 Normalize 驗證後的結果），
 * 不存在「只送部分欄位」這回事。
 *
 * 因此本工具依 method-category-checklist.md §4「先讀現值、只覆寫呼叫端明確要改的欄位、其餘原樣帶回」
 * 的要求，在呼叫 EditConfig 前，先用**分頁掃描 GetConfigs**（本 service 沒有直接的單筆查詢介面，
 * 掃描上限見 `MAX_SCAN_PAGES`）找到這筆廣告的現值當基準，未被呼叫端指定的欄位原樣帶回。
 *
 * **`rolesVisible` 尤其重要，不能省略這一步**：`RoleConfigManager.syncRoleConfigs`
 * （`/Users/user/aladdin/agrabah/src/managers/role_config_manager.ts:100-321`）對 rolesVisible 是
 * **差異運算（diff），不是合併**——以「本次傳入的完整陣列」為權威真相，DB 現有但本次沒出現的
 * listIndex／targetId 會被直接刪除（`role_config_manager.ts:125-139,290-318`）。若呼叫端沒把完整的
 * rolesVisible 傳全（例如只想改 title、rolesVisible 留空），會把使用者原本設定的角色可見性整個刪掉。
 * 本工具永遠帶完整陣列（呼叫端有指定就用轉換後的值，沒指定就用掃描讀到的現值原樣送出），避免這個陷阱。
 *
 * `thumbnails` 若呼叫端不指定，同樣沿用現值（已上傳的圖片 URL 直接原樣帶回，不需要重新上傳）；
 * 若指定則整組替換（同 Create 的固定 forPC+forMobile 兩張圖模式，沿用 `create_home_page_popup.ts`
 * 已驗證過的 `uploadThumbnails` 邏輯，此檔重新實作一份精簡版避免跨檔互相耦合升級風險）。
 *
 * `forward`/`rolesVisible` 的 zod schema 與轉換函式直接重用 `create_home_page_popup.ts` 已 export
 * 的 `adForwardSchema`/`pickForwardVariant`/`normalizeForwardValue`/`roleConfigSchema`/
 * `buildRoleConfigList`，避免重複定義兩份容易漂移。customer/roulette 兩個 forward variant 同樣因
 * abu/platform 生成程式碼缺這兩個欄位而不開放，見該檔檔頭完整說明。
 *
 * 2026-08-25 dev（pk-platform.alddev.com）實測：用真正的 `@modelcontextprotocol/sdk`
 * `StdioClientTransport` + `tools/call`（非直打 remote.gen.ts）驗證，見 handler 呼叫處與 README。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AdHomePagePopUpEdit, AdSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { roleConfigSchema, buildRoleConfigList, adForwardSchema, pickForwardVariant, normalizeForwardValue } from './create_home_page_popup.ts';

const DISPLAY_CONDITION_MAP = { None: 0, NotRecharged: 1, HasRecharged: 2 } as const;
const DISPLAY_MOMENT_MAP = { PerDay: 1, PerLogin: 2 } as const;
const APP_TYPE_MAP = {
    iosWeb: 1, androidWeb: 8, desktopWeb: 2, iosApp: 3, androidApp: 4, iosWrapper: 5, androidWrapper: 6,
} as const;
const APP_TYPE_KEYS = Object.keys(APP_TYPE_MAP) as [ keyof typeof APP_TYPE_MAP, ...(keyof typeof APP_TYPE_MAP)[] ];

/** 本 service 沒有帶 id 的單筆查詢，找現值／round-trip 皆靠分頁掃描 GetConfigs，設上限避免無限翻頁。 */
const MAX_SCAN_PAGES = 20;
const SCAN_PAGE_SIZE = 200;

async function findAdById(id: number): Promise<{ found: true; row: any } | { found: false; scannedPages: number }> {
    let scannedPages = 0;
    for (let page = 1; page <= MAX_SCAN_PAGES; page++) {
        const r = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetConfigs(AdSearch.create(), page, SCAN_PAGE_SIZE));
        if (r.failed) break;
        scannedPages = page;
        const rows = r.data?.rows ?? [];
        const match = rows.find((row) => row.id === id);
        if (match) return { found: true, row: match };
        if (rows.length < SCAN_PAGE_SIZE) break;
    }
    return { found: false, scannedPages };
}

const uploadOneOfSchema = z.object({
    filePath: z.string().optional().describe('stdio 模式專用：本機圖片檔案的絕對路徑。與 fileId 二選一，不可同時/都不提供'),
    fileId: z.string().optional().describe('hosted 模式專用：先呼叫 POST /files 上傳圖片取得的 fileId。與 filePath 二選一，不可同時/都不提供'),
});

async function uploadThumbnails(
    thumbnails: { code: string; forPC: { filePath?: string; fileId?: string }; forMobile: { filePath?: string; fileId?: string } }[],
): Promise<{ merged: { code: string; forPC: string; forMobile: string }[]; errors: string[] }> {
    const merged: { code: string; forPC: string; forMobile: string }[] = [];
    const errors: string[] = [];

    function resolvePath(label: string, upload: { filePath?: string; fileId?: string }): string | null {
        if (upload.filePath !== undefined && upload.fileId !== undefined) { errors.push(`[${ label }] 同時提供了 filePath 與 fileId，兩者二選一`); return null; }
        if (upload.filePath === undefined && upload.fileId === undefined) { errors.push(`[${ label }] 缺少 filePath 或 fileId`); return null; }
        if (upload.fileId !== undefined) {
            const identity = currentIdentityForFiles();
            if (identity === undefined) { errors.push(`[${ label }] fileId 僅限 hosted 模式使用；目前是 stdio 連線，請改用 filePath`); return null; }
            const resolved = resolveFileIdForIdentity(upload.fileId, identity);
            if (!resolved.found) { errors.push(`[${ label }] fileId 無法使用（${ resolved.reason }）`); return null; }
            return resolved.path;
        }
        return upload.filePath!;
    }

    for (const { code, forPC, forMobile } of thumbnails) {
        const pcPath = resolvePath(`${ code }/forPC`, forPC);
        const mobilePath = resolvePath(`${ code }/forMobile`, forMobile);
        if (pcPath === null || mobilePath === null) continue;

        const pcTokenR = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetEditUploadToken());
        if (pcTokenR.failed || !pcTokenR.data?.token) { errors.push(`[${ code }/forPC] 取得上傳 token 失敗：errorCode=${ pcTokenR.errorCode } ${ pcTokenR.message }`); continue; }
        const pcUploadR = await uploadFile(pcTokenR.data.token, pcPath);
        if (!pcUploadR.success) { errors.push(`[${ code }/forPC] ${ pcUploadR.message }`); continue; }

        const mobileTokenR = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.GetEditUploadToken());
        if (mobileTokenR.failed || !mobileTokenR.data?.token) { errors.push(`[${ code }/forMobile] 取得上傳 token 失敗：errorCode=${ mobileTokenR.errorCode } ${ mobileTokenR.message }`); continue; }
        const mobileUploadR = await uploadFile(mobileTokenR.data.token, mobilePath);
        if (!mobileUploadR.success) { errors.push(`[${ code }/forMobile] ${ mobileUploadR.message }`); continue; }

        merged.push({ code, forPC: pcUploadR.path, forMobile: mobileUploadR.path });
    }

    return { merged, errors };
}

export function registerEditHomePagePopupTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ad_home_page_pop_up_platform_edit_config',
        {
            title: 'Edit a home page popup ad on this platform',
            description:
                '編輯本平台「廣告管理」→「首頁彈窗」某筆廣告的內容（rajah: AdHomePagePopUpPlatform.EditConfig，' +
                '需要權限節點 Advertisement.HomePagePopUp.Operate.Edit）。**不會**動到目前的啟用/停用狀態' +
                '（狀態切換請用 aladdin_platform_ad_home_page_pop_up_platform_set_status）。' +
                '本 service 沒有帶 id 的單筆查詢，本工具會先分頁掃描 GetConfigs（上限 20 頁 × 200 筆）找出這筆的現值，' +
                '未指定的欄位會原樣沿用現值再送出——**這一步是必要的，不是選配的最佳化**：EditConfig 底層要求整包覆蓋，' +
                '尤其 rolesVisible 是差異運算（diff），沒有完整帶出現值的話會把使用者原本設定的角色可見性刪掉。' +
                '掃描超過上限找不到這筆時本工具會拒絕執行並回報，不會用不完整的資料貿然覆蓋。' +
                'thumbnails 若不指定會沿用現有圖片（不需要重新上傳）；若指定則整組替換（固定要求每筆 forPC+forMobile 兩張圖，' +
                '同 create_config 的模式）。forward 開放 9 個 variant（customer/roulette 因前端生成程式碼缺漏不開放，' +
                '見 create_home_page_popup.ts 檔頭）。rolesVisible 的 all/list 三態簡化成 mode: all|specific，同 create_config。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion 明確詢問使用者' +
                '是否要在正式環境執行，取得同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境會忽略 confirm。',
            inputSchema: {
                id: z.number().int().describe('廣告 id，來自 aladdin_platform_ad_home_page_pop_up_platform_get_configs 回傳的 rows[].id'),
                title: z.string().min(1).optional().describe('廣告標題，不帶則沿用現值'),
                sortOrder: z.number().int().min(0).optional().describe('排序，不帶則沿用現值'),
                timeRange: z.object({
                    always: z.boolean(),
                    startTimestamp: z.number().int().optional(),
                    endTimestamp: z.number().int().optional(),
                }).optional().describe('展示時間區間，不帶則沿用現值'),
                guestVisible: z.boolean().optional().describe('是否對訪客可見，不帶則沿用現值'),
                rolesVisible: z.array(roleConfigSchema).min(1).optional().describe(
                    '角色可見性設定，**不帶則沿用現值原樣送出（避免被 syncRoleConfigs 的差異運算誤刪）**；' +
                    '若要修改，必須帶完整清單，不是增量',
                ),
                platformVisible: z.object({
                    all: z.boolean(),
                    list: z.array(z.enum(APP_TYPE_KEYS)).optional(),
                }).optional().describe('裝置類型可見性，不帶則沿用現值'),
                displayCondition: z.enum([ 'None', 'NotRecharged', 'HasRecharged' ]).optional().describe('首存條件，不帶則沿用現值'),
                displayMoment: z.enum([ 'PerDay', 'PerLogin' ]).optional().describe('顯示時機，不帶則沿用現值'),
                thumbnails: z.array(z.object({
                    code: z.string(),
                    forPC: uploadOneOfSchema,
                    forMobile: uploadOneOfSchema,
                })).min(1).optional().describe('縮圖清單，不帶則沿用現值（不重新上傳）；若指定則整組替換'),
                forward: adForwardSchema.optional().describe('跳轉目標，不帶則沿用現值；若指定必須恰好一個 variant'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const baseline = await findAdById(input.id);
            if (!baseline.found) {
                return asTextResult({
                    success: false,
                    message: `找不到 id=${ input.id }（已掃描 ${ baseline.scannedPages } 頁、每頁 ${ SCAN_PAGE_SIZE } 筆；` +
                        '可能是 id 不存在、不屬於本平台，或超出掃描上限），拒絕在沒有現值基準的情況下貿然覆蓋',
                });
            }
            const base = baseline.row;

            let forwardValue = base.forward as unknown as Record<string, unknown>;
            if (input.forward) {
                const picked = pickForwardVariant(input.forward);
                if ('error' in picked) return asTextResult({ success: false, message: picked.error });
                forwardValue = { [ picked.key ]: normalizeForwardValue(picked.key, picked.value) };
            }

            let thumbnailsValue = base.thumbnails;
            if (input.thumbnails) {
                const uploadResult = await uploadThumbnails(input.thumbnails);
                if (uploadResult.errors.length > 0) {
                    return asTextResult({ success: false, message: '縮圖上傳失敗，未送出任何更新', errors: uploadResult.errors });
                }
                thumbnailsValue = uploadResult.merged;
            }

            const rolesVisibleValue = input.rolesVisible
                ? input.rolesVisible.map((role) => ({
                    userId: buildRoleConfigList(role.userId),
                    vipLevel: buildRoleConfigList(role.vipLevel),
                    userLevel: buildRoleConfigList(role.userLevel),
                    agent: buildRoleConfigList(role.agent),
                    ventureAgent: buildRoleConfigList(role.ventureAgent),
                }))
                : base.rolesVisible;

            const platformVisibleValue = input.platformVisible
                ? {
                    all: input.platformVisible.all,
                    list: (input.platformVisible.list ?? []).map((k: keyof typeof APP_TYPE_MAP) => APP_TYPE_MAP[ k ]),
                }
                : base.platformVisible;

            const payload = AdHomePagePopUpEdit.create({
                title: input.title ?? base.title,
                sortOrder: input.sortOrder ?? base.sortOrder,
                timeRange: input.timeRange ?? base.timeRange,
                guestVisible: input.guestVisible ?? base.guestVisible,
                rolesVisible: rolesVisibleValue,
                platformVisible: platformVisibleValue,
                displayCondition: input.displayCondition ? DISPLAY_CONDITION_MAP[ input.displayCondition ] : base.displayCondition,
                displayMoment: input.displayMoment ? DISPLAY_MOMENT_MAP[ input.displayMoment ] : base.displayMoment,
                thumbnails: thumbnailsValue,
                forward: forwardValue,
            });

            const r = await withAutoRelogin(() => remote.advertisementBackOffice.adHomePagePopUpPlatform.EditConfig(input.id, payload));
            if (r.failed) return asErrorResult(r);

            const after = await findAdById(input.id);
            return asTextResult({
                success: true,
                message: '已呼叫 EditConfig 成功（errorCode=0）',
                readBack: after.found ? after.row : {
                    note: `反查未命中（已掃描 ${ after.found === false ? after.scannedPages : 0 } 頁），不代表寫入失敗，請自行到後台確認`,
                    id: input.id,
                },
            });
        },
    );
}
