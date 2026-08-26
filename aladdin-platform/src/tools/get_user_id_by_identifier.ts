/**
 * tools/get_user_id_by_identifier.ts — aladdin_platform_activity_platform_get_user_id_by_identifier
 *
 * rajah: ActivityPlatform.GetUserIdByIdentifier(userIdentifier string 1) (userId i32 1,
 * identifier string 2)（activity_back_office.rajah:1782，service 定義於同檔 1767 行，非
 * @NoPublic，本方法無 @Permission）——用會員帳號（精準比對）查對應的內部 userId，給活動相關
 * 頁面以帳號搜尋會員用（rajah 註解原文）。
 *
 * **風險標注（無權限節點保護）**：同檔案內其他不掛 @Permission 的 method 通常有明文理由（如
 * `GetFissionActivityOptions`「活動編輯彈窗的 select 來源」、`GetActivityFlagUsages`「權限只
 * 控頁面顯示」），這支的 rajah 註解與 agrabah 實作 docstring 都**沒有**寫出「為何不掛」的理由，
 * 無法排除是漏掛而非刻意設計。實務影響：任何具備 platform 後台登入態的帳號，不需要任何權限
 * 節點即可呼叫，且可用 userNotExists(204) vs 成功兩種回應的差異，探測某個帳號字串是否是本
 * 平台的合法會員帳號（帳號枚舉風險）。description 已如實標注此風險。
 *
 * agrabah 對應實作
 * agrabah/src/servers/activity_back_office/services/activity_platform.ts:1277
 * methodGetUserIdByIdentifier，確認有真實實作：轉呼叫跨服務 RPC
 * `context.remote.appUserBackOffice.userData.GetUserInfoByIdentifier(platformId, userIdentifier)`
 * 取得 userId，非 base class 的 notImplemented stub。
 *
 * **同名 method 陷阱（已查證，不能假設行為一致）**：全 rajah 另有兩支同名但不同 service 的
 * `GetUserIdByIdentifier`——`admin.rajah:68`（service Admin，單一 `identifier` 參數，回傳
 * `id`）與 `platform.rajah:120`（service Platform，參數叫 `identifiers`（複數），可能是批次
 * 語意，本次未查證）。本 tool 只對應 `activity_back_office.rajah:1782` 這支
 * `ActivityPlatform.GetUserIdByIdentifier`，三支簽名/語意不保證相同，呼叫端不應假設。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆」——輸入單一業務鍵（帳號字串），回傳
 * 單一 model（userId + identifier）。userIdentifier 是精準比對（rajah 註解「精準比對」），
 * 非模糊搜尋。
 *
 * 無 PII 遮罩疑慮：回傳只有內部 userId（數字流水號）與原樣帶回的 identifier（帳號字串，呼叫端
 * 本來就知道），不含 realName/銀行卡號等 method-category-checklist.md 第 8 節定義的敏感欄位。
 *
 * 跨租戶查證（讀源碼，非推論）：真正查詢在 agrabah/src/servers/app_user_back_office/services/
 * user_data.ts:543-558 methodGetUserInfoByIdentifier，SQL 是
 * `SELECT ... FROM users WHERE platform_id = ? AND identifier = ?`，platformId 來自
 * context（登入平台），與呼叫端輸入無關，天生限定在目前平台範圍，無跨租戶查詢風險。查無資料
 * 時回 `AgrabahErrorCodeEnum.userNotExists`，不是拋例外或靜默回 0。
 *
 * --- dev 驗證（2026-08-25，pk-platform.alddev.com，帳號 landon001；透過獨立 spike script，
 *     用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport 直接 spawn 本 worktree
 *     的 src/stdio.ts 呼叫真正的 tool）---
 * 1. userIdentifier="landon001"（登入用的後台帳號，非 app 會員帳號）：回
 *    errorCode=204/errorName=userNotExists——證實這支查的是 app_user 的 `users` 表
 *    （會員帳號），跟後台管理員帳號是不同的使用者體系，不會混淆。
 * 2. 明顯不存在的亂數帳號：同樣回 errorCode=204/userNotExists，行為一致。
 * 3. 空字串：被 zod `.min(1)` 擋下，未送出 RPC。
 * **誠實記錄限制**：本輪未取得一個已知存在於 pk-platform 的真實 app 會員帳號，因此沒有驗證
 * 「查到」的成功路徑（只驗證了「查不到」與「格式擋下」兩種路徑）。若之後有真實會員帳號可用，
 * 建議補一次成功路徑驗證，確認 userId/identifier 回傳值正確對應。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetUserIdByIdentifierTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_activity_platform_get_user_id_by_identifier',
        {
            title: 'Get a member\'s internal userId by their account identifier',
            description:
                '用會員帳號（精準比對，非模糊搜尋，限目前這個平台底下的 app 會員帳號，不是後台' +
                '管理員登入帳號）查對應的內部 userId（rajah: ' +
                'ActivityPlatform.GetUserIdByIdentifier），供活動相關頁面以帳號搜尋會員使用。' +
                '查無此帳號時回業務錯誤（errorCode 對應 userNotExists），不是拋例外或靜默回 0；' +
                '這個錯誤碼也可能代表「帳號存在但缺對應的 user_details 列」這種極端資料狀態，' +
                '不完全等於「帳號真的不存在」。' +
                '⚠️ 同名陷阱：rajah 另有 admin.rajah 的 Admin.GetUserIdByIdentifier 與' +
                'platform.rajah 的 Platform.GetUserIdByIdentifier 兩支同名但不同 service 的' +
                'method（後者參數是複數 identifiers，可能是批次語意），本工具只對應這一支，' +
                '三者簽名/行為不保證相同。' +
                '⚠️ 本 RPC 在 rajah 沒有掛任何權限節點（無法確認是否為刻意設計），任何登入後台的' +
                '帳號皆可呼叫，且可能被用來探測某個字串是否是本平台的合法會員帳號（帳號枚舉），' +
                '呼叫端應避免把這支工具用於大量批次探測帳號是否存在。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                userIdentifier: z.string().min(1).describe('會員帳號，精準比對（非模糊搜尋）；後端不會 trim 或正規化大小寫，帶多餘空白或大小寫不符會查不到'),
            },
        },
        async ({ userIdentifier }) => {
            const r = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.GetUserIdByIdentifier(userIdentifier));
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, userId: r.data?.userId, identifier: r.data?.identifier });
        },
    );
}
