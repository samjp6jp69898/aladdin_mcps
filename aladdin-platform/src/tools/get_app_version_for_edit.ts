/**
 * tools/get_app_version_for_edit.ts — aladdin_platform_app_platform_get_app_version_for_edit
 *
 * rajah: AppPlatform.GetAppVersionForEdit(id i32 1) (platformAppVersionEdit PlatformAppVersionEdit 1)
 * （rajah/services/app_back_office.rajah:184，@Permission "PlatCapCfg.PsConfig.AppList.Ops.Ver"
 * 在 183 行；service AppPlatform 定義於同檔 171-222 行，model PlatformAppVersionEdit 在同檔 80-112 行。）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 `Placeholder*` 前綴（4 支真 Placeholder 在
 * 212/215/218/221 行）；service 無 @NoPublic；agrabah 對應實作
 * AppPlatformService.methodGetAppVersionForEdit
 * （agrabah/src/servers/app_back_office/services/app_platform.ts:327-349）確認有真實 override。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆（Get by id）」。逐條套用該節要求：
 * - **id 不存在的實際行為**：後端 loadObject 查無資料時明確回 `ErrorCode.objectNotFound`
 *   （app_platform.ts:335，查詢在 329），不是回空 struct、也不是拋例外。2026-08-28 dev 實測確認：id=999999 與
 *   「把 appId=5 誤填成版本 id」兩種情況都回 `success:false, errorCode:14`。⚠️ **errorCode 14 是 genie
 *   框架層的 `ErrorCode.objectNotFound`，不在 AgrabahErrorCodeEnum 反查表裡**，所以 `errorName` 會顯示
 *   「(未知錯誤碼)」、`message` 是空字串——這不代表沒有錯誤或工具壞掉，一律以 `success:false` 為準。
 * - **跨租戶風險**：查詢條件是 `id = ? AND platform_id = ?`（app_platform.ts:329），`platform_id` 來自
 *   session 綁定的 `context.platformId`、不是呼叫端參數，所以拿別平台的版本 id 查會落在
 *   objectNotFound，撈不到跨平台資料。這點與同 service 的 ListAppVersions 一致。
 * - **`*ForEdit` 欄位比顯示版多**：本方法回傳的 PlatformAppVersionEdit 比清單用的
 *   PlatformAppVersionLite（同檔 66-78 行）多了 `platformAppId`、`majorVersion`/`minorVersion`/
 *   `patchVersion`（Lite 只有現組的 `version` 字串）、`url`（更新地址）、`message`（多語系更新說明）。
 *   逐欄檢查過：全部是後台設定值，沒有內部欄位、沒有密鑰、沒有 PII——`url` 是 App 安裝包/更新包的
 *   公開下載網址（前台 App 自己會去抓），不是憑證（第 8 節不適用）。
 * - **`Get` 前綴不保證唯讀**：本方法實作只有 loadObject + queryLongById 兩個讀取，沒有任何寫入或
 *   claim 語意（app_platform.ts:327-349 全文），確認為真唯讀。
 *
 * ⚠️ **參數 id 是「版本自己的 id」，不是 appId**（app_back_office.rajah:184 的簽名就叫 `id`，
 * 對應 DbPlatformAppVersion.id，不是 platform_app_id）。合法值來自
 * aladdin_platform_app_platform_list_app_versions 的 `rows[].id`。**填 appId 進來不保證會報錯**：查詢條件只有
 * `id = ? AND platform_id = ?`（app_platform.ts:329），`id` 比對的是 platform_app_versions 的主鍵，
 * 與 platform_apps 的主鍵是兩條獨立的 auto-increment 序列，數值剛好撞到就會 success 回**另一筆版本
 * 的完整資料**。2026-08-28 dev 以 appId=5 實測回 errorCode=14，只證明該平台當下沒有 id=5 的版本，
 * 不能推論成「填 appId 一律報錯」。
 *
 * `message`（更新說明）走的是**長文本多語系表**（app_platform.ts:339 的
 * `localizationManager.queryLongById` → `id_long_localizations`，與一般 `id_localizations` 是不同的表），
 * 沒有翻譯列時該欄位會是空陣列，不是報錯。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { APP_UPDATE_MODE_NAMES, SHELL_DEVICE_NAMES, APP_PUBLISH_STATUS_NAMES } from '../const.ts';

export function registerGetAppVersionForEditTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_get_app_version_for_edit',
        {
            title: 'Get one app version (full edit payload)',
            description:
                '讀取單一 App 版本的完整編輯用資料（rajah: AppPlatform.GetAppVersionForEdit，需要權限節點 ' +
                'PlatCapCfg.PsConfig.AppList.Ops.Ver）。比清單版多出 platformAppId、拆開的 ' +
                'majorVersion/minorVersion/patchVersion、更新地址 url、多語系更新說明 message。' +
                '⚠️ **參數 id 是「版本自己的 id」，不是 appId**——合法值來自 ' +
                'aladdin_platform_app_platform_list_app_versions 回傳的 rows[].id；' +
                '⚠️ **填成 appId 不保證會報錯**：查詢條件只有 `id = ? AND platform_id = ?`，`id` 比對的是版本表的 ' +
                '主鍵，與 App 的 id 是兩條獨立的 auto-increment 序列——填 appId 進來若剛好命中本平台某筆版本的 id，' +
                '會 success:true 回**另一筆版本的資料**，不會報錯。務必用 list_app_versions 的 rows[].id。' +
                '填成別的平台的版本 id 則一律回 errorCode=14（genie 的 objectNotFound，platform_id 條件保證了這點）；' +
                '因為 14 不在 AgrabahErrorCodeEnum 反查表裡，errorName 會顯示「(未知錯誤碼)」且 message 為空字串，' +
                '這是正常的，判斷失敗請看 success 欄位。' +
                '查詢自動綁定當前登入平台，撈不到別平台的版本。' +
                'mode / device / publishStatus 是數值 enum，本工具另附 modeName / deviceName / ' +
                'publishStatusName 方便判讀。message 走長文本多語系表，沒有翻譯時是空陣列不是錯誤。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                id: z.number().int().positive().describe(
                    'App 版本自己的 id（必填，不是 appId）。合法值來自 ' +
                    'aladdin_platform_app_platform_list_app_versions 的 rows[].id',
                ),
            },
        },
        async ({ id }) => {
            const r = await withAutoRelogin(() => remote.appBackOffice.appPlatform.GetAppVersionForEdit(id));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'objectNotFound 代表這個 id 在當前平台底下不存在——確認你填的是版本 id（來自 ' +
                        'aladdin_platform_app_platform_list_app_versions 的 rows[].id）而不是 appId',
                });
            }

            const version = r.data?.platformAppVersionEdit;
            if (!version) {
                return asTextResult({ success: false, message: `RPC 成功但沒有回傳版本資料（id=${ id }）` });
            }

            return asTextResult({
                success: true,
                platformAppVersionEdit: {
                    ...version,
                    modeName: APP_UPDATE_MODE_NAMES[ version.mode as number ] ?? `(未知值 ${ version.mode })`,
                    deviceName: SHELL_DEVICE_NAMES[ version.device as number ] ?? `(未知值 ${ version.device })`,
                    publishStatusName: APP_PUBLISH_STATUS_NAMES[ version.publishStatus as number ] ?? `(未知值 ${ version.publishStatus })`,
                },
            });
        },
    );
}
