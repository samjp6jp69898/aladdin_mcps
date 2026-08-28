/**
 * tools/update_app.ts — aladdin_platform_app_platform_create_or_update_app
 *
 * rajah: AppPlatform.CreateOrUpdateApp(app PlatformAppEdit 1)
 * （rajah/services/app_back_office.rajah:176，@Permission "PlatCapCfg.PsConfig.AppList"，
 * service AppPlatform 定義於同檔 171-222 行；model PlatformAppEdit 在同檔 44-55 行）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：方法名非 `Placeholder*` 前綴（本 service 的
 * 4 支真 Placeholder 在 212/215/218/221 行）；service AppPlatform 無 @NoPublic；agrabah 對應實作
 * AppPlatformService.methodCreateOrUpdateApp
 * （agrabah/src/servers/app_back_office/services/app_platform.ts:156-221）確認有真實 override。
 *
 * 分類：method-category-checklist.md 第 4 節「Upsert/CreateOrUpdate」。
 *
 * ⚠️ **本工具刻意只開放 update 分支（appId 必填且必須 > 0），不提供新增**：後端用
 * `dbPlatformApp.id > 0` 分流（app_platform.ts:184-194），`id=0` 會走 insertObject 建立新 App，
 * 但**全 rajah 沒有任何刪除或停用 platform App 的 method**（app_back_office.rajah 全檔沒有
 * DeleteApp/RemoveApp/UpdateAppStatus 之類，model PlatformAppEdit 也沒有 status 欄位；
 * DB 表 platform_apps 只有 id/appGroupId/appThemeId 三個業務欄位，
 * agrabah/src/database_types/app.ts:24-30），新增下去無法用任何 API 復原。依「不可逆寫入需使用者
 * 裁示」的作業規範，新增分支不在本工具範圍內；需要新增 App 請走後台 UI 或另行請示。
 *
 * ⚠️ **必須先讀現值再送整包**（2026-08-28 讀源碼查證，第二輪 review 修正過一次機制描述）：
 * DB 表 platform_apps 的業務欄位只有 `app_group_id` / `app_theme_id`（app.ts:24-30）。後端拿
 * `DbPlatformApp.create(app)`（app_platform.ts:180）再 `updateObject(dbPlatformApp, false)`
 * （同檔 185）。**注意 `updateObject` 第二個參數 `false` 的語意是 `notModifiedIsError = false`
 * （「沒有任何欄位變動時不算錯誤」，agrabah/src/engines/relational_database/mysql/
 * mysql_relational_database_engine.ts:206、234-236），跟「有沒有合併」無關**；`updateObject` 本身
 * 其實**有** pre-load（同檔 214 先 loadObject 讀現值）與欄位級 diff（229-232 只把「與現值不同且非
 * undefined」的欄位放進 SET），屬於 checklist 第 4 節的第 2 種模式（assignKey 型），不是第 3 種
 * 「整包覆蓋」。
 *
 * 但**第 4 節對第 2 種模式列出的地雷在這裡是真的**：protobuf 的數字欄位未設值時是 0，這個 0 會被當成
 * 「呼叫端明確要設成 0」通過 diff 寫進 DB。實際可被靜默歸零的只有 `appThemeId`——`appGroupId` 傳 0
 * 會先被 app_platform.ts:160-167 的存在性檢查擋成 invalidData、走不到寫入，而 `appThemeId` 在
 * 同檔 169 對 0 直接跳過檢查。因此本工具一律先呼叫 ListApps 取得該 App 的完整現值，只覆寫呼叫端
 * 明確要改的欄位，其餘原樣帶回（這也是第 4 節第 1 點的無條件要求，不因為後端落在哪一種模式而放寬）。
 *
 * 多語系欄位（name / logo / banner）的後端語意（localization_manager.ts:61-64 updateById、
 * 470-481 updateLocalizations、16-48 的共用 `update()` helper）：對傳入陣列裡的**每個語系代碼**各下
 * 一次 `UPDATE id_localizations SET value=? WHERE ... AND code=?`；影響列數 > 0 就結束，
 * **沒有出現在陣列裡的語系代碼一律原樣保留、不會被刪除**；傳空陣列則整段不執行、什麼都不動。
 * 本工具仍採「現值 + 覆寫」的完整陣列送出（而不是只送要改的語系），在上述語意與「整包覆蓋」
 * 兩種假設下都正確。
 *
 * ⚠️ **新增一個原本不存在的語系時，value 不能是空字串**：`update()` helper 在 UPDATE 影響 0 列後
 * 才走 INSERT，而 INSERT 前有一道 `if (!localization.value) continue`（localization_manager.ts:33-35），
 * 空字串會被**靜默丟棄**、不新增也不報錯。本工具因此把 zod 的 `value` 收成 `min(1)`，從入口擋掉這個
 * 靜默失敗；要清空一個既有語系的值不在本工具範圍內（既有語系走 UPDATE 分支，空字串是寫得進去的，
 * 但為了不讓同一個欄位在「既有/新增」兩種情況下語意分歧，一律不接受空字串）。
 *
 * 後端前置驗證（app_platform.ts:160-180，errorCode 皆為 invalidData）：
 * 1. `appGroupId` 必須存在於 `platform_app_groups WHERE platform_id = <當前平台> AND app_group_id = ?`
 *    ——也就是必須是本平台**已啟用**的群組（合法值來源：aladdin_platform_app_platform_list_app_groups）。
 * 2. `appThemeId != 0` 時必須存在於 `app_themes WHERE app_group_id = ? AND id = ?`，
 *    也就是 theme 必須屬於同一個 appGroupId（合法值同樣來自上面那支 tool 每筆的 `themes` 陣列）。
 * 本工具在送出前先用同一份資料自行檢查這兩條，把後端籠統的 invalidData 換成明確訊息。
 *
 * 副作用（不可關閉，非本工具新增）：成功後 publish `ReloadAppData`（快取刷新）並寫一筆平台操作
 * 稽核日誌 `PlatformActionIdEnum.appUpdate`（app_platform.ts:205 publish、218 audit）。稽核紀錄依設計保留，
 * 即使把欄位改回原值也不會消除該筆日誌。
 *
 * 驗收（checklist 第 4 節第 2 點）：寫入後重新呼叫 ListApps 讀回，逐欄比對「沒有要求變更的欄位」
 * 是否仍等於呼叫前的值（`unchangedFieldsIntact`）與「有要求變更的欄位是否真的變成要求值」
 * （`requestedChangesApplied`），不以 RPC 不報錯當成業務正確。
 *
 * ⚠️ **併發下會 lost update，而且本工具的驗收機制抓不到**（2026-08-28 對抗性覆核指出，據實揭露）：
 * 這支是純 read-modify-write（先 ListApps 讀現值 → 合併 → CreateOrUpdateApp 寫回），rajah 與後端
 * 都沒有版本號或樂觀鎖可用，兩個呼叫端（或一個 agent 加一個真人後台）同時編輯同一個 App 時，
 * 後寫者會靜默覆蓋前者的 name/logo/banner。更要注意的是 `unchangedFieldsIntact` 是拿 after 跟
 * **本次呼叫自己那份 before 快照**比對，不是跟寫入當下的實際值比對——併發覆蓋發生時它照樣回 true。
 * 也就是 checklist 第 4 節第 2 點的 round-trip 驗證在併發情境下不具備偵測能力，別把它當成「沒有
 * 被別人蓋掉」的證據。
 *
 * 🔒 **安全關鍵，不可為了少一次 RPC 而移除**：handler 裡「先在 ListApps 結果找得到這個 appId 才繼續」
 * 這一段（本檔 `beforeList` / `before` 那兩步）**是這支 tool 唯一的跨租戶防線**，不是單純的 UX 改善。
 * 理由：後端 `methodCreateOrUpdateApp`（app_platform.ts:156-221）**從頭到尾沒有呼叫**同檔 56-64 的
 * `checkAppIdBelongsToPlatform`（只有 CreateOrUpdateAppVersion / ListDownloadLinks /
 * CreateOrUpdateDownloadLink 有呼叫），而 `updateObject` 下的 SQL 是
 * `UPDATE platform_apps SET ... WHERE id = ?`（mysql_relational_database_engine.ts:253）、
 * **沒有 platform_id 條件**；又因為 app_platform.ts:183 會把 `dbPlatformApp.platformId` 設成
 * 呼叫者的 platformId，對別平台的 App id 而言這個值與現值不同、會進 diff，該列會被**改嫁到
 * 呼叫者的平台**。ListApps 是平台綁定的（app_platform.ts:129 用 context.platformId），
 * 用它先擋一次，才讓這支 tool 拿不到別平台的 appId。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformAppEdit, LocalizationString } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

/** 後端 ILocalizationString 的 code/value 都是 optional + nullable，這裡統一收斂成非空字串再處理。 */
type Localized = { code?: string | null; value?: string | null };

const localizedSchema = z.array(z.object({
    code: z.string().min(1).describe('語系代碼，例如 zh-CN / zh-TW / en-US'),
    value: z.string().min(1).describe(
        '該語系的值，不接受空字串——後端對「原本不存在的語系」帶空字串會靜默丟棄不新增' +
        '（localization_manager.ts:33-35），為避免同一欄位在既有/新增兩種情況下語意分歧，一律擋在入口',
    ),
}));

/** 以 code 為鍵把 overrides 疊到 current 上：同 code 覆蓋、新 code 追加、未提及的 code 原樣保留。 */
function mergeLocalized(current: ReadonlyArray<Localized> | null | undefined, overrides?: ReadonlyArray<Localized>): Array<{ code: string; value: string }> {
    const merged = (current ?? [])
        .filter(item => !!item.code)
        .map(item => ({ code: item.code as string, value: item.value ?? '' }));
    for (const override of overrides ?? []) {
        if (!override.code) { continue; }
        const hit = merged.find(item => item.code === override.code);
        if (hit) { hit.value = override.value ?? ''; } else { merged.push({ code: override.code, value: override.value ?? '' }); }
    }
    return merged;
}

function sameLocalized(a: ReadonlyArray<Localized> | null | undefined, b: ReadonlyArray<Localized> | null | undefined): boolean {
    const norm = (list?: ReadonlyArray<Localized> | null) => (list ?? []).map(i => `${ i.code ?? '' }=${ i.value ?? '' }`).sort().join('|');
    return norm(a) === norm(b);
}

export function registerUpdateAppTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_app_platform_create_or_update_app',
        {
            title: 'Update an existing app of the current platform',
            description:
                '修改當前平台既有 App 的設定（rajah: AppPlatform.CreateOrUpdateApp，需要權限節點 ' +
                'PlatCapCfg.PsConfig.AppList）。可改的欄位：多語系名稱 name、多語系 logo / banner 圖片路徑、' +
                '所屬群組 appGroupId、主題 appThemeId。' +
                '⚠️ **本工具只做「修改既有 App」，不能新增 App**：後端雖然是 upsert，但全系統沒有任何刪除或' +
                '停用 App 的 API，誤建的 App 無法用任何工具復原，因此新增分支刻意不開放。' +
                '⚠️ 後端沒有「只更新你帶到的欄位」這種保護：protobuf 未設值的數字欄位是 0，會被當成' +
                '「明確要設成 0」寫進 DB（appGroupId=0 會先被存在性檢查擋掉，實際會被靜默歸零的是 appThemeId）。' +
                '本工具因此一律先呼叫 ' +
                'aladdin_platform_app_platform_list_apps 讀取該 App 的完整現值，只覆寫你明確帶到的欄位，' +
                '其餘原樣送回；你不需要（也不應該）為了保留其他欄位而自行重送全部值。' +
                '多語系欄位是「以語系代碼為鍵」疊加：只帶 zh-CN 就只改 zh-CN，其他語系原樣保留；' +
                '帶一個不存在的語系代碼則是新增該語系（value 不接受空字串，後端對新增語系的空值會靜默丟棄）。' +
                'appId 的合法值來自 aladdin_platform_app_platform_list_apps；' +
                'appGroupId / appThemeId 的合法值來自 aladdin_platform_app_platform_list_app_groups' +
                '（appGroupId 必須是本平台已啟用的群組、appThemeId 必須屬於同一個群組）。' +
                '⚠️ 本工具的前置檢查**只有在你有帶 appGroupId 或 appThemeId 時才會執行**：若你只改 name/logo/banner，' +
                '而這個 App 現存的 appGroupId 已不在本平台的已啟用群組裡，後端仍會用 invalidData 擋下整筆寫入，' +
                '這種情況請先用 aladdin_platform_app_platform_list_app_groups 確認該 App 的群組還在。' +
                '成功後會寫一筆平台操作稽核日誌（不可關閉，把值改回去也不會消除該筆日誌），' +
                '並自動重新讀回逐欄比對，回傳 before/after、「未要求變更的欄位是否保持原值」' +
                '（unchangedFieldsIntact）與「有要求變更的欄位是否真的變成要求值」（requestedChangesApplied）' +
                '兩組驗證結果。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上' +
                'confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                appId: z.number().int().positive().describe(
                    '要修改的 App id（必填，必須大於 0）。合法值來自 aladdin_platform_app_platform_list_apps 的 rows[].id；' +
                    '不接受 0（新增分支不開放，理由見工具說明）',
                ),
                name: localizedSchema.optional().describe(
                    'App 名稱的多語系覆寫；只列出要改的語系即可，未列出的語系原樣保留。省略代表完全不動 name',
                ),
                logo: localizedSchema.optional().describe(
                    'App logo 圖片路徑的多語系覆寫（值是相對路徑字串如 /static/app/xxx，不是完整 URL、不是 base64；' +
                    '本工具不做圖片上傳）。只列出要改的語系即可。省略代表完全不動 logo',
                ),
                banner: localizedSchema.optional().describe(
                    'App banner 圖片路徑的多語系覆寫（格式同 logo）。只列出要改的語系即可。省略代表完全不動 banner',
                ),
                appGroupId: z.number().int().positive().optional().describe(
                    '要改成的 App 群組 id；必須是本平台已啟用的群組（來自 aladdin_platform_app_platform_list_app_groups 的 rows[].id）。' +
                    '省略代表沿用現值',
                ),
                appThemeId: z.number().int().nonnegative().optional().describe(
                    '要改成的 App 主題 id；必須屬於生效後的 appGroupId 底下（來自 aladdin_platform_app_platform_list_app_groups ' +
                    '對應群組的 themes[].id）。0 代表「不指定主題」（後端對 0 會跳過歸屬檢查）。省略代表沿用現值',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ appId, name, logo, banner, appGroupId, appThemeId, confirm }) => {
            assertProdConfirmed(confirm);

            const beforeList = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListApps());
            if (beforeList.failed) return asErrorResult(beforeList, { stage: 'read-current' });

            const before = (beforeList.data?.rows ?? []).find(row => row.id === appId);
            if (!before) {
                return asTextResult({
                    success: false,
                    stage: 'read-current',
                    message: `當前平台底下找不到 id=${ appId } 的 App`,
                    hint: '先呼叫 aladdin_platform_app_platform_list_apps 取得本平台合法的 App id；App 不會跨平台共用',
                    availableAppIds: (beforeList.data?.rows ?? []).map(row => row.id),
                });
            }

            const nextAppGroupId = appGroupId ?? before.appGroupId;
            const nextAppThemeId = appThemeId ?? before.appThemeId;

            // 後端只回籠統的 invalidData，這裡先用同一份資料自行檢查，把失敗原因講清楚
            if (appGroupId !== undefined || appThemeId !== undefined) {
                const groups = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListAppGroups());
                if (groups.failed) return asErrorResult(groups, { stage: 'validate-app-group' });

                const rows = groups.data?.rows ?? [];
                const group = rows.find(row => row.id === nextAppGroupId);
                if (!group) {
                    return asTextResult({
                        success: false,
                        stage: 'validate-app-group',
                        message: `appGroupId=${ nextAppGroupId } 不是本平台已啟用的 App 群組`,
                        hint: '合法值來自 aladdin_platform_app_platform_list_app_groups 的 rows[].id',
                        enabledAppGroupIds: rows.map(row => row.id),
                    });
                }
                if (nextAppThemeId !== 0 && !(group.themes ?? []).some(theme => theme.id === nextAppThemeId)) {
                    return asTextResult({
                        success: false,
                        stage: 'validate-app-theme',
                        message: `appThemeId=${ nextAppThemeId } 不屬於 appGroupId=${ nextAppGroupId } 這個群組`,
                        hint: 'theme 必須屬於同一個 appGroupId；合法值是該群組 themes[].id，或用 0 表示不指定主題',
                        availableThemeIds: (group.themes ?? []).map(theme => theme.id),
                    });
                }
            }

            const payload = PlatformAppEdit.create({
                id: appId,
                appGroupId: nextAppGroupId,
                appThemeId: nextAppThemeId,
                name: mergeLocalized(before.name ?? [], name).map(item => LocalizationString.create(item)),
                logo: mergeLocalized(before.logo ?? [], logo).map(item => LocalizationString.create(item)),
                banner: mergeLocalized(before.banner ?? [], banner).map(item => LocalizationString.create(item)),
            });

            const r = await withAutoRelogin(() => remote.appBackOffice.appPlatform.CreateOrUpdateApp(payload));
            if (r.failed) {
                return asErrorResult(r, {
                    stage: 'write',
                    hint: 'invalidData 通常代表 appGroupId 不是本平台已啟用的群組、或 appThemeId 不屬於該群組',
                });
            }

            const afterList = await withAutoRelogin(() => remote.appBackOffice.appPlatform.ListApps());
            if (afterList.failed) return asErrorResult(afterList, { stage: 'verify', note: '寫入已送出但讀回驗證失敗，請自行呼叫 list_apps 確認' });

            const after = (afterList.data?.rows ?? []).find(row => row.id === appId);
            if (!after) {
                return asTextResult({
                    success: false,
                    stage: 'verify',
                    message: `寫入已送出，但讀回時在本平台找不到 id=${ appId } 的 App`,
                    before,
                });
            }

            const requestedChangesApplied = {
                name: name === undefined ? null : (name ?? []).every(item => (after.name ?? []).some(x => x.code === item.code && x.value === item.value)),
                logo: logo === undefined ? null : (logo ?? []).every(item => (after.logo ?? []).some(x => x.code === item.code && x.value === item.value)),
                banner: banner === undefined ? null : (banner ?? []).every(item => (after.banner ?? []).some(x => x.code === item.code && x.value === item.value)),
                appGroupId: appGroupId === undefined ? null : after.appGroupId === appGroupId,
                appThemeId: appThemeId === undefined ? null : after.appThemeId === appThemeId,
            };

            const unchangedFieldsIntact = {
                name: name !== undefined || sameLocalized(before.name, after.name),
                logo: logo !== undefined || sameLocalized(before.logo, after.logo),
                banner: banner !== undefined || sameLocalized(before.banner, after.banner),
                appGroupId: appGroupId !== undefined || before.appGroupId === after.appGroupId,
                appThemeId: appThemeId !== undefined || before.appThemeId === after.appThemeId,
            };

            return asTextResult({
                success: true,
                mode: 'update',
                appId,
                before,
                after,
                unchangedFieldsIntact,
                allUnchangedFieldsIntact: Object.values(unchangedFieldsIntact).every(Boolean),
                requestedChangesApplied,
                allRequestedChangesApplied: Object.values(requestedChangesApplied).every(v => v === null || v === true),
                note: '已寫入一筆平台操作稽核日誌（appUpdate），無法透過任何 API 消除',
            });
        },
    );
}
