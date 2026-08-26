/**
 * tools/get_message_board_comments.ts — aladdin_platform_message_board_platform_get_message_board_comments
 *
 * rajah: MessageBoardPlatform.GetMessageBoardComments(page i32 1, pageSize PageSizeEnum 2,
 * options MessageBoardCommentSearch 3, isOfficial bool 4) (rows [MessageBoardComment] 1, totalPage i32 2)
 * （rajah/services/message_board_back_office.rajah:1560，@Permission "MessageBoard.MbPost.CommentMgmt"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodGetMessageBoardComments，883-960 行）確認有真實實作，非
 * notImplemented。分類：第 2 節「讀取清單」A 級——options.postId/uid/userId/nickname 皆可鎖定單一
 * 目標，非只有範圍鍵+分頁。
 *
 * 這是「全平台評論管理」列表（對比姊妹 tool get_post_comments.ts 是單貼文專用）：
 * - **與 get_post_comments.ts 的關鍵差異**：這支 method 真的有讀取 `options.postId`（>0 時套用篩選，
 *   933 行），不是像 GetPostComments 那樣被頂層參數整個蓋掉的死欄位——已重新查證後端 SQL condition
 *   組裝，postId 在此 method 是真正生效的可選篩選欄位，故 zod schema 保留在 options 內，非頂層必填。
 * - `userId`（帳號字串，經 resolveUserIdByIdentifier 解析）/`uid`（會員 UID 數字，直接比對）/
 *   `nickname`（暱稱，經 resolveUserIdsByNickname 解析成 uid 清單）三者皆可同時帶，疊加 AND 條件，
 *   建議只帶其中一種避免互相打架查不到預期結果；查無帳號/暱稱時回空清單，不報錯。
 * - **isOfficial 分支陷阱**：官方動態的評論表 user_type 不是「這則評論在哪張表」的判斷依據（該判斷
 *   已由 isOfficial 決定走 DbOfficialComment/DbComment 哪張實體表），故 isOfficial=true 時
 *   userId/uid/nickname 篩選只比對 user_id，不疊加 `user_type = player`；isOfficial=false 時才會疊加
 *   `user_type = player`（一般會員動態的評論發文者必為會員）。本工具原樣透傳 isOfficial 給後端，
 *   由後端自行處理這個分支，呼叫端不需要額外操作。
 * - `status` 用 `!== MessageBoardCommentStatusEnum.all` 判斷是否套用篩選，省略時本工具固定送 "all"。
 * - **陷阱（2026-08-26 dev 實測發現並修正的真實 bug，與姊妹 tool get_post_comments.ts 相同結構）**：
 *   `methodGetMessageBoardComments`（954-1020 行）把 `pageSize` 原樣傳進 `getPageData(..., page,
 *   pageSize)`，沒有像 `methodGetMessageBoardPosts` 那樣自己做 `pageSize > 0 ? pageSize :
 *   DefaultPageSize` 保護。`pageSize=0`（serverDefault）會讓 `withPage` 組出 `LIMIT 0, 0`，回傳
 *   空清單而非後端「預設 100」筆。本工具因此在呼叫端自行把 "serverDefault"/省略都轉成明確的 100，
 *   不把裸 0 送給後端。
 * - `createdAtTimestamp` 為 i64，已用 toPlainNumber 轉換；`type`/`status`/`userType`/`toUserType`
 *   皆為 enum，已轉字串 key（沿用 get_post_comments.ts 已建立的 const.ts 對照表）。
 * - 回傳沒有 totalRow，只有 totalPage。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com 呼叫成功，省略全部篩選條件回傳真實跨貼文評論列表；
 * 帶 postId 篩選正確只回該貼文底下的評論（與 get_post_comments.ts 對同一 postId 的結果一致）；
 * status="all" 顯式帶入與省略結果相同。
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

export function registerGetMessageBoardCommentsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_get_message_board_comments',
        {
            title: 'List message board comments across all posts (comment management)',
            description:
                '查詢大舞台跨貼文評論列表（「評論管理」頁面用，rajah: MessageBoardPlatform.GetMessageBoardComments，' +
                '需要權限節點 MessageBoard.MbPost.CommentMgmt）。與 get_post_comments 不同：這支是全平台評論查詢，' +
                'postId 為選填篩選條件（不帶則查全部貼文的評論）。isOfficial 決定讀「官方動態」還是「一般會員動態」' +
                '的評論表，兩者是各自獨立的實體表。userId（帳號，精確）/uid（會員 UID，精確）/nickname（暱稱，' +
                '精確）任一即可鎖定單一使用者，三者可同時帶但會疊加 AND 條件，建議只帶其中一種；查無帳號/暱稱' +
                '回空清單，不報錯。status 省略時本工具內部固定送 "all"（後端把「省略」與「明確傳第一個列舉值」' +
                '視為同一回事）。回傳只有 totalPage，沒有 totalRow。這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                isOfficial: z.boolean().describe('true=查官方動態的評論表，false=查一般會員動態的評論表；兩者是獨立實體表'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.enum(PAGE_SIZE_KEYS).optional().describe('每頁筆數：serverDefault/size10/size20/size30/size50/size100/size200。省略或帶 serverDefault 時本工具內部固定送 100（見下方陷阱說明，這支 method 的後端不會自己把 0 轉成預設值）'),
                postId: z.number().int().optional().describe('大舞台動態貼文 id（選填，不帶則查全部貼文的評論），來自 get_message_board_posts 的 id 欄位'),
                userId: z.string().optional().describe('評論者帳號（精確），查無此帳號回空清單，不報錯'),
                uid: z.number().int().optional().describe('評論者會員 UID（0 表示不篩選，精確）'),
                nickname: z.string().optional().describe('評論者暱稱（空表示不篩選，精確），查無符合暱稱回空清單'),
                status: z.enum(STATUS_KEYS).optional().describe(
                    '評論審核狀態篩選：pending(待審核)/approved(已審核)/rejected(已駁回)/' +
                    'removedPending(待審核刪除)/removedApproved(已審核刪除)/all(全部)，省略時本工具固定送 all',
                ),
                beginTimestamp: z.number().int().optional().describe('評論時間區間開始（秒級 timestamp）'),
                endTimestamp: z.number().int().optional().describe('評論時間區間結束（秒級 timestamp）'),
            },
        },
        async (input) => {
            const options = MessageBoardCommentSearch.create({
                postId: input.postId ?? 0,
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

            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.GetMessageBoardComments(
                input.page ?? 1,
                effectivePageSize,
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
