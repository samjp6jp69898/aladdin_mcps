/**
 * tools/list_user_wagerings.ts — aladdin_platform_wagering_platform_list_user_wagerings
 *
 * rajah: WageringPlatform.ListUserWagerings（wagering_back_office.rajah:396，
 * 需要 @Permission "Finance.Wagering.List"）
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：A 級——search 內的
 * identifier（會員帳號）與 userId 都能鎖定單一目標，非「只有範圍鍵 + 分頁」的 B 級。
 * zod schema 已對照 rajah model ListUserWageringsSearch（同檔 69-96 行）全部欄位列出。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListUserWageringsSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { WAGERING_STATUS_SEARCH_KEYS, WAGERING_STATUS_SEARCH_MAP, WAGERING_ADD_WAY_MAP, deepFixLongs } from '../const.ts';

export function registerListUserWageringsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_list_user_wagerings',
        {
            title: 'List user wagering (audit) records',
            description:
                '分頁查詢本平台會員的稽核（打碼量）紀錄，對應後台「財務」→「稽核」列表頁' +
                '（rajah: WageringPlatform.ListUserWagerings，需要權限節點 Finance.Wagering.List）。' +
                '2026-08-28 讀 agrabah 原始碼查證（agrabah/src/servers/wagering_back_office/services/' +
                'wagering_platform.ts:139-308）並實打 dev 驗證，以下五點是簽名看不出來、但會直接影響結果的行為：' +
                '**(1) identifier 或 userId 至少要帶一個**——兩者都沒帶時後端在 #listUserWageringsTidyUserMap ' +
                '（同檔 143-145 行）直接回傳空 user map，接著 211-213 行判定 size===0 就 return success 而' +
                '完全不查資料表，結果是「成功但空清單」，不是錯誤、也不是「列出全平台」。' +
                '**(2) status 不支援 completed**——後端 224 行無條件 filter 掉 completed，帶了等於沒帶、' +
                '退化成「非 completed 的全部」，所以本工具的可選值只開放 pending/autoRemove/manualRemove；' +
                '要看已完成的稽核請改用其他報表，別靠這個篩選條件。' +
                '**(3) totalPage 只有 page=1 才算**——agrabah 通用分頁 helper getPageData ' +
                '（agrabah/src/common/database_helper.ts:208-217）只在 page===1 時執行 count，' +
                'page>=2 一律回 totalPage=0；要知道總頁數請看第一頁的回傳值，不要拿第二頁之後的 0 當「沒有資料」。' +
                '**(4) 金額欄位是 stored 整數，不是人類可讀金額**——wageringAmount / turnoverAmount / ' +
                'unWageringAmount 依該筆 currencyCode 的精度縮放（常見 ×10000），本工具不換算；' +
                'wageringMultiplier 則是「實際倍數 ×10000」（10000 = 1 倍）。' +
                '**(5) userWageringInfo 不是本次查詢的彙總，而且常常是 null**——後端只在' +
                '「這次搜尋條件剛好命中恰好一位會員」時才填這個欄位（同檔 295 行 `if (userMap.size === 1)`），' +
                '模糊 identifier 命中多人時一律是 null；有值時它算的是 wageringManager.getUnWageringInfo ' +
                '（agrabah/src/managers/wagering_manager.ts:270-278），SQL 寫死 `status = pending` 且' +
                '**完全不吃 status / wageringType / addWay / 四個時間區間任何一個篩選條件**，' +
                '也只統計該會員自己 currencyCode 的部分。所以它是「這位會員終身未稽核總額」，' +
                '不是「你這次篩出來那些列的小計」——用時間區間篩完再讀這個值會得到誤導性的數字。' +
                '另注意：identifier 帶了但查無此會員時，回傳與「這位會員真的沒有稽核紀錄」完全一樣' +
                '（success=true、rows=[]、totalPage=0、userWageringInfo=null），本工具無法替你區分這兩種情況，' +
                '要確認會員是否存在，請改用 aladdin_platform_wagering_platform_get_user_un_wagering_detail' +
                '（吃 userId，查無會員時回 errorCode 204 userNotExists，不是靜默回空）。' +
                '本工具純讀取；手動加/變更/解除單一會員稽核的寫入類 method（ManualAddUserWagering / ' +
                'BatchManualChangeUserWagering / BatchManualRemoveUserWagering）會直接改動個別會員的提款門檻，' +
                '本 MCP 未提供對應 tool。',
            inputSchema: {
                identifier: z.array(z.string()).optional().describe(
                    '會員帳號（可多筆）。與 userId 至少擇一必帶，兩者都空會回傳空清單。' +
                    '比對方式由 accurate 決定',
                ),
                userId: z.array(z.number().int()).optional().describe(
                    '會員 id（可多筆）。與 identifier 至少擇一必帶。' +
                    '同時帶 identifier 與 userId 時後端只取兩者交集（同檔 155-162 行）',
                ),
                accurate: z.boolean().optional().describe(
                    'identifier 的比對模式：true=精準比對，false/不帶=模糊比對（LIKE）。只影響 identifier，不影響 userId',
                ),
                status: z.array(z.enum(WAGERING_STATUS_SEARCH_KEYS)).optional().describe(
                    '稽核狀態篩選（可多選）：pending=未稽核／autoRemove=自動解除／manualRemove=手動解除。' +
                    '不帶代表「除了 completed 以外全部」。**不支援 completed**，理由見工具說明第 (2) 點',
                ),
                wageringType: z.array(z.number().int()).optional().describe(
                    '稽核類型篩選（WageringTypeEnum 數值，common.rajah:1650-1767，如 0=手動添加／1=充值／' +
                    '46=人工充值）。值域過大（60+ 個）故直接收數字，不轉字串 key',
                ),
                addWay: z.enum([ 'auto', 'manual' ]).optional().describe('添加方式：auto=自動／manual=手動'),
                startCreatedAtTimestamp: z.number().int().optional().describe('建立時間區間起（毫秒 epoch）'),
                endCreatedAtTimestamp: z.number().int().optional().describe('建立時間區間迄（毫秒 epoch）'),
                startUpdatedAtTimestamp: z.number().int().optional().describe('更新時間區間起（毫秒 epoch）'),
                endUpdatedAtTimestamp: z.number().int().optional().describe('更新時間區間迄（毫秒 epoch）'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).default(50).describe('每頁筆數'),
            },
        },
        async ({
            identifier, userId, accurate, status, wageringType, addWay,
            startCreatedAtTimestamp, endCreatedAtTimestamp, startUpdatedAtTimestamp, endUpdatedAtTimestamp,
            page, pageSize,
        }) => {
            if ((identifier ?? []).length === 0 && (userId ?? []).length === 0) {
                return asTextResult({
                    success: false,
                    message: 'identifier 與 userId 至少要帶一個。後端在兩者皆空時不會查詢資料表，' +
                        '會回傳「成功但空清單」，容易被誤讀成「這個平台沒有稽核紀錄」，因此本工具在送出前先擋下。',
                });
            }

            const search = ListUserWageringsSearch.create({
                identifier: identifier ?? [],
                userId: userId ?? [],
                accurate: accurate ?? false,
                status: (status ?? []).map((k) => WAGERING_STATUS_SEARCH_MAP[ k ]),
                wageringType: wageringType ?? [],
                addWay: addWay ? WAGERING_ADD_WAY_MAP[ addWay ] : 0,
                startCreatedAtTimestamp: startCreatedAtTimestamp ?? 0,
                endCreatedAtTimestamp: endCreatedAtTimestamp ?? 0,
                startUpdatedAtTimestamp: startUpdatedAtTimestamp ?? 0,
                endUpdatedAtTimestamp: endUpdatedAtTimestamp ?? 0,
            });

            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringPlatform.ListUserWagerings(search, page, pageSize));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                userWageringInfo: deepFixLongs(r.data?.userWageringInfo ?? null),
                totalPage: r.data?.totalPage ?? 0,
                notes: {
                    totalPage: page === 1
                        ? '第一頁才會回真實總頁數'
                        : 'page>=2 時後端固定回 0，不代表沒有資料；總頁數請看第一頁',
                    amounts: 'wageringAmount/turnoverAmount/unWageringAmount 為 stored 整數，' +
                        '依該筆 currencyCode 精度縮放（常見 ×10000），本工具不換算',
                    wageringMultiplier: '實際倍數 × 10000（10000 = 1 倍；rajah const TurnoverMultiplierDefault，wagering.rajah:22）',
                    userWageringInfo: '只在本次搜尋恰好命中一位會員時才有值，命中多人為 null；'
                        + '有值時是「該會員終身 status=pending 的未稽核總額」，不受本次任何篩選條件影響',
                    emptyResult: 'rows 為空時，無法區分「查無此會員」與「此會員沒有符合條件的稽核紀錄」——'
                        + '兩者回傳形狀完全相同',
                },
            });
        },
    );
}
