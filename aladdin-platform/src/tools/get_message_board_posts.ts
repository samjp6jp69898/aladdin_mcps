/**
 * tools/get_message_board_posts.ts — aladdin_platform_message_board_platform_get_message_board_posts
 *
 * rajah: MessageBoardPlatform.GetMessageBoardPosts(page i32 1, pageSize PageSizeEnum 2, options MessageBoardSearch 3)
 * (rows [MessageBoardPost] 1, totalPage i32 2, totalRow i32 3)
 * （rajah/services/message_board_back_office.rajah:1552，@Permission "MessageBoard.MbPost.PostMgmt"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodGetMessageBoardPosts）確認有真實實作，非 notImplemented。
 * 分類：第 2 節「讀取清單」A 級——options.uid（會員 UID，精確）、options.userId（帳號，內部會
 * resolve 成 uid）、options.nickname（暱稱，精確）皆可鎖定單一目標，非只有範圍鍵+分頁。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（message_board_platform.ts:methodGetMessageBoardPosts）：
 * - `type`/`commentStatus` 分別是 MessageBoardTypeEnum/MessageBoardStatusEnum，後端各自用
 *   `!== xxx.all` 判斷是否套用篩選；`all` 才是「不篩選」語意（type.all=3、status.all=8），跟
 *   list_records.ts 記錄過的 status=0 陷阱同一種結構性成因，本工具兩個欄位省略時都固定送 "all"。
 * - `receiveGiftStatus`（MessageBoardReceiveGiftEnum，enabled=1/disabled=2）後端用純 truthy
 *   判斷（`if (options.receiveGiftStatus)`），0（省略）天然就是「不篩選」，不需要額外的 all 值。
 * - `userId`（帳號字串）查無此帳號時後端直接回空清單（不報錯）；`nickname` 查無符合暱稱同樣回
 *   空清單。`uid`/`userId`/`nickname` 三者可同時帶，但後端各自疊加 AND 條件（非互斥擇一），呼叫端
 *   應只帶其中一種避免查詢條件互相打架查不到預期結果。
 * - `giftTotalAmount` 是 CurrencyLink[]（多幣別，value 為 stored 值，非顯示金額，換算方式同
 *   list_records.ts 的說明），timestamp 系列欄位（`createdAtTimestamp`/`updatedAtTimestamp`/
 *   `hotExpireAtTimestamp`/`pinExpireAtTimestamp`）與 `listScore` 為 i64，經 protobufjs decode
 *   可能是 Long 物件，皆已用 const.ts 的 toPlainNumber/toPlainCurrencyLinks 轉換；`id` 本身是
 *   i32（非 i64），呼叫 toPlainNumber 只是保守處理，非必要轉換。
 * - `officialPostStatus`（OfficialPostStatusEnum，show=1/hide=2）查證 `methodGetMessageBoardPosts`
 *   實作**完全沒有讀取這個欄位**（只有另一支官方貼文專用方法會用到），本工具仍依 checklist 第 2 節
 *   A 級「zod schema 對照 model 全部欄位」的硬性要求收錄，description 明確標註對一般動態列表無效，
 *   避免呼叫端誤以為能用它篩選一般動態的顯示狀態。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com 呼叫成功，省略全部篩選條件回傳
 * totalRow=158/totalPage=2（該站已有真實動態資料，非第一頁情境已覆蓋）；帶 uid 精準查詢命中、
 * 帶不存在的 nickname 正確回空清單且不報錯、commentStatus="approved" 篩選正確回較小 totalRow。
 * 過程中發現並修正一個真實 bug：`listScore`（i64 排序權重欄位）原本漏了 toPlainNumber 轉換，
 * 實測回傳出現 protobufjs 的 Long 物件 `{low,high,unsigned}` 而非數字，已修正。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MessageBoardSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    MESSAGE_BOARD_TYPE_MAP, MESSAGE_BOARD_STATUS_MAP, MESSAGE_BOARD_RECEIVE_GIFT_MAP,
    MESSAGE_BOARD_PIN_FILTER_MAP, MESSAGE_BOARD_HOT_FILTER_MAP, OFFICIAL_POST_STATUS_MAP,
    PAGE_SIZE_KEYS, PAGE_SIZE_MAP,
    numberToMapKey, toPlainNumber, toPlainCurrencyLinks,
} from '../const.ts';

const TYPE_KEYS = Object.keys(MESSAGE_BOARD_TYPE_MAP) as [ keyof typeof MESSAGE_BOARD_TYPE_MAP, ...(keyof typeof MESSAGE_BOARD_TYPE_MAP)[] ];
const STATUS_KEYS = Object.keys(MESSAGE_BOARD_STATUS_MAP) as [ keyof typeof MESSAGE_BOARD_STATUS_MAP, ...(keyof typeof MESSAGE_BOARD_STATUS_MAP)[] ];
const RECEIVE_GIFT_KEYS = Object.keys(MESSAGE_BOARD_RECEIVE_GIFT_MAP) as [ keyof typeof MESSAGE_BOARD_RECEIVE_GIFT_MAP, ...(keyof typeof MESSAGE_BOARD_RECEIVE_GIFT_MAP)[] ];
const PIN_FILTER_KEYS = Object.keys(MESSAGE_BOARD_PIN_FILTER_MAP) as [ keyof typeof MESSAGE_BOARD_PIN_FILTER_MAP, ...(keyof typeof MESSAGE_BOARD_PIN_FILTER_MAP)[] ];
const HOT_FILTER_KEYS = Object.keys(MESSAGE_BOARD_HOT_FILTER_MAP) as [ keyof typeof MESSAGE_BOARD_HOT_FILTER_MAP, ...(keyof typeof MESSAGE_BOARD_HOT_FILTER_MAP)[] ];
const OFFICIAL_POST_STATUS_KEYS = Object.keys(OFFICIAL_POST_STATUS_MAP) as [ keyof typeof OFFICIAL_POST_STATUS_MAP, ...(keyof typeof OFFICIAL_POST_STATUS_MAP)[] ];

export function registerGetMessageBoardPostsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_get_message_board_posts',
        {
            title: 'List message board (大舞台) posts',
            description:
                '查詢大舞台動態列表（rajah: MessageBoardPlatform.GetMessageBoardPosts，需要權限節點 ' +
                'MessageBoard.MbPost.PostMgmt）。uid（會員 UID，精確）/userId（帳號，精確）/nickname（暱稱，' +
                '精確）任一即可鎖定單一使用者的動態，三者可同時帶但會疊加 AND 條件，建議只帶其中一種。' +
                'type/commentStatus 省略時本工具內部固定送 "all"（後端把「省略」與「明確傳第一個列舉值」' +
                '在協定層視為同一件事，若不處理會被誤判成只篩選特定型態/狀態而非不篩選）。' +
                'giftTotalAmount 是 CurrencyLink[] 多幣別陣列，value 是 stored 值非人類可讀金額，依 code ' +
                '幣別精度換算（常見 ÷10000），本工具不做換算。這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.enum(PAGE_SIZE_KEYS).optional().describe('每頁筆數：serverDefault(後端預設 100)/size10/size20/size30/size50/size100/size200，省略同 serverDefault'),
                type: z.enum(TYPE_KEYS).optional().describe('動態型態篩選：text(純文字)/image(圖片)/video(視頻)/all(全部)，省略時本工具固定送 all'),
                commentStatus: z.enum(STATUS_KEYS).optional().describe(
                    '審核狀態篩選：pending(待審核)/approved(通過)/rejected(未通過)/delisted(下架)/' +
                    'removePending(刪除待審)/removeApproved(刪除已核准)/removeRejected(刪除未通過)/' +
                    'removeDelisted(刪除下架)/all(全部)，省略時本工具固定送 all',
                ),
                userId: z.string().optional().describe('發文者帳號（精確），查無此帳號回空清單，不報錯'),
                uid: z.number().int().optional().describe('發文者會員 UID（精確）'),
                nickname: z.string().optional().describe('發文者暱稱（精確），查無符合暱稱回空清單'),
                beginTimestamp: z.number().int().optional().describe('發文時間區間開始（秒級 timestamp）'),
                endTimestamp: z.number().int().optional().describe('發文時間區間結束（秒級 timestamp）'),
                receiveGiftStatus: z.enum(RECEIVE_GIFT_KEYS).optional().describe('是否可打賞篩選：enabled/disabled，省略不篩選'),
                pinFilter: z.enum(PIN_FILTER_KEYS).optional().describe('置頂篩選：all/pinned(置頂中)/notPinned(非置頂)，預設 all'),
                hotFilter: z.enum(HOT_FILTER_KEYS).optional().describe('熱門篩選：all/hot(熱門中)/notHot(非熱門)，預設 all'),
                officialPostStatus: z.enum(OFFICIAL_POST_STATUS_KEYS).optional().describe(
                    '官方動態顯示狀態：show/hide。**僅對官方動態查詢生效，一般動態列表（本工具的預設用途）' +
                    '後端完全不讀這個欄位，帶了也不會篩選任何結果**——為了對照 rajah model 完整欄位而保留，' +
                    '一般情境不需要帶。',
                ),
            },
        },
        async (input) => {
            const options = MessageBoardSearch.create({
                type: MESSAGE_BOARD_TYPE_MAP[ input.type ?? 'all' ],
                commentStatus: MESSAGE_BOARD_STATUS_MAP[ input.commentStatus ?? 'all' ],
                userId: input.userId ?? '',
                uid: input.uid ?? 0,
                nickname: input.nickname ?? '',
                beginTimestamp: input.beginTimestamp ?? 0,
                endTimestamp: input.endTimestamp ?? 0,
                receiveGiftStatus: input.receiveGiftStatus ? MESSAGE_BOARD_RECEIVE_GIFT_MAP[ input.receiveGiftStatus ] : 0,
                pinFilter: MESSAGE_BOARD_PIN_FILTER_MAP[ input.pinFilter ?? 'all' ],
                hotFilter: MESSAGE_BOARD_HOT_FILTER_MAP[ input.hotFilter ?? 'all' ],
                officialPostStatus: input.officialPostStatus ? OFFICIAL_POST_STATUS_MAP[ input.officialPostStatus ] : 0,
            });

            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.GetMessageBoardPosts(
                input.page ?? 1,
                PAGE_SIZE_MAP[ input.pageSize ?? 'serverDefault' ],
                options,
            ));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                id: toPlainNumber(row.id),
                type: row.type != null ? numberToMapKey(MESSAGE_BOARD_TYPE_MAP, row.type) : row.type,
                status: row.status != null ? numberToMapKey(MESSAGE_BOARD_STATUS_MAP, row.status) : row.status,
                giftTotalAmount: toPlainCurrencyLinks(row.giftTotalAmount),
                hotExpireAtTimestamp: toPlainNumber(row.hotExpireAtTimestamp),
                pinExpireAtTimestamp: toPlainNumber(row.pinExpireAtTimestamp),
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
                updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
                listScore: toPlainNumber(row.listScore),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage, totalRow: r.data?.totalRow });
        },
    );
}
