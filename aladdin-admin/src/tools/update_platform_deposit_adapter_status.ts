/**
 * tools/update_platform_deposit_adapter_status.ts —
 * aladdin_admin_deposit_admin_update_platform_deposit_adapter_status
 *
 * rajah: DepositAdmin.UpdatePlatformDepositAdapterStatus(platformId i32 1, adapterId i32 2, status StatusEnum 3) ()
 * （payment_back_office.rajah:2928，@Permission "PaymentDepositAdmin.Adapter.Platform.Status.Toggle"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodUpdatePlatformDepositAdapterStatus（真的有 override）。讀原始碼確認（先 UPDATE
 * platform_deposit_adapters，`updateResult.data === 0` 時才 INSERT 一筆新的）：
 * - `adapterId` 有驗證存在性（`count(deposit_adapters, 'id = ?', [adapterId])`，不存在時回
 *   errorCode=9 invalidData，不會寫入）。
 * - `status` 只接受 enabled/disabled，其餘 StatusEnum 值一律回 errorCode=9（invalidData）——
 *   本工具的 zod schema 只開放這兩個值，不比照其他狀態轉換 tool 開放 unknown/frozen/deleted。
 * - **重要限制（讀 SQL 結構 + migrations/payment/202507021843_create_platform_depoist_adapters.sql
 *   確認，比照 aladdin_admin_game_vendor_admin_update_platform_game_vendor_status 的既有同類陷阱）**：
 *   `platformId` 完全沒有驗證是否真實存在——`platform_deposit_adapters.platform_id` 是
 *   `SMALLINT UNSIGNED NOT NULL`、沒有外鍵約束，只有 `UNIQUE(platform_id, deposit_adapter_id)`。
 *   帶一個不存在、但落在 SMALLINT UNSIGNED 合法範圍（0–65535）內的 platformId，會**靜默成功**、
 *   真的寫入一筆綁定不存在平台的孤兒列；超出範圍則回 errorCode=12（unknownDatabaseError，數值
 *   溢位的副作用，不是「platformId 不存在」的正式偵測機制）。platformId 一律只能用
 *   aladdin_admin_list_platforms 回傳的真實 id。
 * - 這支 RPC 沒有回傳值，也沒有單筆查詢方法，寫入成功後本工具改用
 *   aladdin_admin_deposit_admin_list_platform_deposit_adapters 讀回驗證（該工具本身也有
 *   platformId 不驗證存在性的同類陷阱，讀回時仍需以 aladdin_admin_list_platforms 的真實 id 為準）。
 *
 * dev 驗證：對真實 platformId + 真實 adapterId 呼叫 enabled，round-trip 確認 status 生效；
 * 對不存在的 adapterId 呼叫，確認回傳 errorCode=9。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerUpdatePlatformDepositAdapterStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_update_platform_deposit_adapter_status',
        {
            title: 'Enable or disable a deposit adapter for a specific platform',
            description:
                '把某個充值（Deposit）adapter 在某個平台底下的啟停狀態改成指定值（rajah: ' +
                'DepositAdmin.UpdatePlatformDepositAdapterStatus，payment_back_office.rajah:2928）。' +
                'adapterId 來自 aladdin_admin_deposit_admin_list_adapters；platformId 來自 ' +
                'aladdin_admin_list_platforms。status 只接受 enabled/disabled，其餘值後端一律拒絕。' +
                'adapterId 不存在時回 errorCode=9（invalidData），不會寫入。' +
                '**重要限制（讀後端 SQL + migration 確認）**：platformId 完全沒有驗證是否真實存在——' +
                '底層先 UPDATE、沒有列被改到才 INSERT 一筆新的，platform_id 欄位沒有外鍵約束。帶一個不存在但' +
                '落在 0–65535 範圍內的 platformId 會**靜默成功**、寫入一筆綁定不存在平台的孤兒列；超出範圍則' +
                '回通用的 errorCode=12（unknownDatabaseError，不是專門偵測 platformId 不存在的機制）。' +
                'platformId 一律只能用 aladdin_admin_list_platforms 回傳的真實 id，不要用「呼叫看看有沒有報錯」' +
                '驗證 platformId 是否存在。' +
                '這支 RPC 沒有回傳值，寫入成功後本工具改用 aladdin_admin_deposit_admin_list_platform_deposit_adapters ' +
                '讀回驗證，若目標 adapter 不在第一頁會如實回報、不代表寫入失敗。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，來自 aladdin_admin_list_platforms 的回傳結果'),
                adapterId: z.number().int().describe('adapter 的內部 id，來自 aladdin_admin_deposit_admin_list_adapters'),
                status: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態，只接受這兩個值'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ platformId, adapterId, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.UpdatePlatformDepositAdapterStatus(platformId, adapterId, ACTIVE_STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            const listResult = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.ListPlatformDepositAdapters(1, 50, platformId));
            const matched = !listResult.failed
                ? listResult.data?.rows?.find((row) => row.id === adapterId)
                : undefined;

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? (!listResult.failed ? { note: '第一頁沒找到，可能分頁較後面，非失敗', rows: listResult.data?.rows } : null),
            });
        },
    );
}
