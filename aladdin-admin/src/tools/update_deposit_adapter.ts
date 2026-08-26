/**
 * tools/update_deposit_adapter.ts — aladdin_admin_deposit_admin_update_adapter
 *
 * rajah: DepositAdmin.UpdateAdapter(adapter DepositAdapterEdit 1) ()
 * （payment_back_office.rajah:2919，@Permission "PaymentDepositAdmin.Adapter.Ops.Edit"）
 *
 * agrabah 對應實作：src/servers/payment_back_office/services/deposit_admin.ts 的
 * methodUpdateAdapter（真的有 override）。讀原始碼確認：
 * - 整包送入（無 @Optional 標記），比照 method-category-checklist.md 第 4 節「先讀現值、
 *   只覆寫要改欄位」規則——本工具內部先呼叫 GetAdapterForEdit(id) 讀現值，只覆蓋呼叫端
 *   明確要改的欄位，其餘原樣帶回，完成後 round-trip 再讀一次比對。
 * - `adapterKey`/`specialRequestCurrency`/`requestCurrencyCode` 三個欄位被後端
 *   `excludeFieldsFromUpdate` 排除，即使呼叫端帶入不同值也會被後端還原成資料庫原值、
 *   不會真的被改到——本工具不接受這三個欄位作為輸入參數，避免呼叫端誤以為改得動。
 * - **id 不存在時的行為（2026-08-26 dev 站台實測，非推測，含 review 修正）**：底層原始
 *   `UpdateAdapter` RPC 若直接對不存在的 id 呼叫，`updateObject` 會回傳 `idNotExists`
 *   （errorCode=11）。但**本工具實際的呼叫路徑不會走到這支底層行為**——本工具送出更新前
 *   一律先呼叫 `GetAdapterForEdit(id)` 讀現值，id 不存在時這一步就會先失敗並短路回傳
 *   （見 get_deposit_adapter_for_edit.ts 記錄的 errorCode=606 paymentAdapterInstanceNotExist），
 *   永遠不會真的送到 `UpdateAdapter` RPC。也就是說呼叫端透過本工具實際會看到的是
 *   errorCode=606（帶 `hint: 讀取現值失敗，可能 id 不存在`），不是 errorCode=11——11 只是
 *   底層 RPC 單獨被呼叫時的行為，記錄在此供對照，不是本工具的實際回傳。
 * - **已知資料陷阱（2026-08-26 dev 實測踩到，非推測）**：`name` 欄位 DB schema 是
 *   `VARCHAR(30)`（migrations/payment/202411281816_create_deposit_tables.sql），但 rajah
 *   `@Rules` 只標 `Required`、沒有 `MaxLength`，前端/RPC 層都不會攔截超長字串；實測帶入 34
 *   字元的 name 時，後端回傳的不是明確的「欄位過長」業務錯誤，而是通用的
 *   errorCode=12（unknownDatabaseError）——呼叫端看到這個錯誤碼時，其中一個可能原因就是
 *   name 超過 30 字元，不能只解讀成「未知資料庫錯誤」就放棄排查。
 *
 * dev 驗證：對既有 id 更新 baseUrl，round-trip 讀回確認新值生效、未提及欄位維持原值。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { DepositAdapterEdit } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAYMENT_ADAPTER_FIELD_MAP } from '../const.ts';

export function registerUpdateDepositAdapterTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_deposit_admin_update_adapter',
        {
            title: 'Update a deposit adapter instance',
            description:
                '更新一筆既有的充值（Deposit）adapter 實例（rajah: DepositAdmin.UpdateAdapter，' +
                'payment_back_office.rajah:2919）。id 來自 aladdin_admin_deposit_admin_list_adapters 或 ' +
                'aladdin_admin_deposit_admin_create_adapter 的回傳值。本工具會先讀現值（GetAdapterForEdit），' +
                '只覆蓋呼叫端明確帶入的欄位，其餘欄位維持原值後整包送出，完成後 round-trip 讀回驗證。' +
                '**adapterKey / specialRequestCurrency / requestCurrencyCode 這三個欄位建立後無法再改**' +
                '（後端 excludeFieldsFromUpdate 會把它們還原成資料庫原值），本工具不接受這三個參數。' +
                '**已知行為（2026-08-26 dev 實測）**：id 不存在時本工具會回傳 success:false、errorCode=606' +
                '（paymentAdapterInstanceNotExist）——因為本工具送出更新前一律先讀現值，id 不存在時在這一步就' +
                '短路失敗，不會真的送到底層 UpdateAdapter RPC（底層 RPC 若被直接呼叫，id 不存在時回的是不同的' +
                'errorCode=11 idNotExists，但呼叫本工具不會遇到這個碼）。' +
                '**已知資料陷阱**：name 欄位 DB 限制 30 字元但 rajah 沒有 MaxLength 驗證，超長時後端回傳的是' +
                '通用 errorCode=12（unknownDatabaseError），不是明確的「欄位過長」錯誤，帶入前建議自行檢查長度。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('adapter 的內部 id'),
                name: z.string().min(1).max(30).optional().describe(
                    '不帶則沿用既有值。DB 欄位限制 30 字元（rajah 未標示此限制，超長會回通用 errorCode=12）。',
                ),
                baseUrl: z.string().optional().describe('不帶則沿用既有值'),
                callbackBaseUrl: z.string().optional().describe('不帶則沿用既有值'),
                parameterList: z.array(z.enum([ 'hashKey', 'publicKey', 'privateKey' ])).optional().describe(
                    '這個 adapter 實例需要哪些憑證欄位（僅宣告欄位名稱，不是實際密鑰值）。不帶則沿用既有值。',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, name, baseUrl, callbackBaseUrl, parameterList, confirm }) => {
            assertProdConfirmed(confirm);

            const currentResult = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.GetAdapterForEdit(id));
            if (currentResult.failed) return asErrorResult(currentResult, { hint: '讀取現值失敗，可能 id 不存在' });
            const current = currentResult.data?.adapter;

            const adapter = DepositAdapterEdit.create({
                id,
                name: name ?? current?.name,
                adapterKey: current?.adapterKey,
                baseUrl: baseUrl ?? current?.baseUrl ?? '',
                callbackBaseUrl: callbackBaseUrl ?? current?.callbackBaseUrl ?? '',
                parameterList: parameterList
                    ? parameterList.map(f => PAYMENT_ADAPTER_FIELD_MAP[ f ])
                    : current?.parameterList,
                specialRequestCurrency: current?.specialRequestCurrency,
                requestCurrencyCode: current?.requestCurrencyCode,
            });
            const r = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.UpdateAdapter(adapter));
            if (r.failed) return asErrorResult(r);

            const readBackResult = await withAutoRelogin(() => remote.paymentBackOffice.depositAdmin.GetAdapterForEdit(id));
            return asTextResult({
                success: true,
                message: '更新請求已送出',
                readBack: readBackResult.failed ? null : readBackResult.data?.adapter,
            });
        },
    );
}
