/**
 * tools/create_or_update_live_tab.ts — aladdin_platform_live_platform_create_or_update_live_tab
 *
 * rajah: LivePlatform.CreateOrUpdateLiveTab(liveTab LiveTabEdit 1)（無回傳值）
 * （rajah/services/live_back_office.rajah:67；LiveTabEdit 定義於同檔 2-14 行；
 * client 路徑 remote.liveBackOffice.livePlatform）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、service 無 `@NoPublic`、
 * agrabah 對應實作是真實 override（agrabah/src/servers/live_back_office/services/
 * live_platform.ts:90-144，methodCreateOrUpdateLiveTab），非 base class 的 notImplemented。
 *
 * 權限現況與 get_live_tabs.ts 檔頭記載的完全相同（`Live*` 整族權限節點在 rajah 全被註解掉，
 * 後端不做權限檢查、前端只有 isSuper 看得到菜單），不在這裡重複，需要時看那支。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert / CreateOrUpdate」。逐條落實：
 *
 * 1. **先讀現值再覆蓋**（第 4 節要求 1）：本工具一律先呼叫 `GetLiveTabs` 取得該筆完整現值，
 *    只覆寫呼叫端明確指定的欄位，其餘原樣帶回。這在本 method 上**不是形式主義，是必要的**，
 *    因為後端三段寫入各有各的覆蓋語意（皆為 2026-08-28 讀 source 查證）：
 *    - `position`：update 分支只寫這一個欄位（`UPDATE live_tabs SET position = ?`，:98），
 *      呼叫端沒帶時 protobuf 預設值 0 會被當成「要設成 0」直接寫進 DB。
 *    - `name`/`icon`：走 `LocalizationManager.updateById`
 *      （agrabah/src/managers/localization_manager.ts:61-64）——**逐語系 UPDATE，找不到才 INSERT，
 *      沒帶到的語系原樣保留、不會被刪**。傳空陣列等於什麼都不做（不是清空）。
 *    - `layout`：走 `SectionLayoutManager.updateById`
 *      （agrabah/src/managers/section_layout_manager.ts:16-40）——**整包覆蓋**
 *      `normal_rows`/`repeated_rows` 兩個欄位，沒帶等於清空。
 * 2. **round-trip 逐欄比對**（要求 2）：寫入後再讀一次 `GetLiveTabs` 回傳結果給呼叫端核對。
 * 3. **id=0/未帶走新增、id>0 走更新**（要求 3）：後端就是這個分流（:97），本工具在回傳的
 *    `mode` 欄位明確告知這次是 create 還是 update。
 * 4. 要求 4（`CreateOrUpdateRole` 的 permissionIds 差異運算）與要求 5（批次陣列型 upsert）
 *    都不適用——本 method 吃單一物件、沒有任何陣列型差異刪除語意。
 *
 * ⚠️ **後端會對 `liveTab.layout` 無條件解參照**（:132 `liveTab.layout.normalRows`）：protobuf
 * message 欄位未帶時是 `null`，直接呼叫會在後端拋例外、整個 transaction 失敗。前端也踩過
 * 同一個坑，所以 `abu/platform/src/pages/live/LiveTab.vue:46-50` 在送出前特地補一個空的
 * `SectionLayout`。本工具一律帶完整 layout（沿用現值，現值不存在時給空陣列），呼叫端不需要
 * 也不應該自己處理這件事。
 *
 * ⚠️ **update 分支只有 `position` 這一個欄位真的會寫進 `live_tabs` 表**——`status` 是
 * `@Readonly`、後端 update 分支也完全沒碰它（要改狀態請用
 * `aladdin_platform_live_platform_update_live_tab_status`）。
 *
 * update 分支用「affectedRows === 0 就回 objectNotFound」判定目標是否存在（:103-105）。
 * 讀 source 時本來預期這會有一個陷阱——MySQL 的 UPDATE affectedRows 預設只計「真的被改動的
 * 列」，那麼「position 沒變、只想改名稱」就會被誤判成 objectNotFound 並整批 rollback。
 * **2026-08-28 dev 實測結果推翻了這個推論**：對 id=18 送出與現值完全相同的 position，
 * 後端回 errorCode=0（成功），代表這條連線是以 matched rows（而非 changed rows）計數，
 * 沒有這個陷阱；同一輪對 id=999999 實測則正確回 errorCode=14（objectNotFound）。
 * 因此本工具**不**對「position 未變更」做任何特別處理，這段記錄是為了讓下一個讀 source 的人
 * 不必再推論一次（光讀 `affectedRows === 0` 這行會得出錯誤結論）。
 *
 * 上述結論的**適用範圍限定**（獨立 review 提醒後補記）：matched rows vs changed rows 取決於
 * 各環境 MySQL 連線是否帶 `CLIENT_FOUND_ROWS`，而連線字串是加密設定
 * （agrabah/src/engines/relational_database/mysql/mysql_relational_database_engine.ts:396-402），
 * **無法從原始碼靜態判定**，所以這只是 2026-08-28 dev 環境的實測事實，不是全環境保證。
 * 萬一其他環境的連線設定不同，後果是「position 沒變的合法編輯被誤判成 objectNotFound」——
 * 這條路徑會讓 `writeR.failed` 為真、本工具照實回報失敗，**不會造成資料被錯誤覆蓋或誤報成功**，
 * 風險有界。
 *
 * 圖示欄位（method-category-checklist.md 第 8 節「上傳/建立用 token 類」）：`icon` 在 rajah 上是
 * `[LocalizationString]` + `@Type "File:Image"`（:8-9），也就是「每個語系一張圖」，值是後端檔案
 * 路徑。本工具每一筆接受 path／filePath／fileId 三選一，需要上傳時走
 * `tools/live_image_upload.ts` 的共用 helper（取 `LiveUploadImageEnum.tabIcon=1` 的一次性 token
 * 再上傳）。該 helper 與 `create_or_update_live_category.ts` 共用，`GetUploadImageToken` 因此
 * 沒有被包成獨立對外 tool，理由見那個 helper 的檔頭。
 *
 * ⚠️ **新增時後端不回傳新 id**（RPC 無回傳值），本工具比照
 * `create_or_update_activity_tab.ts` 的既有作法，用「寫入前後 GetLiveTabs 的 id 集合差異」
 * 反推新 id；差異不只一筆（同時間有別人也在新增）時列出全部候選、不猜。
 *
 * ⚠️ **本 service 沒有任何 delete method**：建立出來的頁籤無法刪除，只能用
 * `aladdin_platform_live_platform_update_live_tab_status` 停用。新增前請確認真的需要。
 */
import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { LiveTabEdit, SectionLayout } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { LIVE_UPLOAD_IMAGE_TYPE, liveImageInputSchema, resolveLiveImagePath, type LiveImageInput } from './live_image_upload.ts';

const localizedTextSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的文字值'),
}));

/**
 * 頁籤圖示是「每個語系一張圖」（rajah 上 `icon [LocalizationString]` 且帶 `@Type "File:Image"`，
 * 值是後端檔案路徑），所以每一筆除了語系代碼之外，圖片來源同樣走 path/filePath/fileId 三選一，
 * 由 tools/live_image_upload.ts 的共用 helper 負責解析（換圖時會取 LiveUploadImageEnum.tabIcon=1
 * 的一次性上傳 token 再上傳）。
 */
const localizedImageSchema = z.array(liveImageInputSchema.extend({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
}));

/** SectionLayoutRowEnum（rajah/services/common.rajah:1139-1143）：two=0、banner=1、oneBigTwoSmall=2。 */
const sectionLayoutRowSchema = z.array(z.number().int().min(0).max(2));

/**
 * 逐語系合併：只覆蓋呼叫端帶到的語系代碼，其餘沿用現值。這與後端
 * LocalizationManager.updateById 的實際語意一致（逐語系 UPDATE、沒帶到的不動），
 * 這裡先合併是為了讓 round-trip 比對時能拿到完整的預期值。
 */
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

export function registerCreateOrUpdateLiveTabTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_live_platform_create_or_update_live_tab',
        {
            title: 'Create or update one live-stream tab on this platform',
            description:
                '新增或修改本平台的一個直播頁籤（rajah: LivePlatform.CreateOrUpdateLiveTab），對應後台' +
                '「直播管理 > 直播頁籤」的編輯彈窗。不帶 id（或 id=0）表示新增，帶既有 id 表示修改。' +
                '修改時本工具會先呼叫 GetLiveTabs 讀現值，只覆蓋你有帶到的欄位，其餘原樣帶回；' +
                'id 不存在時先擋下、不送出 RPC。' +
                '各欄位的實際覆蓋語意不一樣，請留意：name／icon 是**逐語系合併**（只覆蓋你帶到的' +
                '語系代碼，其餘語系維持原值，帶空陣列等於不動）；layout 是**整包覆蓋**' +
                '（後端直接以你傳入的兩個陣列覆寫 normal_rows/repeated_rows）；position 是單純覆寫。' +
                '⚠️ 修改時 status 改不了（rajah 標 @Readonly、後端 update 分支也沒碰它），' +
                '要啟停請改用 aladdin_platform_live_platform_update_live_tab_status。' +
                '⚠️ 後端 update 只會對 live_tabs 表下 `UPDATE ... SET position = ?`（其餘欄位各走' +
                '各的 localization／section_layout 寫入路徑），並用 affectedRows===0 判成 ' +
                'objectNotFound；2026-08-28 dev 實測確認這條連線是以 matched rows 計數，' +
                '所以「position 維持原值、只改 name/icon/layout」是可以正常寫入的，不會被誤判。' +
                '⚠️ 新增時後端不回傳新 id，本工具用寫入前後的 id 集合差異反推；若同時間有別人也在' +
                '新增而無法唯一辨識，會列出候選 id 而不是用猜的。' +
                '⚠️ 本 service 沒有任何 delete method——建立出來的頁籤刪不掉，只能停用，新增前請確認。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）向使用者明確詢問是否要在正式環境執行，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會' +
                '忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().min(0).optional().describe(
                    '要修改的頁籤 id（來自 aladdin_platform_live_platform_get_live_tabs）；省略或 0 表示新增一筆',
                ),
                position: z.number().int().optional().describe(
                    '排序位置，數字越小越前面。修改時省略沿用現值，新增時省略預設 0',
                ),
                name: localizedTextSchema.optional().describe(
                    '頁籤名稱多語系陣列；新增時必填（至少一組 {code, value}），修改時省略沿用現值、有帶則逐語系合併',
                ),
                icon: localizedImageSchema.optional().describe(
                    '頁籤圖示多語系陣列，每筆是 {code, 以及 path／filePath／fileId 三選一}：' +
                    'path 直接沿用既有後端路徑、filePath 是 stdio 模式的本機圖片絕對路徑（本工具代為上傳）、' +
                    'fileId 是 hosted 模式先 POST /files 取得的。省略整個欄位沿用現值，有帶則逐語系合併',
                ),
                layout: z.object({
                    normalRows: sectionLayoutRowSchema.describe('一般版位列型態陣列（0=兩欄、1=橫幅、2=一大兩小）'),
                    repeatedRows: sectionLayoutRowSchema.describe('循環版位列型態陣列（同上編碼）'),
                }).optional().describe(
                    '版位配置；**整包覆蓋**，帶了就是以這兩個陣列取代原值。省略時沿用現值（現值不存在時送空陣列——' +
                    '後端會無條件解參照 layout，不能不帶）',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, position, name, icon, layout, confirm }) => {
            assertProdConfirmed(confirm);

            const beforeR = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveTabs());
            if (beforeR.failed) return asErrorResult(beforeR);
            const beforeRows = beforeR.data?.rows ?? [];

            const isEdit = id !== undefined && id > 0;
            let current: (typeof beforeRows)[number] | undefined;

            if (isEdit) {
                current = beforeRows.find((r) => r.id === id);
                if (!current) {
                    return asTextResult({
                        success: false,
                        message: `找不到 id=${ id } 的直播頁籤，未送出寫入請求。請先用 `
                            + 'aladdin_platform_live_platform_get_live_tabs 確認可用的 id',
                    });
                }
            }

            if (!isEdit && (!name || name.length === 0)) {
                return asTextResult({ success: false, message: '新增直播頁籤時 name 為必填（至少一組 {code, value}）' });
            }

            const currentPosition = current?.position ?? 0;
            const nextPosition = position !== undefined ? position : currentPosition;

            const nextName = mergeLocalizedStrings(name, current?.name);

            // 圖示：每個語系各自把 path/filePath/fileId 解析成後端路徑（需要時上傳），
            // 任何一筆有問題就整批中止、不做部分成功。
            const iconErrors: string[] = [];
            const resolvedIcon: { code: string; value: string }[] = [];
            for (const entry of icon ?? []) {
                const { code, ...upload } = entry as { code: string } & LiveImageInput;
                const path = await resolveLiveImagePath(`icon/${ code }`, LIVE_UPLOAD_IMAGE_TYPE.tabIcon, upload, iconErrors);
                if (path !== null) resolvedIcon.push({ code, value: path });
            }
            if (iconErrors.length > 0) {
                return asTextResult({
                    success: false,
                    message: '圖示參數處理失敗，未送出寫入請求（已上傳的檔案不會被引用，可忽略）',
                    errors: iconErrors,
                });
            }
            const nextIcon = mergeLocalizedStrings(icon === undefined ? undefined : resolvedIcon, current?.icon);
            const nextLayout = SectionLayout.create({
                normalRows: layout ? layout.normalRows : (current?.layout?.normalRows ?? []),
                repeatedRows: layout ? layout.repeatedRows : (current?.layout?.repeatedRows ?? []),
            });

            const payload = LiveTabEdit.create({
                id: id ?? 0,
                position: nextPosition,
                name: nextName,
                icon: nextIcon,
                layout: nextLayout,
            });

            const writeR = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.CreateOrUpdateLiveTab(payload));
            if (writeR.failed) return asErrorResult(writeR);

            const afterR = await withAutoRelogin(() => remote.liveBackOffice.livePlatform.GetLiveTabs());
            if (afterR.failed) {
                return asTextResult({
                    success: true,
                    mode: isEdit ? 'update' : 'create',
                    message: '寫入 RPC 回報成功，但寫入後讀回驗證失敗，無法確認實際結果，請自行用 '
                        + 'aladdin_platform_live_platform_get_live_tabs 確認',
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
                        ? '修改完成，請比對 tab 內容確認未指定的欄位都維持原值'
                        : '寫入 RPC 已成功，但讀回時比對不到這個 id，請自行用 get_live_tabs 確認目前狀態',
                    tab: after ?? null,
                });
            }

            const beforeIds = new Set(beforeRows.map((r) => r.id));
            const newIds = afterRows.filter((r) => !beforeIds.has(r.id)).map((r) => r.id);
            if (newIds.length === 1) {
                return asTextResult({
                    success: true,
                    mode: 'create',
                    message: '新增完成（提醒：本 service 沒有 delete method，這筆頁籤之後只能停用、無法刪除）',
                    tab: afterRows.find((r) => r.id === newIds[ 0 ]) ?? null,
                });
            }
            return asTextResult({
                success: true,
                mode: 'create',
                message: newIds.length === 0
                    ? '新增完成，但寫入後讀回比對不到新增的頁籤（可能被同時間的其他操作影響），請自行用 get_live_tabs 確認'
                    : `新增完成，但無法唯一辨識新建的頁籤 id（偵測到 ${ newIds.length } 筆新 id，可能有其他人同時也在新增），候選 id 列於 candidateIds`,
                candidateIds: newIds,
            });
        },
    );
}
