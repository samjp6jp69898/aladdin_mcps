/**
 * tools/list_app_versions.ts — aladdin_platform_app_platform_list_app_versions
 *
 * rajah: AppPlatform.ListAppVersions(appId i32 1, page i32 2, pageSize i32 3)
 *        (rows [PlatformAppVersionLite] 1, totalPage i32 2)
 * （rajah/services/app_back_office.rajah:180，本方法**無 @Permission**——同 service 的
 * CreateOrUpdateAppVersion / GetAppVersionForEdit 有掛 "PlatCapCfg.PsConfig.AppList.Ops.Ver"
 * （181/183 行），這支查詢沒有；service 上方 170 行的 `# @Permission "AppManagement"` 是註解不生效。
 * service AppPlatform 定義於同檔 171-222 行，model PlatformAppVersionLite 在同檔 67-78 行（66 是 @Reflection）。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 `Placeholder*` 前綴（4 支真 Placeholder 在
 * 212/215/218/221 行）；service 無 @NoPublic；agrabah 對應實作
 * AppPlatformService.methodListAppVersions（agrabah/src/servers/app_back_office/services/
 * app_platform.ts:256-271）確認有真實 override。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」的 **B 級**（只有範圍鍵 appId + page/pageSize，
 * 沒有任何能鎖定單一目標的搜尋欄位）。依該節規定，本工具**不做**「用業務鍵逐頁掃描找特定一筆」的
 * 內部查找——要拿單一版本的完整資料，請用有直接查詢介面的 sibling
 * `GetAppVersionForEdit(id)`（app_back_office.rajah:184），id 從本工具的回傳取得。
 *
 * ⚠️ **後端 pageSize 參數是壞的，本工具因此刻意不對外開放 pageSize**（2026-08-28 讀源碼查證，
 * 非推論）：`methodListAppVersions` 把呼叫端的 `pageSize` 原樣傳給 `getPageData`（app_platform.ts:268
 * 的第 5 個引數）用來算 `totalPage`，但真正下 SQL LIMIT 的那一段寫的是 `withPage(page)`
 * （app_platform.ts:260），**沒有把 pageSize 傳進去**，而 `withPage` 的預設 pageSize 是
 * `DefaultPageSize = 100`（agrabah/src/common/database_helper.ts:11、13-19）。也就是說：
 * 每頁實際筆數**恆為 100**，但 totalPage 會用呼叫端給的 pageSize 去除——兩者不一致，
 * 傳 pageSize=20 會得到「每頁 100 筆、卻宣稱 totalPage 是用 20 算出來」的矛盾結果；
 * 傳 pageSize=0（protobuf 未設值的預設）更會讓 `getTotalPage` 變成除以 0 得到 Infinity。
 * 本工具一律固定送 100，讓 totalPage 與實際每頁筆數一致，並在回傳裡標明 `pageSize: 100`。
 *
 * ⚠️ **totalPage 只有 page=1 時才是真的**（agrabah/src/common/database_helper.ts:204-230）：
 * `getPageData` 只在 `page === 1` 時才呼叫 count 計算（:208-217），`page > 1` 時固定回 0。
 * （`getPageData` 內部同時算了 totalRow，但本 method 的 rajah 回傳只有 `(rows, totalPage)`
 * ——app_back_office.rajah:180——所以呼叫端永遠拿不到 totalRow，本工具也不回這個欄位。）所以不能用 totalPage 當「是否還有下一頁」的判斷；翻頁到底請用
 * 「rows.length < 100 視為最後一頁」（第 2 節對「無 total 可判斷終點」的既定作法）。
 * 本工具在回傳裡直接給出 `hasMore` 與 `totalPageMeaningful` 兩個欄位，避免呼叫端誤讀 0。
 *
 * ⚠️ **appId 填錯不會報錯**（app_platform.ts:256-271 沒有呼叫同檔 56-64 的
 * `checkAppIdBelongsToPlatform`，改用 WHERE `platform_id = ? AND platform_app_id = ?` 過濾，
 * 見 :258 與 :260）：不存在或不屬於本平台的 appId 會回**空 rows 而非錯誤**。跨租戶讀取仍是安全的
 * （條件帶了 platform_id），但呼叫端不能把「有回應」當成 appId 合法的證據——合法 appId 一律先用
 * aladdin_platform_app_platform_list_apps 取得。
 *
 * 回傳 model PlatformAppVersionLite（app_back_office.rajah:66-78）：id（@Hide，仍會回傳，是
 * GetAppVersionForEdit 的 id 來源）、version（字串，來自 DbPlatformAppVersion 的
 * `appVersionString` getter，用 major.minor.patch 現組，agrabah/src/database_types/app.ts:47-49，
 * 由 app_platform.ts:265 賦值）、mode（AppUpdateModeEnum）、device（ShellDeviceEnum）、
 * publishStatus（AppPublishStatusEnum）。三個 enum 的文字對照放在 const.ts 的
 * APP_UPDATE_MODE_NAMES / SHELL_DEVICE_NAMES / APP_PUBLISH_STATUS_NAMES，本工具在回傳裡附上
 * `*Name` 衍生欄位，原始數值原樣保留。
 *
 * 排序：`id DESC`（app_platform.ts:260），也就是新建立的版本排在前面，不是依版本號大小排序。
 *
 * **驗收與已知未覆蓋情境**（誠實揭露）：2026-08-28 dev PK 平台實測——appId=5 回 2 筆且
 * totalPage=1、appId=10/11 回 0 筆、appId=999999 回空 rows 且 success=true、page=2 時 totalPage
 * 歸 0（宣稱 B 成立）。⚠️ **dev 上沒有任何 App 的版本數超過 100，所以「rows 超過一頁」的路徑
 * （hasMore=true、page>=2 真的有資料）未能實測**；`hasMore` 在 page=1 走的是後端 totalPage 的
 * 精確判斷，只有 page>1 才 fallback 到長度啟發式，該 fallback 在總筆數恰為 100 整數倍時會誤報
 * 「還有下一頁」（下一頁其實是空的）——這個限制在 description 也有寫明。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳無密鑰/PII 欄位，不需遮罩。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { APP_UPDATE_MODE_NAMES, SHELL_DEVICE_NAMES, APP_PUBLISH_STATUS_NAMES, APP_VERSION_SERVER_PAGE_SIZE } from '../const.ts';

export function registerListAppVersionsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_list_app_versions',
        {
            title: 'List app versions of one app (paged)',
            description:
                '分頁列出指定 App 的版本清單（rajah: AppPlatform.ListAppVersions，本方法無 @Permission）。' +
                `每頁固定 ${ APP_VERSION_SERVER_PAGE_SIZE } 筆、依 id 由新到舊排序（不是依版本號大小排序）。` +
                '⚠️ **本工具不提供 pageSize 參數**：後端那個參數是壞的（只影響 totalPage 的計算、不影響實際 ' +
                `SQL LIMIT，實際每頁恆為 ${ APP_VERSION_SERVER_PAGE_SIZE } 筆），本工具固定送 ` +
                `${ APP_VERSION_SERVER_PAGE_SIZE } 讓兩者一致。` +
                '⚠️ **totalPage 只有 page=1 時才是真的**，page>1 時後端固定回 0，不要拿它判斷還有沒有下一頁' +
                '——請改看本工具回傳的 hasMore：page=1 時它用後端 totalPage 精確判斷，page>1 時 fallback 到' +
                `長度啟發式（rows.length >= ${ APP_VERSION_SERVER_PAGE_SIZE }），該 fallback 在總筆數恰為 ` +
                `${ APP_VERSION_SERVER_PAGE_SIZE } 整數倍時會誤報還有下一頁（下一頁其實是空的）。` +
                '⚠️ **appId 填錯不會報錯**，不存在或不屬於本平台的 appId 一律回空 rows；' +
                '合法 appId 請先用 aladdin_platform_app_platform_list_apps 取得，不要猜測。' +
                '要看單一版本的完整內容（更新網址、多語系更新說明等），用本工具回傳的 id 直接呼叫 ' +
                'aladdin_platform_app_platform_get_app_version_for_edit，不要為了取完整內容而翻頁；' +
                '但若你是要「用版本號找出對應的版本 id」，翻頁掃描本工具是唯一可行做法（全庫沒有用版本號' +
                '查單一版本的 RPC），這種情況該翻就翻。' +
                'mode / device / publishStatus 是數值 enum，本工具另附 modeName / deviceName / ' +
                'publishStatusName 方便判讀。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                appId: z.number().int().positive().describe(
                    'App id（必填）。合法值來自 aladdin_platform_app_platform_list_apps 的 rows[].id；' +
                    '填錯不會報錯、只會回空 rows',
                ),
                page: z.number().int().positive().default(1).describe(
                    `頁碼，從 1 開始；每頁固定 ${ APP_VERSION_SERVER_PAGE_SIZE } 筆。` +
                    'totalPage 只有 page=1 時才會被後端計算，page>1 時固定是 0',
                ),
            },
        },
        async ({ appId, page }) => {
            const r = await withAutoRelogin(
                () => remote.appBackOffice.appPlatform.ListAppVersions(appId, page, APP_VERSION_SERVER_PAGE_SIZE),
            );
            if (r.failed) return asErrorResult(r);

            const rows = r.data?.rows ?? [];
            // page===1 時 totalPage 是後端真的算過的、且就是用 100 算的，直接拿來判斷還有沒有下一頁；
            // page>1 時後端固定回 0，只能 fallback 用長度啟發式（總筆數恰為 100 整數倍時會誤報，
            // 已在 description 與檔頭揭露）。作法對齊同目錄 list_registration_ip_users.ts:56-59。
            const totalPage = r.data?.totalPage;
            const hasMore = page === 1 && totalPage !== undefined && totalPage > 0
                ? page < totalPage
                : rows.length >= APP_VERSION_SERVER_PAGE_SIZE;
            return asTextResult({
                success: true,
                appId,
                page,
                pageSize: APP_VERSION_SERVER_PAGE_SIZE,
                totalPage: page === 1 ? totalPage : undefined,
                hasMore,
                rows: rows.map(row => ({
                    ...row,
                    modeName: APP_UPDATE_MODE_NAMES[ row.mode as number ] ?? `(未知值 ${ row.mode })`,
                    deviceName: SHELL_DEVICE_NAMES[ row.device as number ] ?? `(未知值 ${ row.device })`,
                    publishStatusName: APP_PUBLISH_STATUS_NAMES[ row.publishStatus as number ] ?? `(未知值 ${ row.publishStatus })`,
                })),
                note: rows.length === 0
                    ? 'rows 為空可能是這個 App 真的沒有版本，也可能是 appId 不存在或不屬於本平台——後端兩者都回空陣列，不報錯'
                    : undefined,
            });
        },
    );
}
