/**
 * tools/set_customer_config_restrict.ts — aladdin_platform_customer_platform_set_customer_config_restrict
 *
 * rajah: CustomerPlatform.SetCustomerConfigRestrict（customer_back_office.rajah:52，
 * @Permission "PlatCapCfg.CsManage.CsSet.GenSet"）。
 *
 * 分類註記（method-category-checklist.md 第 4/6 節）：這不是一般的欄位覆寫，後端實作
 * （agrabah/.../customer_platform.ts:272-319）是「同 platformId 下單選」語意——一次 UPDATE
 * 把本平台全部 customer_category_config 列的 restrict_status 依 CASE 設成「id 命中的那筆
 * enabled，其餘全部 disabled」。id=0（或任何 <=0 的值）會跳過存在性檢查、直接讓全部列變
 * disabled，等同「清除選擇，不指定受限制項目」——這是合法的業務用法，不是誤用。id>0 但不存在
 * （或不屬於本平台）時回 objectNotFound，不會誤把整批清空。
 *
 * 2026-08-25 review 曾質疑：後端 affected rows=0 時回 objectNotFound（:300-302），重複呼叫同一個
 * no-op（例如平台已全部 disabled 時再傳一次 0、或對已選中的 id 重複設定）狀態完全沒變，
 * affected rows 會不會被判為 0 而誤回 objectNotFound？2026-08-25 dev 實測直接驗證：對
 * pk-platform.alddev.com 連續兩次呼叫 id=0（baseline 已全 disabled）、以及對同一 id 連續呼叫
 * 兩次，全部回 errorCode=0 成功——mysql2 預設連線旗標含 FOUND_ROWS，affected rows 算的是
 * 「符合 WHERE 條件的列數」而非「值真的改變的列數」，只有平台底下完全沒有任何
 * customer_category_config 列時才會 affected rows=0 → objectNotFound。
 *
 * 2026-08-25 review 補：這是寫入型 tool，比照本 server 其他寫入 tool 掛上 prod confirm 閘門。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP } from '../const.ts';

export function registerSetCustomerConfigRestrictTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_customer_platform_set_customer_config_restrict',
        {
            title: 'Set which customer service category is the access-restricted one',
            description:
                '設定本平台「客服設置」→「通用設定」→「訪問受限制」目前選中的連線項目' +
                '（rajah: CustomerPlatform.SetCustomerConfigRestrict）。這是**單選**設定：' +
                '傳入的 id 會被設成 enabled，本平台其餘全部連線項目（不分 category）會被同一次寫入' +
                '設成 disabled，不是只覆寫這一筆。id 用 aladdin_platform_customer_platform_' +
                'get_customer_config_restrict 或 list_details 回傳的 id。' +
                '傳 0（或任何 <=0 的值）是合法用法，效果是「清除選擇」——本平台全部項目變成 disabled，' +
                '不會報錯。id>0 但不存在（或不屬於本平台）時回 objectNotFound，不會誤把其餘項目清空。' +
                '寫入後會自動呼叫 get_customer_config_restrict 讀回驗證；verified=false 代表寫入 RPC' +
                '已成功但讀回結果與預期不符（可能是讀取走 replica 有些微延遲，或有其他操作者併發修改），' +
                '不代表寫入失敗，可稍後重新查詢確認現值。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                id: z.number().int().describe('要設為受限制生效項目的連線項目 id；傳 0 表示清除選擇（全部設為 disabled）'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ id, confirm }) => {
            assertProdConfirmed(confirm);

            const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.SetCustomerConfigRestrict(id));
            if (r.failed) return asErrorResult(r);

            // 寫入 RPC 已成功；接下來只是回讀驗證，若這一步本身失敗必須明確告知「寫入已成功、只是
            // 驗證掃描失敗」，不能讓例外原樣拋出誤導呼叫端（比照 update_customer_category_sort_order.ts 的教訓）。
            try {
                const verify = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.GetCustomerConfigRestrict());
                if (verify.failed) throw new Error(`GetCustomerConfigRestrict 驗證失敗：errorCode=${ verify.errorCode } ${ verify.message }`);

                const rows = verify.data?.rows ?? [];
                const enabledRows = rows.filter(row => row.restrictStatus === ACTIVE_STATUS_MAP.enabled);
                const verified = id <= 0
                    ? enabledRows.length === 0
                    : enabledRows.length === 1 && enabledRows[ 0 ].id === id;

                return asTextResult({
                    success: true,
                    verified,
                    requestedId: id,
                    enabledRows: enabledRows.map(row => ({ id: row.id, name: row.name })),
                });
            } catch (error) {
                return asTextResult({
                    success: true,
                    verified: null,
                    verifyError: error instanceof Error ? error.message : String(error),
                    warning: '設定已成功送出，但事後驗證掃描失敗，無法確認最終結果。請用 aladdin_platform_customer_platform_get_customer_config_restrict 自行確認現值。',
                });
            }
        },
    );
}
