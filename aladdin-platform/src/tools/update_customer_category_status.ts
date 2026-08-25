/**
 * tools/update_customer_category_status.ts — aladdin_platform_customer_platform_update_category_status
 *
 * rajah: CustomerPlatform.UpdateCategoryStatus（customer_back_office.rajah:46，
 * @Permission "PlatCapCfg.CsManage.CsSet.AddrCfg.Ops.Toggle"）。
 *
 * 分類註記（method-category-checklist.md 第 6 節）：`newStatus` 是明確目標狀態（不是無參數
 * bit-flip），後端實作（agrabah/.../customer_platform.ts:199-224）是單純 `UPDATE ... SET status
 * = ? WHERE id = ? AND platform_id = ?`，沒有任何 `*StatusInvalid`/`already*` 類的合法性檢查，
 * 同值呼叫一樣成功（冪等）；id 不存在（含屬於別的 platform）時 affected rows=0 回
 * `objectNotFound`。因為沒有以 id 直接查單筆的 sibling method，round-trip 驗證比照
 * update_customer_category_sort_order.ts 的做法，掃描呼叫端指定的 category 找回這筆資料確認
 * 狀態真的改了（method-category-checklist.md 第 2 節 B 級「掃描到底」要求）。
 *
 * 2026-08-25 review 補：這是寫入型 tool，比照本 server 其他寫入 tool（見 update_game_vendor_status.ts）
 * 掛上 prod confirm 閘門——正式環境（ALADDIN_PLATFORM_IS_PROD=true）沒帶 confirm 直接拒絕執行。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { ICustomerCategoryCommon } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CUSTOMER_CATEGORY_MAP, ACTIVE_STATUS_MAP } from '../const.ts';

const SCAN_MAX_PAGES = 20;
const SCAN_PAGE_SIZE = 200;

/** 掃描整個 category 的 ListDetails 分頁，找到指定 id 的現值或掃到底放棄（比照 update_customer_category_sort_order.ts 的 findRowsByIds，這裡只找單一 id）。 */
async function findRowById(categoryValue: number, id: number): Promise<ICustomerCategoryCommon | undefined> {
    let page = 1;
    let totalPage = 1;

    while (page <= totalPage) {
        if (page > SCAN_MAX_PAGES) break;
        const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.ListDetails(categoryValue, page, SCAN_PAGE_SIZE));
        if (r.failed) throw new Error(`ListDetails 掃描第 ${ page } 頁失敗：errorCode=${ r.errorCode } ${ r.message }`);

        const hit = (r.data?.rows ?? []).find(row => row.id === id);
        if (hit) return hit;
        totalPage = r.data?.totalPage ?? 1;
        page += 1;
    }
    return undefined;
}

export function registerUpdateCustomerCategoryStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_customer_platform_update_category_status',
        {
            title: 'Enable or disable a customer service category entry',
            description:
                '啟用或停用本平台某個客服連線類型（category）底下的一筆連線項目' +
                '（rajah: CustomerPlatform.UpdateCategoryStatus，對應「客服連線類型」狀態開關）。' +
                '此操作是冪等的：對已經是目標狀態的項目重複呼叫一樣會成功，不會報錯。' +
                'id 不存在（或不屬於目前登入平台）時回傳 objectNotFound。' +
                'id 用 aladdin_platform_customer_platform_list_details 回傳的 id；' +
                'category 只用於本 tool 寫入後掃描回讀驗證，不是 RPC 本身的參數。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                category: z.enum([ 'komi', 'wbgcorp', 'dotcloud' ]).describe('這筆連線項目所屬的客服連線類型，供寫入後掃描驗證用'),
                id: z.number().int().describe('要變更狀態的連線項目 id'),
                newStatus: z.enum([ 'enabled', 'disabled' ]).describe('目標狀態'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ category, id, newStatus, confirm }) => {
            assertProdConfirmed(confirm);
            const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.UpdateCategoryStatus(id, ACTIVE_STATUS_MAP[ newStatus ]));
            if (r.failed) return asErrorResult(r);

            const categoryValue = CUSTOMER_CATEGORY_MAP[ category ];
            // 寫入 RPC 已成功；接下來只是回讀驗證，若這一步本身失敗必須明確告知「寫入已成功、只是
            // 驗證掃描失敗」，不能讓例外原樣拋出誤導呼叫端以為整個操作失敗（比照
            // update_customer_category_sort_order.ts 的教訓）。
            try {
                const row = await findRowById(categoryValue, id);
                if (!row) {
                    return asTextResult({
                        success: true,
                        verified: null,
                        warning: `狀態變更已成功送出，但在 category=${ category } 底下掃描不到 id=${ id }（可能屬於別的 category，或剛好被刪除），無法回讀確認最終狀態。請改用 aladdin_platform_customer_platform_list_details 換其他 category 確認。`,
                    });
                }
                return asTextResult({
                    success: true,
                    verified: row.status === ACTIVE_STATUS_MAP[ newStatus ],
                    id,
                    requestedStatus: newStatus,
                    actualStatus: row.status === ACTIVE_STATUS_MAP.enabled ? 'enabled' : row.status === ACTIVE_STATUS_MAP.disabled ? 'disabled' : row.status,
                });
            } catch (error) {
                return asTextResult({
                    success: true,
                    verified: null,
                    verifyError: error instanceof Error ? error.message : String(error),
                    warning: '狀態變更已成功送出，但事後驗證掃描失敗，無法確認最終狀態。請用 aladdin_platform_customer_platform_list_details 自行確認現值。',
                });
            }
        },
    );
}
