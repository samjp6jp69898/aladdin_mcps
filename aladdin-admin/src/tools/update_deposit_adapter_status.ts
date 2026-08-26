/**
 * tools/update_deposit_adapter_status.ts — aladdin_admin_deposit_admin_enable_adapter
 *
 * rajah: DepositAdmin.EnableAdapter(id i32 1, status StatusEnum 2) ()
 * （payment_back_office.rajah:2922，@Permission "PaymentDepositAdmin.Adapter.Status.Toggle"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodEnableAdapter（真的有 override），底層直接委派共用 helper
 * `updateStatusWithAudit(context, id, 0, status, 'deposit_adapters', ...)`（platformId 帶 0，
 * 即不加 platform_id 篩選——這是母表層級的狀態，不分平台）。單純 UPDATE，無任何跨表連鎖副作用
 * （不同於 game_vendor 的 UpdateGameVendorStatus，那支非 enabled 時會連鎖影響
 * platform_game_vendors，這支沒有這種行為）。
 *
 * 分類（method-category-checklist.md 第 6 節「狀態轉換」）：帶明確目標 status 參數，不是
 * bit-flip，不需要「先查現況再反轉」。
 *
 * - id 不存在（UPDATE 影響 0 列）：後端 `updateStatus` 回 errorCode=14（objectNotFound）。
 * - status 帶 StatusEnum 沒有的數值：回 errorCode=9（invalidData）。
 * - `DepositAdapterEdit`（GetAdapterForEdit 的回傳型別）沒有 status 欄位，無法用它 round-trip；
 *   改用 `ListAdapters` 讀回全部分頁比對 id（見 list_deposit_adapters.ts 已知陷阱：無 ORDER BY，
 *   但這裡只是找目前 status 值，不受排序影響）。
 * - **已知 bug（獨立 review 抓到，非推測，已修正）**：`getPageData`（common/database_helper.ts）
 *   的 `totalPage` 只在 page===1 時真的算出來，page>1 的回應一律回 `totalPage:0`——原本的掃描
 *   終止判斷 `page >= (totalPage ?? 1)` 用這個值，在 page 2 就會被 `2 >= 0` 誤判成「已到底」而
 *   提前中止，實際上根本沒掃到 20 頁上限。已改用 method-category-checklist.md 第 2 節建議的
 *   「回傳沒有可靠 total 時,用 rows.length < pageSize 視為最後一頁」判斷，不再依賴 totalPage。
 *
 * dev 驗證：對真實存在的測試 adapter 切換 enabled→disabled→enabled，round-trip 確認每次都生效；
 * 對不存在的 id 呼叫，確認回傳 errorCode=14。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

export function registerUpdateDepositAdapterStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_enable_adapter',
        {
            title: 'Enable or disable a deposit adapter',
            description:
                '把某個充值（Deposit）adapter 實例的狀態改成指定值（rajah: DepositAdmin.EnableAdapter，' +
                'payment_back_office.rajah:2922）。id 來自 aladdin_admin_deposit_admin_list_adapters 或 ' +
                'aladdin_admin_deposit_admin_create_adapter 的回傳值。status 合法值（rajah StatusEnum）：' +
                'unknown/enabled/disabled/frozen/deleted，一般啟用/停用只會用到 enabled/disabled。' +
                '單純 UPDATE，不像 game_vendor 母表狀態那樣有跨表連鎖副作用。' +
                'id 不存在時回 errorCode=14（objectNotFound）；status 帶非法列舉值回 errorCode=9（invalidData）。' +
                'GetAdapterForEdit 回傳的 DepositAdapterEdit 沒有 status 欄位，本工具改用 ListAdapters 分頁讀回' +
                '（掃描上限 20 頁，若找不到會如實回報，不代表寫入失敗）驗證目前狀態。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('adapter 的內部 id'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般啟用/停用用 enabled/disabled'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, status, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.EnableAdapter(id, STATUS_MAP[ status ]));
            if (r.failed) return asErrorResult(r);

            const PAGE_SIZE = 200;
            let matched: unknown = undefined;
            for (let page = 1; page <= 20 && matched === undefined; page++) {
                const listResult = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.ListAdapters(page, PAGE_SIZE));
                if (listResult.failed) break;
                const rows = listResult.data?.rows ?? [];
                matched = rows.find((row) => row.id === id);
                if (rows.length < PAGE_SIZE) break; // totalPage 只在 page===1 有效，不可靠，改用「回傳筆數 < pageSize」判斷是否到底
            }

            return asTextResult({
                success: true,
                message: '更新成功',
                readBack: matched ?? { note: '在 ListAdapters 掃描範圍內沒找到這個 id，非預期，請人工確認' },
            });
        },
    );
}
