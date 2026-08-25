/**
 * tools/create_floating_window.ts — aladdin_platform_ad_floating_window_platform_create_config
 *
 * rajah: AdFloatingWindowPlatform.CreateConfig(payload AdFloatingWindowCreate 1) ()
 * （advertisement_back_office.rajah:191，需要 @Permission "Advertisement.FloatingWindow.Create"）
 *
 * 對應前端頁面：「廣告管理」→「浮窗設置」→新增。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（非空殼，真的寫 DB）：
 * `ad_floating_window.ts` methodCreateConfig → `cache_manager.ts:242-282` 通用 `createPlatformAd`
 * （跟 `create_home_page_popup.ts` 共用同一套 `DeriveCacheManager` 泛型邏輯），但 payload 映射走
 * 浮窗專屬的 closure（`cache_manager.ts:472-475`）：
 * ```
 * title: NormalizeLocalizationTitle(payload.title),   // 跟首頁彈窗的單一 string 不同
 * displayType: NormalizeDisplayType(payload.displayType),  // 浮窗特有，沒有 displayCondition/displayMoment
 * ```
 *
 * **與 CreateConfig（首頁彈窗版）的差異**：
 * - `title` 是 `[LocalizationString]` **多語系陣列**，`NormalizeLocalizationTitle`
 *   （cache_manager.ts:529-543）要求陣列不可空、且每筆的 `code`/`value` 都不可空——不是單一字串。
 * - 沒有 `displayCondition`/`displayMoment`，改成必填的 `displayType`
 *   （`NormalizeDisplayType`，cache_manager.ts:663-667：不可空、且必須是合法的
 *   `AdFloatingWindowDisplayTypeEnum` 成員）。
 * - `rolesVisible`/`platformVisible`/`thumbnails`/`forward`/`timeRange`/`sortOrder`/`guestVisible`
 *   的驗證要求與行為（NormalizeRolesVisible/NormalizePlatformVisible/NormalizeThumbnails/
 *   NormalizeForward/NormalizeTimeRange/NormalizeSortOrder）跟首頁彈窗版本完全相同（同一套共用函式），
 *   詳細陷阱說明見 `create_home_page_popup.ts` 檔頭，這裡不重複展開。
 * - **新建立的浮窗同樣一律強制為 disabled 狀態**（`createPlatformAd` 共用邏輯，`cache_manager.ts:248`）。
 * - **CreateConfig 同樣沒有回傳值（無 id）**，round-trip 改用 title（其中一個語言的 value）+ sortOrder
 *   反查 GetConfigs，做法與首頁彈窗版本相同。
 *
 * `forward`/`rolesVisible` 的 zod schema 與轉換函式直接重用 `create_home_page_popup.ts` 已 export 的
 * `roleConfigSchema`/`buildRoleConfigList`/`adForwardSchema`/`pickForwardVariant`/`normalizeForwardValue`
 * （這兩個 service 共用同一份 rajah `RoleConfig`/`AdForwardConfig` model），避免重複定義兩份容易漂移。
 * customer/roulette 兩個 forward variant 同樣因 abu/platform 生成程式碼缺這兩個欄位而不開放。
 *
 * 圖片上傳沿用既有 {code, filePath}（stdio）/{code, fileId}（hosted）二選一模式（H9），呼叫
 * `AdFloatingWindowPlatform.GetCreateUploadToken()`（無參數，advertisement_back_office.rajah:200）——
 * 跟首頁彈窗版本是不同的 method（各自 service 各自一份 token 發放），不可混用。
 *
 * 2026-08-25 dev（pk-platform.alddev.com）實測：用真正的 `@modelcontextprotocol/sdk`
 * `StdioClientTransport` + `tools/call`（非直打 remote.gen.ts）驗證，見 handler 呼叫處與 README。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AdFloatingWindowCreate, AdSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { roleConfigSchema, buildRoleConfigList, adForwardSchema, pickForwardVariant, normalizeForwardValue } from './create_home_page_popup.ts';

const DISPLAY_TYPE_MAP = { RightSideList: 1, CarouselDrag: 2, Standalone: 3 } as const;
const APP_TYPE_MAP = {
    iosWeb: 1, androidWeb: 8, desktopWeb: 2, iosApp: 3, androidApp: 4, iosWrapper: 5, androidWrapper: 6,
} as const;
const APP_TYPE_KEYS = Object.keys(APP_TYPE_MAP) as [ keyof typeof APP_TYPE_MAP, ...(keyof typeof APP_TYPE_MAP)[] ];

const localizationTitleSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().min(1).describe('該語系下的標題文字，不可空'),
})).min(1).describe('多語系標題，至少一筆，每筆 code/value 皆不可空');

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

        const pcTokenR = await withAutoRelogin(() => remote.advertisementBackOffice.adFloatingWindowPlatform.GetCreateUploadToken());
        if (pcTokenR.failed || !pcTokenR.data?.token) { errors.push(`[${ code }/forPC] 取得上傳 token 失敗：errorCode=${ pcTokenR.errorCode } ${ pcTokenR.message }`); continue; }
        const pcUploadR = await uploadFile(pcTokenR.data.token, pcPath);
        if (!pcUploadR.success) { errors.push(`[${ code }/forPC] ${ pcUploadR.message }`); continue; }

        const mobileTokenR = await withAutoRelogin(() => remote.advertisementBackOffice.adFloatingWindowPlatform.GetCreateUploadToken());
        if (mobileTokenR.failed || !mobileTokenR.data?.token) { errors.push(`[${ code }/forMobile] 取得上傳 token 失敗：errorCode=${ mobileTokenR.errorCode } ${ mobileTokenR.message }`); continue; }
        const mobileUploadR = await uploadFile(mobileTokenR.data.token, mobilePath);
        if (!mobileUploadR.success) { errors.push(`[${ code }/forMobile] ${ mobileUploadR.message }`); continue; }

        merged.push({ code, forPC: pcUploadR.path, forMobile: mobileUploadR.path });
    }

    return { merged, errors };
}

export function registerCreateFloatingWindowTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_ad_floating_window_platform_create_config',
        {
            title: 'Create a floating window ad on this platform',
            description:
                '在本平台「廣告管理」→「浮窗設置」新增一筆廣告設定（rajah: AdFloatingWindowPlatform.CreateConfig，' +
                '需要權限節點 Advertisement.FloatingWindow.Create）。' +
                '**新建立的廣告一律強制為停用（disabled）狀態**（後端寫死），不會出現在前台。' +
                'CreateConfig 沒有回傳值（連 id 都沒有），本工具建立後會用 title（其中一個語言的 value）+ ' +
                'sortOrder 反查 GetConfigs 做 round-trip 驗證，若查無結果只代表反查失敗，不代表建立失敗。' +
                'title 是多語系陣列（跟首頁彈窗的單一字串不同），至少一筆、每筆 code/value 皆不可空。' +
                '沒有 displayCondition/displayMoment（那是首頁彈窗特有），改成必填的 displayType' +
                '（RightSideList=右側直列／CarouselDrag=輪播拖曳／Standalone=獨立浮窗）。' +
                'rolesVisible（mode: all|specific）、platformVisible、thumbnails（固定要求每筆 forPC+forMobile ' +
                '兩張圖）、forward（9 選 1 跳轉目標，customer/roulette 因 abu/platform 生成程式碼缺漏不開放）' +
                '這幾個欄位的規則與 create_home_page_popup 完全相同，皆為後端必填（rajah 未標 Required 但實測會擋）。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion 明確詢問' +
                '使用者是否要在正式環境執行，取得同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。' +
                '非 prod 環境會忽略 confirm。',
            inputSchema: {
                title: localizationTitleSchema,
                sortOrder: z.number().int().min(0).describe('排序，數字越小越前面'),
                timeRange: z.object({
                    always: z.boolean().describe('true=長期展示（不需要 startTimestamp/endTimestamp）；false=指定區間展示'),
                    startTimestamp: z.number().int().optional().describe('展示起始時間（毫秒 epoch），always=false 時必填且需 >0'),
                    endTimestamp: z.number().int().optional().describe('展示結束時間（毫秒 epoch），always=false 時必填、需 >0 且大於 startTimestamp'),
                }).describe('展示時間區間，後端必填'),
                guestVisible: z.boolean().optional().describe('是否對訪客（未登入）可見，預設 false'),
                rolesVisible: z.array(roleConfigSchema).min(1).describe('角色可見性設定，至少一筆；後端必填'),
                platformVisible: z.object({
                    all: z.boolean().describe('true=全平台（忽略 list）；false=只有 list 列出的裝置類型可見（list 必填、不可空）'),
                    list: z.array(z.enum(APP_TYPE_KEYS)).optional().describe('all=false 時必填的裝置類型清單'),
                }).describe('裝置類型可見性（AppTypeEnum），後端必填'),
                thumbnails: z.array(z.object({
                    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
                    forPC: uploadOneOfSchema.describe('PC 端用圖'),
                    forMobile: uploadOneOfSchema.describe('行動端用圖（H5/App/Lite 共用）'),
                })).min(1).describe('縮圖清單，至少一筆；後端必填。每筆固定要求 forPC+forMobile 兩張圖'),
                forward: adForwardSchema,
                displayType: z.enum([ 'RightSideList', 'CarouselDrag', 'Standalone' ]).describe('展示類型，後端必填'),
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

            const payload = AdFloatingWindowCreate.create({
                title: input.title,
                sortOrder: input.sortOrder,
                timeRange: input.timeRange,
                guestVisible: input.guestVisible ?? false,
                rolesVisible,
                platformVisible,
                thumbnails: uploadResult.merged,
                forward: { [ forwardPick.key ]: normalizeForwardValue(forwardPick.key, forwardPick.value) },
                displayType: DISPLAY_TYPE_MAP[ input.displayType ],
            });

            const r = await withAutoRelogin(() => remote.advertisementBackOffice.adFloatingWindowPlatform.CreateConfig(payload));
            if (r.failed) return asErrorResult(r);

            const searchTitle = input.title[ 0 ]?.value ?? '';
            const checkR = await withAutoRelogin(() => remote.advertisementBackOffice.adFloatingWindowPlatform.GetConfigs(
                AdSearch.create({ title: searchTitle }), 1, 200,
            ));
            const matched = !checkR.failed
                ? checkR.data?.rows?.filter((row) => row.sortOrder === input.sortOrder)
                    .sort((a, b) => (b.createdAtTimestamp ?? 0) - (a.createdAtTimestamp ?? 0))[ 0 ]
                : undefined;

            return asTextResult({
                success: true,
                message: '已呼叫 CreateConfig 成功（errorCode=0）；新建立的廣告一律為停用狀態，不會出現在前台',
                readBack: matched ?? { note: '反查未命中，不代表建立失敗，請自行到後台確認', title: input.title, sortOrder: input.sortOrder },
            });
        },
    );
}
