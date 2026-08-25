/**
 * tools/collect_all_vendor_balance.ts — aladdin_platform_game_vendor_platform_collect_all_vendor_balance
 *
 * rajah: GameVendorPlatform.CollectAllVendorBalance（game_back_office.rajah:1071）
 * 「一鍵歸集所有場館餘額」——把某個會員（app_user）在**他有帳號的每一個三方遊戲廠商**裡的
 * 餘額，全部提領（withdraw）回本平台指定類型的錢包。
 *
 * 2026-08-24 讀 rajah + agrabah 後端原始碼查證：
 * - `game_back_office.rajah:1048` 的 `# @Permission "GameVendor"` 是**註解**（`#` 開頭），
 *   不是真的 attribute；`CollectAllVendorBalance` 本身也沒有掛任何 `@Permission`。也就是說
 *   後端**完全不對這支 RPC 做權限檢查**，任何登入成功的 platform 操作者都能呼叫——這是後端
 *   既有行為，不是本工具引入的缺口，但呼叫前務必額外謹慎確認操作者身分與意圖。
 * - 對應 agrabah Service 真的有 override（`game_vendor_platform.ts:472` `methodCollectAllVendorBalance`），
 *   不是 Placeholder 或落回 base class 的 notImplemented。
 * - 底層邏輯（`game_transaction_manager.ts:305` `withdrawAll`）：
 *   1. 先用 `userId` 對這個會員上鎖（`Keys.getUserCollectionAllBalanceKey(userId)`，10 秒逾時，
 *      即 `COLLECTION_ALL_BALANCE_INTERVAL`）。**這把鎖刻意不提前釋放**（原始碼註解：
 *      "no need to release this lock, you cannot request this api again before it's timeout"），
 *      也就是同一個 userId 在 10 秒內重複呼叫，第二次一律回 `errorCode=23`（`exceedRequestLimit`，
 *      genie 共用碼，不在 `AgrabahErrorCodeEnum` 裡，查不到名稱屬正常）。**不要在收到這個
 *      錯誤後自動重試**——這是伺服器端刻意設的節流，不是暫時性錯誤。
 *   2. 查出這個會員「狀態為 enabled」的每一筆 `game_vendor_users` 關聯（＝他在哪些廠商開過帳號），
 *      對每個廠商並行呼叫內部 `withdraw()`，把該廠商餘額轉入 `toWalletType` 指定的平台錢包。
 *   3. 「查無帳號可提領」與「提領成功」在回傳上**完全無法區分**：兩者都是空陣列的
 *      `failedVendors`，本工具的回傳同樣無法告訴你這次呼叫實際歸集了多少廠商、多少金額，
 *      只能看得到「哪些廠商失敗了」。若某廠商查詢後「沒有餘額可提」，同樣被視為成功、不列入
 *      `failedVendors`（不是失敗，見 `game_transaction_manager.ts:337` 註解）。
 *   4. 這支 RPC 的回傳（`failedVendors`）只是「一鍵歸集」動作的**失敗清單**，不代表全部成功
 *      才會回 `errorCode=0`——RPC 外層不報錯，不等於每個廠商都成功，必須檢查 `failedVendors`
 *      是否為空。
 * - **不可逆的真實金流操作，且本工具/本 MCP server 沒有任何方式驗證或還原這次呼叫的實際效果**：
 *   沒有對應的「讀回」方法可以看到這次歸集前後的餘額變化（`GameInternal.GetAllVendorBalance`
 *   可以看到，但那是 `@NoPublic` 的 server-to-server RPC，platform 前端與本工具都呼叫不到）；
 *   也沒有反向的「退回廠商」方法。呼叫前務必先與操作者確認 userId 正確、且確實要對這個會員
 *   執行歸集——**這是真實移動使用者資金的動作，即使在 dev/測試環境也一樣會真的搬動測試資料
 *   裡的餘額，沒有 undo，不能因為環境是 dev 就放鬆確認**。不要對同一個或不同 userId 自動連續
 *   呼叫（例如批次替多個會員歸集），每一次呼叫都必須是操作者明確要求的單一動作。
 * - `userId` 是**會員（app_user）的 id**，不是操作者自己登入後的身分。本 MCP server（aladdin-platform）
 *   目前**沒有任何查詢工具**能列出或搜尋會員取得這個 id（`PlatformAppUser.ListAppUser` /
 *   `GetAppUser` 等會員管理 RPC 不在本 server 目前掛載的 tool 範圍內）——呼叫前必須由操作者
 *   提供正確的會員 id，不可自行猜測或用其他不相干的 id（例如平台 id、廠商 id）代入。
 * - `toWalletType`（rajah `WalletTypeEnum`，`common.rajah:1207-1214`）決定歸集後的餘額進哪個
 *   平台錢包：`normal`=一般錢包(1)、`agent`=代理錢包(2)、`commission`=佣金錢包(3)。
 *
 * 2026-08-24 dev 驗證：**未能成功執行**，見 dev_verification_evidence——本次 session 對
 * `pk-platform.alddev.com` 的所有請求（含最基本的 `curl /`）一律收到 nginx 層 403 Forbidden，
 * DNS 可正常解析、對外網際網路連線正常（curl google.com 200），判斷是該站台的 IP
 * 白名單/WAF 擋下了本 session 的出口 IP，不是程式邏輯或憑證本身的問題，但確實**沒有實際打通
 * 這支 RPC 拿到真實回應**。以上行為描述完全依據讀原始碼（rajah 定義 + agrabah service 實作 +
 * GameTransactionManager.withdrawAll 邏輯）得出，尚未經 dev 實測驗證，呼叫前請自行留意此風險。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

// WalletTypeEnum（common.rajah:1207-1214）。目前只有這支 tool 用到，先留在檔案內；
// 若之後有第二支 tool 需要同一份對照表，再依 README 慣例搬進 const.ts。
const WALLET_TYPE_KEYS = [ 'normal', 'agent', 'commission' ] as const;
const WALLET_TYPE_MAP: Record<typeof WALLET_TYPE_KEYS[ number ], number> = { normal: 1, agent: 2, commission: 3 };

// genie 共用 ErrorCode（非 AgrabahErrorCodeEnum），見 genie/src/common/error_code.ts:25。
const EXCEED_REQUEST_LIMIT_CODE = 23;

export function registerCollectAllVendorBalanceTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_collect_all_vendor_balance',
        {
            title: 'One-click collect a member\'s balance from every game vendor',
            description:
                '對指定會員（userId）執行「一鍵歸集所有場館餘額」（rajah: GameVendorPlatform.CollectAllVendorBalance）：' +
                '把這個會員在他有帳號的每一個三方遊戲廠商裡的餘額，全部提領回本平台指定類型（toWalletType）的錢包。' +
                '**這是真實、不可逆的資金搬動操作，即使在非 prod 環境也一樣會真的移動測試資料裡的餘額，沒有任何方式可以 ' +
                'undo/還原**——呼叫前必須先用 AskUserQuestion（或功能相同的方式）向操作者明確確認 userId 正確、且確實 ' +
                '要對這個會員執行歸集，取得明確同意後才能呼叫；不能自行假設同意，也不能自動對同一個或不同 userId 連續呼叫 ' +
                '（例如想幫多個會員批次歸集）——每次呼叫都必須是操作者針對單一會員明確要求的動作。' +
                'userId 是**會員（app_user）的 id**，不是操作者自己的身分；本 MCP server 目前沒有任何查詢工具可以列出或 ' +
                '搜尋會員取得這個 id，必須由操作者直接提供正確的會員 id，不可自行猜測或誤用其他 id（如平台 id、廠商 id）代入。' +
                '重要限制（無法從這支 RPC 的回傳看到歸集是否真的有效）：回傳的 failedVendors 只是「哪些廠商提領失敗」的清單，' +
                '不是完整結果報告——「這個會員本來就沒有任何廠商帳號」跟「所有廠商都提領成功」在回傳上完全無法區分（兩者 ' +
                'failedVendors 都是空陣列）；某廠商「查詢後沒有餘額可提」同樣視為成功、不會出現在 failedVendors 裡。本工具與 ' +
                '本 MCP server 都沒有辦法讀回這次呼叫前後的實際餘額變化來驗證效果（能看到即時餘額的 GameInternal.GetAllVendorBalance ' +
                '是 @NoPublic 的內部 RPC，platform 前端呼叫不到）。' +
                '節流限制：後端對同一個 userId 設有 10 秒鎖（同一 userId 在 10 秒內第二次呼叫會回 errorCode=23，即 ' +
                'exceedRequestLimit），這是伺服器刻意設計的節流、不是暫時性錯誤，收到這個錯誤不要自動重試，應等待或告知操作者。' +
                '後端目前對這支 RPC **沒有掛任何 @Permission 權限檢查**（任何登入成功的 platform 操作者皆可呼叫），這是既有 ' +
                '後端行為、不是本工具造成，呼叫前應額外謹慎確認操作意圖。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion（或功能相同的方式）' +
                '明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；絕不能自行假設使用者同意。' +
                '非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                userId: z.number().int().positive().describe(
                    '目標會員（app_user）的 id，不是操作者自己的身分。本 MCP server 沒有查詢工具可以取得這個值，' +
                    '必須由操作者直接提供正確的會員 id，不可自行猜測或代入其他種類的 id。',
                ),
                toWalletType: z.enum(WALLET_TYPE_KEYS).describe(
                    '歸集後餘額要轉入的平台錢包類型（rajah WalletTypeEnum）：normal=一般錢包、agent=代理錢包、commission=佣金錢包。',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ userId, toWalletType, confirm }) => {
            assertProdConfirmed(confirm);

            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.CollectAllVendorBalance(userId, WALLET_TYPE_MAP[ toWalletType ]));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: r.errorCode === EXCEED_REQUEST_LIMIT_CODE
                        ? '這個 userId 在 10 秒內已經呼叫過一次一鍵歸集，後端刻意節流拒絕本次呼叫，不要自動重試，請稍候或告知操作者。'
                        : undefined,
                });
            }

            const failedVendors = (r.data?.failedVendors ?? []).map((f) => ({
                gameVendorId: f.gameVendorId,
                gameVendorName: f.gameVendorName,
                errorCode: f.errorCode,
                errorName: AgrabahErrorCodeEnum[ f.errorCode ?? -1 ] ?? '(未知錯誤碼)',
                errorMessage: f.errorMessage,
            }));

            return asTextResult({
                success: true,
                userId,
                toWalletType,
                failedVendors,
                message: failedVendors.length > 0
                    ? `呼叫成功，但有 ${ failedVendors.length } 個廠商提領失敗，見 failedVendors。其餘未列出的廠商（若有）視為提領成功或本來就沒有餘額可提，兩者無法從這支 RPC 區分。`
                    : '呼叫成功，failedVendors 為空——但這無法區分「全部廠商都提領成功／沒有餘額可提」與「這個會員根本沒有任何廠商帳號」，本 RPC 的回傳不提供這項資訊，如需確認實際效果請透過其他管道核對會員錢包餘額。',
            });
        },
    );
}
