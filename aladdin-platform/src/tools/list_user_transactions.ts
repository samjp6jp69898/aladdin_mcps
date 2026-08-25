/**
 * tools/list_user_transactions.ts — aladdin_platform_wallet_platform_list_user_transactions
 *
 * rajah: WalletPlatform.ListUserTransactions(search ListUserTransactionsSearch 1, page i32 2,
 * pageSize i32 3) (rows [UserTransaction] 1, sumData UserTransactionSum 2, totalPage i32 3)
 * （wallet_back_office.rajah:372，service 定義於 wallet_back_office.rajah:364，非 @NoPublic，
 * @Permission "Finance.TransRecord"）
 *
 * method-category-checklist.md 第 2 節「讀取清單」分類：**A 級（相對安全）**——search struct
 * 有可鎖定單一目標的欄位（identifiers/userIds/orderId 前綴），非 B 級「只有範圍鍵+分頁」的
 * 高風險情境，zod schema 已對照 rajah ListUserTransactionsSearch 全部欄位列出。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/wallet_back_office/services/
 * wallet_platform.ts:107-230，methodListUserTransactions + #validateSearchCondition）：
 * - **搜尋區間限制**：startCreatedAtTimestamp/endCreatedAtTimestamp 未帶時，預設查「本平台
 *   時區下可查詢的最早自然日 00:00:00 ~ 今日 23:59:59.999」；只帶 start 不帶 end，end 自動
 *   補為 start+93天；只帶 end 不帶 start，start 自動補為 max(end-93天, now-93天)。驗證失敗
 *   情境：start>end 回 invalidData；區間跨度 > 93 天回 walletExceedMaxSearchDayRange；
 *   start 早於「現在-93天」回 walletExceedMaxSearchHistoryDay。**不支援查 93 天以前的資料**。
 * - **stored 值陷阱**：`amount`/`beforeBalance`/`afterBalance`（rajah 定義純 i64，
 *   **沒有 `@Type "Currency"` 標註**）與 search 的 `minAmount`/`maxAmount`（rajah 有標
 *   `@Type "Currency"`，但這裡直接透傳給底層 GetTransactions 的同型別欄位，未經任何正規化）
 *   皆為後端 stored 整數（依 currencyCode 的 currency.decimalPlaces 縮放，常見 ×10000，
 *   見 obsidian/Rules/Stored Value 與數值轉換體系.md），**本工具不做 stored→normal 換算**
 *   （單次查詢可能跨多種幣別，沒有單一 decimalPlaces 可套用），呼叫端需自行依每筆
 *   currencyCode 換算成人類可讀金額。
 * - **i64 Long 物件陷阱（2026-08-25 dev 實測發現）**：`amount`/`beforeBalance`/
 *   `afterBalance`/`createdAtTimestamp`/`registerTimestamp` 這幾個 i64 欄位經 protobufjs
 *   decode 後在 JS 端是 `{low,high,unsigned}` 的 Long 物件，不是原生 number（直接
 *   `JSON.stringify` 會印出這個內部形狀，不是可讀數字），跟 const.ts `toPlainNumber()`
 *   檔頭註解描述的大舞台設置那組欄位是同一類陷阱。本工具已用 `toPlainNumber()` 轉成一般
 *   number 再回傳（實測數值都在安全整數範圍內）。
 * - walletTypes 固定帶 `[normal]`（一般錢包），呼叫端無法查其他 walletType。
 * - 回傳額外用 LRU cache 批量補齊 app user/上級代理/操作者/歸類名稱等資訊，僅供顯示，
 *   本工具除上述 i64 欄位轉換與 enum key 轉換外，原樣透傳後端回傳的 rows 形狀。
 *
 * **2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，
 * 涵蓋：無任何篩選條件 pageSize=5 → 拿到真實資料、amount/beforeBalance/afterBalance/
 * createdAtTimestamp/registerTimestamp 皆正確轉成一般 number；帶超過 93 天的區間 →
 * errorCode=407 errorName=walletExceedMaxSearchDayRange；明顯不存在的 orderId 前綴 →
 * 空結果集 rows=[] totalPage=0，非拋例外）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { ListUserTransactionsSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    TRANSACTION_CATEGORY_KEYS, transactionCategoryKeyToNumber, transactionCategoryNumberToKey,
    TRANSACTION_STATUS_KEYS, transactionStatusKeyToNumber, transactionStatusNumberToKey,
    AGENT_MODE_FOR_SEARCH_KEYS, agentModeForSearchKeyToNumber, agentModeNumberToKey,
    toPlainNumber,
} from '../const.ts';

/**
 * 2026-08-25 review 發現：後端 searchNotEmpty()（agrabah/src/common/database_helper.ts:349-361）
 * 對數字 0 預設視為「未帶」，而 wallet.ts:902 呼叫時未傳 zero:true——TransactionStatusEnum.pending=0
 * 因此無法被篩選（帶了會被靜默忽略，回傳全部狀態）。只在這支 tool 的 status 篩選欄位排除
 * "pending"，不動 const.ts 的 TRANSACTION_STATUS_KEYS（該常數本身列舉是正確的，問題在這支
 * 後端方法的篩選實作，不是 enum 定義錯誤）。
 */
const TRANSACTION_STATUS_KEYS_FILTERABLE = TRANSACTION_STATUS_KEYS.filter((k) => k !== 'pending') as [ string, ...string[] ];

export function registerListUserTransactionsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wallet_platform_list_user_transactions',
        {
            title: 'List user wallet transactions on this platform',
            description:
                '查詢本平台會員的錢包交易紀錄（帳變紀錄）（rajah: WalletPlatform.ListUserTransactions，' +
                '需要權限節點 Finance.TransRecord）。' +
                '**搜尋區間限制**：未帶 startCreatedAtTimestamp/endCreatedAtTimestamp 時預設查「可查詢的' +
                '最早自然日 00:00:00 ~ 今日 23:59:59.999」；跨度上限 93 天、不可查 93 天以前的資料，超過' +
                '限制會回 walletExceedMaxSearchDayRange / walletExceedMaxSearchHistoryDay 錯誤。' +
                '**金額欄位是 stored 整數，非人類可讀金額**：回傳的 amount/beforeBalance/afterBalance 與' +
                '輸入的 minAmount/maxAmount 都是後端 stored 值（依該筆 currencyCode 的精度縮放，常見×10000），' +
                '本工具不做換算（單次查詢可能跨多種幣別，沒有單一縮放係數可套用），需呼叫端依每筆 currencyCode 自行換算。' +
                'identifiers/userIds/orderId 可用來精準鎖定特定會員或訂單；只帶範圍性條件（如僅 categories）' +
                '而未帶任何可鎖定單一目標的欄位時，結果可能是大量資料，請務必善用 page/pageSize 分批查看。' +
                'classificationsIds 用 aladdin_platform_wallet_platform_list_classification_categories 的 id。' +
                'categories/agentMode/status 是字串 key（如 categories=["paymentDeposit"]），非數字碼。' +
                '**status 無法篩選 "pending"**：2026-08-25 讀 agrabah 後端原始碼查證（' +
                'agrabah/src/common/database_helper.ts:349-361 的 searchNotEmpty()，對數字 0 預設視為' +
                '「未帶」而非「明確篩選 0」；agrabah/src/servers/wallet/services/wallet.ts:902 呼叫' +
                'searchNotEmpty(searchOriginal.status) 未傳 zero:true）——TransactionStatusEnum.pending=0，' +
                '帶 status="pending" 會被後端當成「沒帶這個篩選條件」直接忽略，實際拿回**全部狀態**的資料，' +
                '不會報錯也不會有任何提示。因此本工具的可選值只開放 success/failed/unknown，不提供 pending。',
            inputSchema: {
                accurate: z.boolean().optional().describe('是否精準搜尋（影響 identifiers 等字串欄位的比對模式）'),
                identifiers: z.array(z.string()).optional().describe('會員帳號（複數）'),
                userIds: z.array(z.number().int()).optional().describe('會員 id（複數）'),
                status: z.enum(TRANSACTION_STATUS_KEYS_FILTERABLE).optional().describe(
                    '交易狀態篩選：success/failed/unknown，省略代表全部不過濾。' +
                    '**不支援 "pending"**：後端 searchNotEmpty() 對數字 0（pending 的底層值）視為未帶，' +
                    '篩選會被靜默忽略、實際回傳全部狀態，見上方說明',
                ),
                categories: z.array(z.enum(TRANSACTION_CATEGORY_KEYS)).optional().describe('交易類型（複數），TransactionCategoryEnum 字串 key'),
                classificationsIds: z.array(z.number().int()).optional().describe('歸類 id（複數），來自 list_classification_categories'),
                depositMethodIds: z.array(z.number().int()).optional().describe('充值方式 id（複數）'),
                withdrawMethodIds: z.array(z.number().int()).optional().describe('提現方式 id（複數）'),
                operator: z.string().optional().describe('操作者'),
                userLevelIds: z.array(z.number().int()).optional().describe('會員層級 id（複數）'),
                userTags: z.array(z.number().int()).optional().describe('會員標籤 id（複數）'),
                orderId: z.string().optional().describe('訂單號（前綴搜尋）'),
                minAmount: z.number().int().optional().describe('交易金額最小值（stored 整數，非人類可讀金額，見說明）'),
                maxAmount: z.number().int().optional().describe('交易金額最大值（stored 整數，非人類可讀金額，見說明）'),
                agentIdentifiers: z.array(z.string()).optional().describe('上級代理帳號（複數）'),
                agentMode: z.enum(AGENT_MODE_FOR_SEARCH_KEYS).optional().describe('代理類型篩選：none=不篩選/generalAgent/ventureAgent/noAgent'),
                startCreatedAtTimestamp: z.number().int().optional().describe('交易時間區間開始（ms timestamp）；省略見說明的預設區間規則'),
                endCreatedAtTimestamp: z.number().int().optional().describe('交易時間區間結束（ms timestamp）；省略見說明的預設區間規則'),
                registeredTimeStart: z.number().int().optional().describe('會員註冊時間區間開始（ms timestamp）'),
                registeredTimeEnd: z.number().int().optional().describe('會員註冊時間區間結束（ms timestamp）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async (input) => {
            const search = ListUserTransactionsSearch.create({
                accurate: input.accurate,
                identifiers: input.identifiers,
                userIds: input.userIds,
                status: input.status !== undefined ? transactionStatusKeyToNumber(input.status) : undefined,
                categories: input.categories?.map(transactionCategoryKeyToNumber),
                classificationsIds: input.classificationsIds,
                depositMethodIds: input.depositMethodIds,
                withdrawMethodIds: input.withdrawMethodIds,
                operator: input.operator,
                userLevelIds: input.userLevelIds,
                userTags: input.userTags,
                orderId: input.orderId,
                minAmount: input.minAmount,
                maxAmount: input.maxAmount,
                agentIdentifiers: input.agentIdentifiers,
                agentMode: input.agentMode !== undefined ? agentModeForSearchKeyToNumber(input.agentMode) : undefined,
                startCreatedAtTimestamp: input.startCreatedAtTimestamp,
                endCreatedAtTimestamp: input.endCreatedAtTimestamp,
                registeredTimeStart: input.registeredTimeStart,
                registeredTimeEnd: input.registeredTimeEnd,
            });

            const r = await withAutoRelogin(() => remote.walletBackOffice.walletPlatform.ListUserTransactions(search, input.page ?? 1, input.pageSize ?? 50));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                status: row.status != null ? transactionStatusNumberToKey(row.status) : row.status,
                category: row.category != null ? transactionCategoryNumberToKey(row.category) : row.category,
                agentMode: row.agentMode != null ? agentModeNumberToKey(row.agentMode) : row.agentMode,
                // i64 欄位經 protobufjs decode 後是 Long 物件（{low,high,unsigned}），轉成一般 number，見檔頭註解。
                amount: toPlainNumber(row.amount),
                beforeBalance: toPlainNumber(row.beforeBalance),
                afterBalance: toPlainNumber(row.afterBalance),
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
                registerTimestamp: toPlainNumber(row.registerTimestamp),
            }));

            return asTextResult({
                success: true,
                rows,
                sumData: r.data?.sumData ?? null,
                totalPage: r.data?.totalPage,
            });
        },
    );
}
