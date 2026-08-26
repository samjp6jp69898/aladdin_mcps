/**
 * tools/new_user.ts — aladdin_platform_platform_new_user
 *
 * rajah: Platform.NewUser(account string 1, password string 2, roleId i32 3)
 * （rajah/services/platform.rajah:87-88，@Permission "AdminManagement.Permission.Users.Add"）。
 *
 * ⚠️ 這支建立的是真正可登入的「platform 後台管理員帳號」（後台登入帳號，非 app 一般會員），跟
 * aladdin_platform_platform_list_users/update_user_status 是同一批資料。method-category-checklist.md
 * 第 8 節「敏感資料/憑證」與第 10 節「Login/Register」的規則適用：password 是明文輸入的憑證，zod
 * schema 標記為 sensitive；本工具的存在會讓呼叫端具備「建立新的、擁有指定角色權限的後台登入帳號」的
 * 能力，屬於安全敏感操作。
 *
 * 2026-08-26 曾先用 needs_clarification 暫緩本任務，理由是「roleId 帶隱含的 Select:Role 語意，但當時
 * 查證誤判 platform gate 沒有公開介面可以列出合法 roleId」——經批次總體 review（獨立 reviewer B）指出
 * 這個查證有誤：`Role.GetPlatformIdRoles()`（非 `Role.GetChildRoles()`）其實是真實可用的公開方法，已
 * 補實作為 aladdin_platform_role_get_platform_id_roles 並實測確認可用，因此改為正式實作本工具而非
 * 繼續 needs_clarification（見同批次 commit 訊息的更正記錄）。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:178-203（methodNewUser）確認有真實實作。
 *
 * 分類：method-category-checklist.md 第 3 節「寫入 — 新增」+ 第 10 節「Login/Register」：
 * 2026-08-26 讀 agrabah 後端原始碼查證（platform.ts:178-203，password_login_provider.ts:40-52）：
 * - **roleId 必須是登入者角色的子角色**：`ensureChildRole` 內部呼叫 `RoleInternal.IsChildRole` 沿
 *   `parentId` 鏈往上找，找到就是子角色，鏈斷在 0（找不到）就不是——是子角色的合法拒絕情境回
 *   `invalidData`（database_helper.ts:253）。⚠️ 但 **roleId 完全不存在時是另一個真實後端 bug，不是
 *   `invalidData`**：`role_internal.ts:488-497` 的 `while` 迴圈用 `loadObject('id = ?', [currentId])`
 *   查角色，查無資料時（同 update_user_status.ts 檔頭記錄過的同一種模式）`loadObject` 回傳
 *   `success+null`、不是 failed，但緊接著程式碼直接存取 `queryRoleResult.data.parentId`，對 `null`
 *   解參照拋例外，被框架接住後回傳泛用的 `unknown`（errorCode=1，2026-08-26 dev 實測對不存在的
 *   roleId=999999 呼叫確認過）。也就是說呼叫端拿到 errorCode=1 時，代表的可能是「roleId 根本不存在」
 *   而非「roleId 存在但不是子角色」，這兩種情況目前無法從錯誤碼區分，本工具無法修正這個既有 bug，
 *   description 已如實揭露。呼叫端應先用 aladdin_platform_role_get_platform_id_roles 確認 roleId
 *   真的存在於清單裡，再挑選子角色，降低誤觸這個 bug 的機率。
 * - **帳號重複**：`account` 已存在（同 platformId+provider 底下）回 `userExists`（AgrabahErrorCodeEnum），
 *   不會覆蓋既有帳號。
 * - **密碼儲存**：後端用 `Bun.password.hash`（argon2id）雜湊儲存，本工具的 `password` 參數只在建立當下
 *   明文傳輸一次，之後任何查詢方法都不會回傳明文或雜湊值；MCP 層看不到密碼、也無法查詢已建立帳號的
 *   密碼，description 提醒呼叫端妥善保管這個密碼（後端無「忘記密碼自助查詢」機制，只有
 *   aladdin_platform_platform_update_user_status 可停用帳號，密碼重設是另一支高風險 method
 *   Platform.UpdatePassword，本輪判定 needs_clarification 未實作）。
 * - **後端無密碼強度驗證，MCP 層補強**：讀原始碼確認 `register()` 沒有對 `token`（密碼）做任何
 *   長度/複雜度檢查，理論上能建立一位數密碼的帳號；zod schema 已加上 `min(8)` 作為 MCP 層的最低限度
 *   防禦性補強（獨立 review 建議），完整複雜度仍由呼叫端自行把關。
 * - **建立後無法刪除，只能停用**：`Platform` 沒有對應的 Delete 方法，只有
 *   aladdin_platform_platform_update_user_status 可切換 enabled/disabled；建立測試帳號後如果不再需要，
 *   應立即呼叫該工具停用，帳號本身會永久保留在資料庫（軟性殘留，非本工具能避免）。
 * - **無回傳值**：`NewUser` 的 rajah 簽名沒有回傳欄位（含新建帳號的 id），需另外呼叫
 *   aladdin_platform_platform_list_users（account 篩選）讀回取得新帳號的 id 才能後續操作（如停用）。
 *
 * 2026-08-26 dev 實測：建立一個測試帳號（account 帶時間戳避免撞名）、round-trip 用 list_users 讀回
 * 確認建立成功且 roleId 正確、立即用 update_user_status 停用該測試帳號（無法刪除，已停用將風險降到最低，
 * 但帳號本身仍永久存在於 dev DB，如實記錄非殘留清理疏失）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerNewUserTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_new_user',
        {
            title: 'Create a new platform back-office admin user',
            description:
                '建立一個新的「platform 後台管理員帳號」（真正可登入，非 app 一般會員），需要 ' +
                '@Permission "AdminManagement.Permission.Users.Add"。' +
                '⚠️ roleId 必須是登入者角色的子角色（後端強制檢查，非子角色一律拒絕回 invalidData，errorCode=9）；' +
                '請先呼叫 aladdin_platform_role_get_platform_id_roles 取得候選角色清單（含 parentId 階層），' +
                '挑一個合理的子角色 id，實際是否合法由後端裁定。' +
                '⚠️ roleId 若完全不存在（不在角色清單裡），會觸發後端既有 bug 回 errorCode=1（unknown）而非' +
                'invalidData——這兩種錯誤情況目前從錯誤碼無法區分，務必先用 ' +
                'aladdin_platform_role_get_platform_id_roles 確認 roleId 真的存在再呼叫。' +
                'account 已存在會拒絕（userExists），不會覆蓋既有帳號。' +
                'password 明文傳輸一次、後端雜湊儲存，之後任何查詢都拿不回明文或雜湊值，請呼叫端自行妥善' +
                '保管；後端對密碼沒有長度/複雜度檢查，呼叫端自行確保密碼品質。' +
                '⚠️ 本方法無回傳值（沒有新帳號的 id），需另外呼叫 aladdin_platform_platform_list_users' +
                '（用 account 篩選）讀回才能取得 id 供後續操作。' +
                '⚠️ 建立後無法刪除，只能用 aladdin_platform_platform_update_user_status 停用——如果是臨時' +
                '測試用途，建立後應立即停用，帳號本身仍會永久保留在資料庫。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上' +
                'confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                account: z.string().min(1).describe('新帳號的登入帳號（識別碼），同平台底下不可重複'),
                password: z.string().min(8).describe(
                    '新帳號的登入密碼（明文，敏感資料）。後端本身對密碼沒有長度/複雜度檢查，本工具在 MCP 層' +
                    '額外要求至少 8 碼作為防禦性補強（後端無強度驗證時的最低限度把關）。密碼雜湊儲存，建立後' +
                    '任何查詢都拿不回這個值，請呼叫端自行妥善保管，不要原樣寫入持久化 log',
                ),
                roleId: z.number().int().describe(
                    '角色 id，必須是登入者角色的子角色。來自 aladdin_platform_role_get_platform_id_roles 的回傳結果',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ account, password, roleId, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.platform.main.NewUser(account, password, roleId));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                account,
                roleId,
                note: '本方法無回傳值，請呼叫 aladdin_platform_platform_list_users（account 篩選）讀回取得新帳號 id',
            });
        },
    );
}
