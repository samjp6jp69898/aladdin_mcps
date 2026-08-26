/**
 * tools/get_post_gift_records.ts — aladdin_platform_message_board_platform_get_post_gift_records
 *
 * rajah: MessageBoardPlatform.GetPostGiftRecords(page i32 1, postId i32 2, options MessageBoardPostGiftRecordSearch 3,
 * isOfficial bool 4) (rows [MessageBoardPostGiftRecord] 1, totalPage i32 2)
 * （rajah/services/message_board_back_office.rajah:1558，@Permission "MessageBoard.MbPost.PostMgmt.Ops.GiftRecord"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodGetPostGiftRecords，752-858 行）確認有真實實作，非 notImplemented。
 * 分類：第 2 節「讀取清單」A 級——postId 是必填頂層參數，天生鎖定單一貼文；options.userId 可再鎖定單一使用者。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證：
 * - **無 pageSize 參數**：這支 method 的簽名沒有 pageSize（跟姊妹 tool GetPostComments/GetMessageBoardPosts
 *   不同），後端 `withPage(currentPage)` 不帶 pageSize 引數，固定用伺服器端 DefaultPageSize，呼叫端無法調整。
 * - **`options.userId` 是 i32（會員 UID），不是帳號字串**：跟其他大舞台 search model 常見的「userId 字串帳號 +
 *   內部 resolveUserIdByIdentifier 轉換」模式不同，這支直接 `condition += 'AND user_id = ?'` 拿
 *   `options.userId` 原始數值比對，本工具對應的 zod 欄位命名為 `uid` 避免與其他 tool 的字串帳號欄位混淆。
 * - `options.status`（`MessageBoardGiftRecordStatusClientEnum`，`@Rules "Required"`）用
 *   `!== .all` 判斷是否套用篩選，`all=999` 才是「不篩選」語意，省略時本工具固定送 "all"。
 * - `totalAmount`（CurrencyLink[]，僅 1 筆）的 `value` 是後端 `.storedToNormal()` **之前**擷取的
 *   `row.totalAmount` 原始值，即 stored 值，非顯示金額，換算方式同 list_records.ts 的說明。
 * - `giftName`/`giftIcon`（LocalizationString[]，`{code, value}`）來自內部禮物清單快取比對
 *   `dbGiftRecord.giftId`，查無對應禮物（例如禮物已被刪除）時回空陣列，不報錯。
 * - `id`（i32）、`createdAtTimestamp`（i64，已轉換）；`status` 為 enum，已轉字串 key。
 * - 回傳沒有 totalRow，只有 totalPage。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com 呼叫成功，用 get_message_board_posts 查到的
 * gifts>0 真實 postId 帶入，回傳該貼文底下的真實送禮紀錄；postId 不存在時正確回空清單。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MessageBoardPostGiftRecordSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    MESSAGE_BOARD_GIFT_RECORD_STATUS_CLIENT_MAP, MESSAGE_BOARD_GIFT_RECORD_STATUS_MAP,
    numberToMapKey, toPlainNumber, toPlainCurrencyLinks,
} from '../const.ts';

const STATUS_KEYS = Object.keys(MESSAGE_BOARD_GIFT_RECORD_STATUS_CLIENT_MAP) as [ keyof typeof MESSAGE_BOARD_GIFT_RECORD_STATUS_CLIENT_MAP, ...(keyof typeof MESSAGE_BOARD_GIFT_RECORD_STATUS_CLIENT_MAP)[] ];

export function registerGetPostGiftRecordsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_get_post_gift_records',
        {
            title: 'List gift-sending records under a single message board post',
            description:
                '查詢單一大舞台動態貼文底下的打賞送禮紀錄（rajah: MessageBoardPlatform.GetPostGiftRecords，' +
                '需要權限節點 MessageBoard.MbPost.PostMgmt.Ops.GiftRecord）。postId 必填（來自 ' +
                'aladdin_platform_message_board_platform_get_message_board_posts 的 id 欄位），<=0 會回錯誤。' +
                'isOfficial 決定讀「官方動態」還是「一般會員動態」的送禮紀錄表，兩者是各自獨立的實體表。' +
                '**這支 method 沒有 pageSize 參數**，每頁筆數固定為後端預設值，呼叫端無法調整，只能用 page 翻頁。' +
                'uid 是會員 UID（數字），不是帳號字串。status 省略時本工具內部固定送 "all"（後端把「省略」與' +
                '「明確傳第一個列舉值」視為同一回事）。totalAmount 是 CurrencyLink[]（僅 1 筆），value 是 ' +
                'stored 值非人類可讀金額，依 code 幣別精度換算（常見 ÷10000），本工具不做換算。giftName/giftIcon ' +
                '查無對應禮物（如已刪除）時為空陣列。回傳只有 totalPage，沒有 totalRow。這是純讀取查詢，可安全' +
                '重複呼叫。',
            inputSchema: {
                postId: z.number().int().min(1).describe('大舞台動態貼文 id，必填，來自 get_message_board_posts 的 id 欄位'),
                isOfficial: z.boolean().describe('true=查官方動態的送禮紀錄表，false=查一般會員動態的送禮紀錄表；兩者是獨立實體表'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1；每頁筆數固定為後端預設值，無法調整'),
                uid: z.number().int().optional().describe('送禮者會員 UID（精確，數字，非帳號字串）'),
                status: z.enum(STATUS_KEYS).optional().describe(
                    '送禮紀錄狀態篩選（16 種細分狀態，涵蓋購買/扣款/入帳/審核/退款各階段），常見值：' +
                    'addToReceiver(收款並更新紀錄成功，終態成功)/pendingReview(待審核)/reviewRejectRefunded' +
                    '(已拒絕已退錢，終態失敗)/all(全部)。其餘中間態多為失敗重試中，省略時本工具固定送 all',
                ),
                beginTimestamp: z.number().int().optional().describe('送禮時間區間開始（秒級 timestamp）'),
                endTimestamp: z.number().int().optional().describe('送禮時間區間結束（秒級 timestamp）'),
            },
        },
        async (input) => {
            const options = MessageBoardPostGiftRecordSearch.create({
                beginTimestamp: input.beginTimestamp ?? 0,
                endTimestamp: input.endTimestamp ?? 0,
                userId: input.uid ?? 0,
                status: MESSAGE_BOARD_GIFT_RECORD_STATUS_CLIENT_MAP[ input.status ?? 'all' ],
            });

            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.GetPostGiftRecords(
                input.page ?? 1,
                input.postId,
                options,
                input.isOfficial,
            ));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                status: row.status != null ? numberToMapKey(MESSAGE_BOARD_GIFT_RECORD_STATUS_MAP, row.status) : row.status,
                totalAmount: toPlainCurrencyLinks(row.totalAmount),
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
