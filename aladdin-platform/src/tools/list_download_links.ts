/**
 * tools/list_download_links.ts — aladdin_platform_app_platform_list_download_links
 *
 * rajah: AppPlatform.ListDownloadLinks(appId i32 1) (rows [AppDownloadLinkEdit] 1)
 * （rajah/services/app_back_office.rajah:189，本方法**無 @Permission**——同 service 的
 * CreateOrUpdateDownloadLink / UpdateDownloadLinkStatus 有掛 "PlatCapCfg.PsConfig.AppList.Ops.Link"
 * （193/199 行），這支查詢沒有；service 上方 170 行的 `# @Permission "AppManagement"` 是註解不生效。
 * service AppPlatform 定義於同檔 171-222 行，model AppDownloadLinkEdit 在同檔 121-153 行。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 `Placeholder*` 前綴（4 支真 Placeholder 在
 * 212/215/218/221 行）；service 無 @NoPublic；agrabah 對應實作
 * AppPlatformService.methodListDownloadLinks
 * （agrabah/src/servers/app_back_office/services/app_platform.ts:361-377）確認有真實 override。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」。有範圍鍵 appId 但**沒有分頁參數**
 * （app_platform.ts:368 的 loadObjects，sort 與 limit 兩個字串參數皆空），所以不適用 B 級的逐頁掃描
 * 要求，屬「完全不分頁的全撈」。這裡的全撈**有一個軟上限**在兜底，不是純粹賭表不會長大：後端
 * CreateOrUpdateDownloadLink 的新增分支（id===0，分支開在 app_platform.ts:426）會先 count 再擋在
 * `MAX_DOWNLOAD_LINKS = 20`（同檔 66、433-435），超過回 `appDownloadLinkExceedLimit`。
 * ⚠️ 但這是**軟上限不是硬約束**：該處原始註解明寫「這邊不用鎖或用 Transaction，因為即使讓平台的
 * 下載連結超出一些也不是什麼大問題」（app_platform.ts:427），併發新增可以小幅超出 20，DB 也沒有
 * 對應的 constraint。已查證 agrabah 全庫對 DbPlatformAppDownloadLink 沒有第二條 insert 路徑
 * （其餘存取都是讀，或 jobs/update_external_download_link.ts 只 UPDATE external_api_* 欄位），
 * 所以 overshoot 幅度有限、全撈仍安全。
 *
 * ⚠️ **與同 service 其他吃 appId 的 method 不同，這支填錯 appId 會明確報錯**：實作第一步就呼叫
 * `checkAppIdBelongsToPlatform`（app_platform.ts:363，函式本體在同檔 56-64），App 不存在或不屬於
 * 當前登入平台時回 `objectNotFound`（errorCode 14，genie 框架層代碼，不在 AgrabahErrorCodeEnum
 * 反查表，errorName 會顯示「(未知錯誤碼)」、message 為空字串——判斷失敗以 success 為準）。
 * 對照：`ListAppVersions` 沒走這個檢查，填錯 appId 只會回空 rows（見 list_app_versions.ts 檔頭）。
 *
 * 回傳 model AppDownloadLinkEdit（app_back_office.rajah:121-153）逐欄檢查：
 * - `id`（@Hide，仍回傳；是 CreateOrUpdateDownloadLink 與 UpdateDownloadLinkStatus 的 id 來源）
 * - `status`（StatusEnum，啟用/停用；回傳值翻譯用 const.ts 的 STATUS_NAMES）
 * - `url`（連結地址，@Type "File:Package"；DB 對應 platform_app_download_links.url）
 * - `label`（多語系顯示名稱，走一般 id_localizations，app_platform.ts:374；DB 表沒有這個欄位）
 * - `type`（DownloadLinkTypeEnum，8 種下載入口，對照表 const.ts 的 DOWNLOAD_LINK_TYPE_NAMES）
 * - `urlType`（DownloadLinkUrlTypeEnum：directDownload / externalUrl）
 * - `appStoreUrl`（僅 IOS 上架包類型使用）、`externalApiUrl`（urlType=externalUrl 時的取址 API）
 * ⚠️ **第 8 節不是完全不適用**：`url` 與 `appStoreUrl` 是給終端使用者的公開下載網址沒有風險，
 * 但 **`externalApiUrl` 在結構上就是最可能夾帶憑證的欄位**——後端排程呼叫它時是
 * `proxyFetch(url)` 裸呼叫、完全沒有帶任何 auth header
 * （agrabah/src/jobs/update_external_download_link.ts:30），也就是說若那支外部 API 需要認證，
 * 憑證只能內嵌在 URL 裡（query string key 或 basic-auth userinfo）。本工具會把它原樣回給 agent，
 * 呼叫端請視為潛在敏感值，不要貼進持久化 log 或對外文件。
 *
 * **DB 有但回傳查不到的欄位**（差集已逐欄比對 agrabah/src/database_types/app.ts:54-71 與
 * rajah model）：`platformAppId`、排程回填的 `externalApiLastSyncedAt` / `externalApiLastError`
 * （同檔 62-65），以及繼承自 WithPlatformAndTimestamp 的 `platformId` / `createdAt` / `updatedAt`
 * （database_types/base.ts）。所以「這條連結最近一次同步狀況如何」「什麼時候被改的」這兩類問題，
 * 這支都查不到。
 *
 * 排序：後端沒有指定 ORDER BY（app_platform.ts:368 的 sort 參數是空字串），回傳順序由 DB 決定，
 * 呼叫端不應依賴陣列順序，要穩定順序請自行依 id 排序。
 *
 * **本工具的回傳不會因為「值是預設值」而少掉 key**（2026-08-28 dev 實測 appId=5 的 4 筆，逐筆檢查
 * id/status/url/label/type/urlType/appStoreUrl/externalApiUrl 八個 key **一個都沒有缺席**，
 * 包含 urlType=0 與空字串的 appStoreUrl／externalApiUrl）。機制（第二輪對抗性覆核修正過一次，
 * 第一版寫成「decode 會保留零值」是錯的）：
 * - 上線端：後端 `AppDownloadLinkEdit.fromObject(dbRow)`（app_platform.ts:373）把每個 DB 欄位都設成
 *   own property，protobufjs 是依 own property 決定要不要編碼、不是依「值是否等於預設」，所以零值
 *   真的被編碼送上線、decoder 再設回 own property。**不是 decode 憑空保留零值**。
 * - 序列化端：本工具用 `{ ...row }` 展開走 own-property 路徑，repeated 欄位在 protobufjs 生成的
 *   constructor 裡就被初始化成 own property `[]`，所以 `label` 即使沒有任何翻譯列也會是 `[]`、
 *   不會整欄消失。
 * ⚠️ **這一點與 aladdin_platform_app_platform_list_apps 的 banner 行為相反，不是同一機制**（第一版
 *   誤寫成同一機制）：那支直接把原始 Message 實例交給 JSON.stringify，會走
 *   `Message.prototype.toJSON` → `Type.toObject(msg, util.toJSONOptions)`，該選項不含 arrays/defaults，
 *   **長度 0 的 repeated 欄位會整個被丟掉**，所以那邊才會看到 banner 整欄缺席（dev 實測 app 10/11
 *   確實沒有 banner key）。本工具沒有這個行為。
 * （附註：dev 上 4 筆下載連結剛好都有 label，沒遇到空 label 的資料。但「spread 路徑會保留空陣列」
 * 這條已用同一份 dev 資料**直接實測證實**：對 ListApps 的回傳逐筆比較兩種序列化，app 10/11 的
 * `row` 對 `banner` 都是 own property 且值為 `[]`，`JSON.stringify(row)`（Message 路徑）會把 banner
 * 整個 key 丟掉，`JSON.stringify({ ...row })`（spread 路徑）則保留 `banner: []`。這同時排除了
 * 「後端條件式賦值導致 key 不存在」這個替代解釋——key 一直都在，是序列化那一層丟的。）
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { DOWNLOAD_LINK_TYPE_NAMES, DOWNLOAD_LINK_URL_TYPE_NAMES, MAX_DOWNLOAD_LINKS, STATUS_NAMES } from '../const.ts';

export function registerListDownloadLinksTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_list_download_links',
        {
            title: 'List download links of one app',
            description:
                '列出指定 App 的全部下載連結（rajah: AppPlatform.ListDownloadLinks，本方法無 @Permission）。' +
                '每筆含 id、status（啟用/停用）、url（連結地址）、多語系顯示名稱 label、' +
                'type（8 種下載入口）、urlType（直接下載 / 外部 API 取址）、appStoreUrl、externalApiUrl，' +
                '另附 statusName / typeName / urlTypeName 中文對照。' +
                `不分頁、一次回全部；後端對單一 App 的下載連結有 ${ MAX_DOWNLOAD_LINKS } 筆**軟上限**` +
                '（只在新增時檢查、且後端刻意不加鎖，併發新增可小幅超出），所以全撈是安全的。' +
                '⚠️ 與 aladdin_platform_app_platform_list_app_versions 不同，**這支填錯 appId 會明確報錯**' +
                '（errorCode=14 objectNotFound，errorName 會顯示「(未知錯誤碼)」是正常的，判斷失敗看 success）；' +
                '合法 appId 來自 aladdin_platform_app_platform_list_apps 的 rows[].id。' +
                '⚠️ 後端沒有指定排序，回傳順序由 DB 決定，不要依賴陣列順序。' +
                '⚠️ 外部連結的最近同步時間 / 最近錯誤訊息只存在 DB，不在這支的回傳裡，查不到。' +
                '欄位即使是預設值也會照常回傳（2026-08-28 dev 實測 4 筆：urlType=0 與空字串的 ' +
                'appStoreUrl / externalApiUrl 都有出現，八個 key 一個都沒缺席）；label 沒有任何翻譯列時' +
                '會是空陣列 []，不會整欄消失。' +
                '（注意這點與 aladdin_platform_app_platform_list_apps 的 banner 行為**相反**——那支的空陣列' +
                '欄位會整個從回傳消失，兩者序列化路徑不同。）' +
                '⚠️ **externalApiUrl 可能內嵌第三方 API 憑證**（後端排程呼叫它時不帶任何 auth header，' +
                '需要認證的話只能寫在 URL 裡），請視為潛在敏感值，不要貼進持久化 log 或對外文件。' +
                '回傳的 id 是後端 AppPlatform.UpdateDownloadLinkStatus / CreateOrUpdateDownloadLink 的 id 來源，' +
                '但本 MCP server 目前**沒有**包裝這兩支寫入 method。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                appId: z.number().int().positive().describe(
                    'App id（必填）。合法值來自 aladdin_platform_app_platform_list_apps 的 rows[].id；' +
                    '不存在或不屬於本平台會回 errorCode=14（objectNotFound），不是回空陣列',
                ),
            },
        },
        async ({ appId }) => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListDownloadLinks(appId));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'errorCode=14（objectNotFound）代表這個 appId 不存在或不屬於當前登入平台；' +
                        '合法值請用 aladdin_platform_app_platform_list_apps 取得',
                });
            }

            const rows = r.data?.rows ?? [];
            return asTextResult({
                success: true,
                appId,
                rows: rows.map(row => ({
                    ...row,
                    statusName: STATUS_NAMES[ row.status as number ] ?? `(未知值 ${ row.status })`,
                    typeName: DOWNLOAD_LINK_TYPE_NAMES[ row.type as number ] ?? `(未知值 ${ row.type })`,
                    urlTypeName: DOWNLOAD_LINK_URL_TYPE_NAMES[ row.urlType as number ] ?? `(未知值 ${ row.urlType })`,
                })),
            });
        },
    );
}
