/**
 * tools/create_platform.ts — aladdin_admin_platform_management_create_platform
 *
 * rajah: PlatformManagement.CreatePlatform（admin.rajah:119），無回傳值（Empty，
 * PlatformManagementCreatePlatformResponse 在 types.gen.ts 直接 alias Empty）。
 * agrabah 實作（agrabah/src/servers/admin/services/platform_management.ts:63
 * methodCreatePlatform）先轉呼叫 @NoPublic 的 CoreAdmin.CreatePlatform
 * （core.rajah:222，實作於 agrabah/src/servers/core_back_office/services/core_admin.ts:71，
 * 回傳 platformId，但這個 platformId 不會被 PlatformManagementService 往外傳，所以外部呼叫端
 * 永遠拿不到新建平台的 id，只能事後用 code 去 ListPlatformDetails 撈回來），成功後接著在同一支
 * method 內連動建立 admin/app 兩組 LoginProvider、建立預設遊戲分類，並各發送 4 個非同步初始化
 * Job（UserLevelOnPlatformCreate/CreateVipSettingJob/CreateUserCharacterJob/
 * AgentOnPlatformCreatedJob）與 1 個 ReloadPlatform Message——是一次性、連動大量下游初始化的
 * 重度操作，不是單純插入一筆資料的輕量 create。
 *
 * **2026-08-24 dev 實測（abu/admin 目錄下 _test_tmp_CreatePlatform{,2}.ts，測完已刪除）**：
 * - 已確認的資料陷阱（讀原始碼 core_admin.ts:75/77 的 "// TODO : check default currency code" /
 *   "// TODO : check default language code" 註解 + 實測驗證）：defaultCurrencyCode **完全沒有**
 *   後端驗證，帶一個不存在的幣別代碼 RPC 一樣回成功，會建出一個 defaultCurrencyCode 指向不存在
 *   幣別的壞平台；defaultLanguageCode **有**後端驗證（比對 platform_supported 全域語系清單），
 *   不合法會回 errorCode=7（requestNotValid），已用一個全新 code + 不存在的 languageCode
 *   實測觸發、並確認因為在同一個 doTransaction 內失敗會整包 rollback、不會留下孤兒 platform 記錄
 *   （寫入前後兩次 ListPlatformDetails 比對確認該 code 沒有出現）。
 * - code 重複會回 errorCode=13（duplicatedData，DB `platforms.code` 有 `UNIQUE` 約束，
 *   欄位型別 `VARCHAR(4)`，已用既有 code="MAIN" 實測觸發）。
 * - 真實建立一筆測試平台驗證 round-trip：code="ZT01"、defaultCurrencyCode="INR"（來自
 *   CurrencyAdmin.GetCurrencies 讀到的真實值）、defaultLanguageCode="en-US"（來自
 *   Setting.GetSupportedLanguages 讀到的真實值）、timezone=28800，CreatePlatform 回
 *   errorCode=0，重新呼叫 ListPlatformDetails 讀回確認出現 { id: 39, code: "ZT01",
 *   defaultCurrencyCode: "INR", defaultLanguageCode: "en-US", status: 1, timezone: 28800 }。
 * - **這筆測試平台會永久留在 dev 環境上**：已對整個 rajah/services/*.rajah 做過 grep，
 *   全庫沒有任何 DeletePlatform / UpdatePlatformStatus 之類可以刪除或停用「平台」本身的 RPC
 *   （platform 底下的子資源如場館、域名、幣別各自有自己的狀態切換 method，但「平台」這個實體
 *   本身沒有）；abu/admin 前端 PlatformList.vue 的 StatusEnumToggle 按鈕（onToggle()）讀原始碼
 *   確認只修改本地變數 `row.status = newStatus`、完全沒有呼叫任何後端 RPC，是死碼，UI 上看起來
 *   能停用、實際上不會送出任何請求。這是 CreatePlatform 這支 method 本身的結構性限制（新增平台
 *   在這個系統裡被視為一次性、不可逆的部署動作），不是本次新增這支 MCP tool 造成的，操作者需知悉
 *   這件事：任何一次成功呼叫都無法在系統內復原，只能請有 DB 存取權的人手動處理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerCreatePlatformTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_platform_management_create_platform',
        {
            title: 'Create a new platform (irreversible, heavy operation)',
            description:
                '建立一個全新的平台租戶（rajah: PlatformManagement.CreatePlatform，admin.rajah:119）。' +
                '這不是單純新增一筆資料：成功後會連動建立 admin/app 兩組登入方式、建立預設遊戲分類、' +
                '觸發 4 個非同步初始化 Job（會員等級、VIP 設定、使用者角色、代理商）與 1 個快取重載訊息，' +
                '是重度、連動下游多個服務的一次性操作。' +
                '**不可逆**：截至 2026-08-24 讀源碼 + 逐一 grep 全部 rajah/services/*.rajah 確認，' +
                '系統內沒有任何刪除或停用「平台」本身的 RPC（前端狀態切換按鈕是沒有實際呼叫後端的死碼），' +
                '呼叫成功後這個平台會永久留在該環境，只能請有資料庫存取權的人事後手動處理，因此本工具' +
                '呼叫前務必先用 aladdin_admin_platform_management_list_platform_details 確認真的沒有' +
                '同名或功能重複的既有平台可用。' +
                'code 欄位有 DB unique 限制（VARCHAR(4)，最多 4 字元），本工具會在送出前先查一次現有平台' +
                '清單擋下重複值；重複值後端也會回 errorCode=13（duplicatedData）。' +
                '⚠️ defaultCurrencyCode 資料陷阱（2026-08-24 讀源碼 core_admin.ts:75 的 TODO 註解確認）：' +
                '後端完全不驗證這個值是否存在於幣別主表，帶一個不存在的幣別代碼 RPC 一樣會成功，' +
                '但會建出一個幣別欄位指向不存在資料的壞平台；本工具會在送出前先用 CurrencyAdmin.GetCurrencies ' +
                '查一次現有幣別清單並比對，值不在清單內會直接擋下、不送出建立請求（後端不會幫你擋）。' +
                'defaultLanguageCode 後端有真的驗證（比對全域支援語系清單，不合法回 errorCode=7 ' +
                'requestNotValid，已實測確認失敗時整個 transaction 會 rollback、不會留下孤兒資料），' +
                '本工具同樣會先用 Setting.GetSupportedLanguages 查一次合法清單並比對，提前給出清楚訊息。' +
                'CreatePlatform 這支 RPC 本身不回傳新建平台的 id（回傳型別是 Empty），本工具建立成功後' +
                '會重新呼叫 ListPlatformDetails 用 code 讀回驗證，讀不到不代表一定失敗（後台清單目前是' +
                '同步查詢、理論上立即可見，若真的讀不到請人工用 code 再查一次確認）。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確' +
                '同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）' +
                '不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                code: z.string().min(1).max(4).describe(
                    '平台代碼，最多 4 字元（DB: platforms.code VARCHAR(4)，全平台唯一），建立後無法更改' +
                    '（本工具與後台皆未提供編輯 code 的功能）。重複值會被本工具事先擋下，或由後端回 errorCode=13。',
                ),
                defaultCurrencyCode: z.string().min(1).describe(
                    '預設幣別代碼（如 CNY、USD、INR），必須是既有幣別主表裡的值——本工具會呼叫 ' +
                    'CurrencyAdmin.GetCurrencies 驗證，不在清單內會直接擋下（後端本身不驗證這個值，見上方 description 的資料陷阱說明）。',
                ),
                defaultLanguageCode: z.string().min(1).describe(
                    '預設語系代碼（如 zh-CN、en-US），必須是全域支援語系清單裡的值——本工具會呼叫 ' +
                    'Setting.GetSupportedLanguages 驗證；後端也會驗證，不合法回 errorCode=7（requestNotValid）。',
                ),
                timezone: z.number().int().describe(
                    '時區偏移秒數（不是時區名稱），例如 UTC+8 為 28800、UTC 為 0、UTC-5 為 -18000。',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ code, defaultCurrencyCode, defaultLanguageCode, timezone, confirm }) => {
            assertProdConfirmed(confirm);

            const [ existingR, currenciesR, languagesR ] = await Promise.all([
                withAutoRelogin(() => remote.admin.platformManagement.ListPlatformDetails()),
                withAutoRelogin(() => remote.coreBackOffice.currencyAdmin.GetCurrencies(false)),
                withAutoRelogin(() => remote.coreBackOffice.setting.GetSupportedLanguages()),
            ]);

            if (existingR.failed) return asErrorResult(existingR);
            const dup = existingR.data?.platforms?.find((p) => p.code === code);
            if (dup) {
                return asTextResult({
                    success: false,
                    message: `平台代碼 "${ code }" 已存在（platformId=${ dup.id }），DB 有 unique 限制，未送出建立請求。`,
                    existingPlatform: dup,
                });
            }

            if (currenciesR.failed) return asErrorResult(currenciesR);
            const validCurrencyCodes = (currenciesR.data?.currencies ?? []).map((c) => c.code);
            if (!validCurrencyCodes.includes(defaultCurrencyCode)) {
                return asTextResult({
                    success: false,
                    message: `defaultCurrencyCode="${ defaultCurrencyCode }" 不在現有幣別清單中，未送出建立請求` +
                        '（後端本身不會驗證這個值，帶錯值會建出壞資料，所以本工具主動擋下）。',
                    knownCurrencyCodes: validCurrencyCodes,
                });
            }

            if (languagesR.failed) return asErrorResult(languagesR);
            const validLanguageCodes = languagesR.data?.languages ?? [];
            if (!validLanguageCodes.includes(defaultLanguageCode)) {
                return asTextResult({
                    success: false,
                    message: `defaultLanguageCode="${ defaultLanguageCode }" 不在支援語系清單中，未送出建立請求` +
                        '（後端也會擋，這裡先幫你擋下並給清楚訊息，避免拿到語意不明的 errorCode=7）。',
                    knownLanguageCodes: validLanguageCodes,
                });
            }

            const createR = await withAutoRelogin(() => remote.admin.platformManagement.CreatePlatform(code, defaultCurrencyCode, defaultLanguageCode, timezone));
            if (createR.failed) return asErrorResult(createR);

            // CreatePlatform 回傳型別是 Empty，拿不到新建平台的 id，只能重新查一次清單用 code 找回來。
            const afterR = await withAutoRelogin(() => remote.admin.platformManagement.ListPlatformDetails());
            const created = afterR.success ? afterR.data?.platforms?.find((p) => p.code === code) : undefined;

            return asTextResult({
                success: true,
                message: created
                    ? '建立成功，已重新查詢平台清單讀回驗證。此平台目前系統內沒有任何刪除/停用機制，請妥善記錄。'
                    : '建立成功（RPC 回傳無資料可驗證），但重新查詢平台清單時用 code 找不到剛建立的紀錄——' +
                        '可能是清單查詢當下的暫時性問題，請人工用 aladdin_admin_platform_management_list_platform_details 再次確認。',
                platform: created ?? null,
            });
        },
    );
}
