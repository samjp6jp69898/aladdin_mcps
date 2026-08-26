/**
 * tools/get_post_comments.ts — aladdin_platform_message_board_platform_get_post_comments
 *
 * rajah: MessageBoardPlatform.GetPostComments(page i32 1, pageSize PageSizeEnum 2, postId i32 3,
 * options MessageBoardCommentSearch 4, isOfficial bool 5) (rows [MessageBoardComment] 1, totalPage i32 2)
 * （rajah/services/message_board_back_office.rajah:1556，@Permission "MessageBoard.MbPost.PostMgmt.Ops.PostComment"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodGetPostComments，580-621 行）確認有真實實作，非 notImplemented。
 * 分類：第 2 節「讀取清單」A 級——postId 是必填參數，天生鎖定單一貼文；options 內另有
 * userId/uid/nickname 可再鎖定單一發文者。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證：
 * - **陷阱**：`MessageBoardCommentSearch.postId`（rajah model 內 @Hide 欄位）在這支 method 完全
 *   不被使用——後端簽名把 `postId` 拆成獨立的頂層參數（不是走 `options.postId`），本工具的
 *   inputSchema 因此只暴露頂層 `postId`，不接受也不會送出 `options.postId`，避免呼叫端誤以為
 *   帶了 `options.postId` 會生效。`postId <= 0` 後端直接回 `invalidData` 錯誤。
 * - `isOfficial` 決定讀「官方動態」還是「一般會員動態」的評論表（各自獨立實體表），同一個
 *   postId 在兩張表可能各自存在完全無關的紀錄，呼叫端要確認清楚這則貼文是不是官方動態。
 * - `options.status` 用 `!== MessageBoardCommentStatusEnum.all` 判斷是否套用篩選，跟其他清單類
 *   method 同一種「省略與明確傳第一個列舉值在協定層等價」陷阱，本工具省略時固定送 "all"。
 * - `userId`（帳號字串）查無此帳號時回空清單，不報錯。
 * - **陷阱（2026-08-26 review 發現並修正）**：重讀 `methodGetPostComments` 完整 SQL condition 組裝
 *   （580-621 行），只依序用到 `beginTimestamp`/`endTimestamp`/`userId`/`status` 四個欄位，
 *   `options.uid`/`options.nickname` 從頭到尾未被讀取，是這支 method 的死欄位（跟姊妹 tool
 *   `GetMessageBoardPosts` 不同，那支後端真的有用 uid/nickname）。zod schema 保留這兩個欄位
 *   （對照 model 完整性），但 description 已明確標註「後端未套用，帶了不會篩選任何結果」，
 *   不再用「精確」這種暗示有效的字眼誤導呼叫端。
 * - **陷阱（2026-08-26 dev 實測發現並修正的真實 bug）**：`methodGetPostComments`（618-681 行）把
 *   `pageSize` 原樣傳進共用 helper `getPageData(..., page, pageSize)`，**沒有**像姊妹方法
 *   `methodGetMessageBoardPosts` 那樣自己做 `pageSize > 0 ? pageSize : DefaultPageSize` 保護。
 *   `getPageData`/`withPage` 對明確傳入的 `pageSize=0`（`PageSizeEnum.serverDefault`）不會 fallback
 *   成預設值——`withPage` 直接組出 `LIMIT 0, 0`，實測回傳 `rows:[]/totalPage:0`，即使該貼文底下真的
 *   有 89 筆評論。本工具因此在呼叫端自行把 "serverDefault"/省略 都轉成明確的 100，不把裸 0 送給後端；
 *   `methodGetMessageBoardComments`（見姊妹 tool get_message_board_comments.ts）有同樣結構，已同步修正。
 * - 回傳沒有 totalRow，只有 totalPage，不能用 rows.length 判斷是否還有下一頁時忽略這點。
 * - `createdAtTimestamp` 為 i64，經 protobufjs decode 可能是 Long 物件，已用 toPlainNumber 轉換；
 *   `type`/`status`/`userType`/`toUserType` 皆為 enum，已轉成字串 key 方便閱讀。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com 呼叫成功，用 get_message_board_posts 查到的真實
 * postId 帶入，回傳該貼文底下的真實評論列表；postId=0 正確回 invalidData 錯誤；isOfficial=true 對
 * 一個非官方 postId 查詢正確回空清單（非官方貼文的 id 不存在於官方評論表）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MessageBoardCommentSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    MESSAGE_BOARD_COMMENT_STATUS_MAP, MESSAGE_BOARD_TYPE_MAP, MESSAGE_BOARD_USER_TYPE_MAP,
    PAGE_SIZE_KEYS, PAGE_SIZE_MAP,
    numberToMapKey, toPlainNumber,
} from '../const.ts';

const STATUS_KEYS = Object.keys(MESSAGE_BOARD_COMMENT_STATUS_MAP) as [ keyof typeof MESSAGE_BOARD_COMMENT_STATUS_MAP, ...(keyof typeof MESSAGE_BOARD_COMMENT_STATUS_MAP)[] ];

export function registerGetPostCommentsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_get_post_comments',
        {
            title: 'List comments under a single message board post',
            description:
                '查詢單一大舞台動態貼文底下的評論列表（rajah: MessageBoardPlatform.GetPostComments，需要權限節點 ' +
                'MessageBoard.MbPost.PostMgmt.Ops.PostComment）。postId 必填（來自 ' +
                'aladdin_platform_message_board_platform_get_message_board_posts 的 id 欄位），<=0 會回錯誤。' +
                'isOfficial 決定讀「官方動態」還是「一般會員動態」的評論表，兩者是各自獨立的實體表，' +
                '同一個 postId 數字在兩邊可能對應完全無關的資料，請確認這則貼文的實際類型。' +
                'status 省略時本工具內部固定送 "all"（後端把「省略」與「明確傳第一個列舉值」視為同一回事）。' +
                'userId 查無此帳號時回空清單，不報錯。回傳只有 totalPage，沒有 totalRow。這是純讀取查詢，' +
                '可安全重複呼叫。',
            inputSchema: {
                postId: z.number().int().min(1).describe('大舞台動態貼文 id，必填，來自 get_message_board_posts 的 id 欄位'),
                isOfficial: z.boolean().describe('true=查官方動態的評論表，false=查一般會員動態的評論表；兩者是獨立實體表'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.enum(PAGE_SIZE_KEYS).optional().describe('每頁筆數：serverDefault/size10/size20/size30/size50/size100/size200。省略或帶 serverDefault 時本工具內部固定送 100（見下方陷阱說明，這支 method 的後端不會自己把 0 轉成預設值）'),
                userId: z.string().optional().describe('評論者帳號（精確），查無此帳號回空清單，不報錯'),
                status: z.enum(STATUS_KEYS).optional().describe(
                    '評論審核狀態篩選：pending(待審核)/approved(已審核)/rejected(已駁回)/' +
                    'removedPending(待審核刪除)/removedApproved(已審核刪除)/all(全部)，省略時本工具固定送 all',
                ),
                uid: z.number().int().optional().describe('評論者會員 UID。**後端此 method 未套用這個欄位篩選，帶了不會影響結果**，僅為對照 model 完整性保留'),
                nickname: z.string().optional().describe('評論者暱稱。**後端此 method 未套用這個欄位篩選，帶了不會影響結果**，僅為對照 model 完整性保留'),
                beginTimestamp: z.number().int().optional().describe('評論時間區間開始（秒級 timestamp）'),
                endTimestamp: z.number().int().optional().describe('評論時間區間結束（秒級 timestamp）'),
            },
        },
        async (input) => {
            const options = MessageBoardCommentSearch.create({
                beginTimestamp: input.beginTimestamp ?? 0,
                endTimestamp: input.endTimestamp ?? 0,
                userId: input.userId ?? '',
                status: MESSAGE_BOARD_COMMENT_STATUS_MAP[ input.status ?? 'all' ],
                uid: input.uid ?? 0,
                nickname: input.nickname ?? '',
            });

            // 陷阱：這支 method 的後端把 pageSize 原樣傳進 getPageData（無 `pageSize > 0 ? pageSize : DefaultPageSize`
            // 自我保護，見檔頭註解），"serverDefault"（0）會讓 withPage() 組出 `LIMIT 0, 0` 直接回空清單。
            // 本工具在這裡自己補上保護，不把裸 0 送給後端。
            const effectivePageSize = input.pageSize && input.pageSize !== 'serverDefault' ? PAGE_SIZE_MAP[ input.pageSize ] : 100;

            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.GetPostComments(
                input.page ?? 1,
                effectivePageSize,
                input.postId,
                options,
                input.isOfficial,
            ));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                type: row.type != null ? numberToMapKey(MESSAGE_BOARD_TYPE_MAP, row.type) : row.type,
                status: row.status != null ? numberToMapKey(MESSAGE_BOARD_COMMENT_STATUS_MAP, row.status) : row.status,
                userType: row.userType != null ? numberToMapKey(MESSAGE_BOARD_USER_TYPE_MAP, row.userType) : row.userType,
                toUserType: row.toUserType != null ? numberToMapKey(MESSAGE_BOARD_USER_TYPE_MAP, row.toUserType) : row.toUserType,
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
