/**
 * tools/review_post.ts — aladdin_platform_message_board_platform_review_post
 *
 * rajah: MessageBoardPlatform.ReviewPost(id i32 1, status MessageBoardStatusEnum 2)（無回傳值）
 * （rajah/services/message_board_back_office.rajah:1566，非 @NoPublic）
 *
 * **權限查證更正（2026-08-26 review 發現）**：本檔原本主張這支 method 靠 service 標頭上方
 * `# @Permission "MessageBoard"`（同檔 1529 行）以 rajah/CLAUDE.md「狀況三」承接權限，**這個主張
 * 錯誤**——1529 行以 `#` 開頭是純註解，不是真實 attribute（真實 attribute 語法是行首直接 `@Xxx`，
 * 緊接的 1530 行 `@Module "MessageBoard"` 才是）。查證 jasmine parser（`parseAttributes()` 只消耗
 * `TokenType.Attribute`，`#` 開頭整行會被 lexer 當 comment token 處理，與 service.attributes 無關）
 * 確認 `service MessageBoardPlatform` 的真實 attributes 只有 `Module`，沒有 `Permission`。`ReviewPost`
 * 本身也沒有自己的 `@Permission`——**這支 method 在 rajah 裡完全沒有 `@Permission`，很可能代表後端對
 * 它不做權限檢查**（比照 rajah/CLAUDE.md 對「移除 @Permission」情境的說明：任何有效登入的使用者皆可
 * 調用），不是「需要權限節點 MessageBoard」。同一份 `# @Permission "..."` 死註解在多個
 * `*_back_office.rajah` 檔案出現，疑似團隊慣用的非功能性文件註解，容易誤導人以為它有效——本工具的
 * description 已改為誠實描述這個不確定狀態，不再宣稱受權限保護。
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （message_board_platform.ts:methodReviewPost/`_reviewSinglePost`，1042-1160 行）確認有真實實作，
 * 非 notImplemented。分類：第 6 節「狀態轉換」——status 為輸入參數且是要設定的目標狀態（非查詢
 * 篩選條件）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（`_reviewSinglePost`，1101-1160 行）：
 * - **只接受 `approved`/`rejected` 兩種目標狀態**，其餘一律回 `messageBoardReviewPostStatusInvalid`。
 * - **不冪等，且會拒絕非法轉換**：先查一次 `id = ? AND platform_id = ? AND status = pending`
 *   （1107 行），查無列（絕大多數情況，含「id 不存在」與「id 存在但目前不是 pending」）一律回
 *   `messageBoardPostNotExists`，無法從錯誤碼本身分辨是哪一種，需要呼叫端自行先用
 *   get_message_board_posts（帶 uid 或其他篩選鎖定該筆）確認目前狀態。UPDATE 語句本身也帶
 *   `AND status = ?`（1115-1120 行）：若查詢與更新之間發生極少數的競態，`updateResult.data === 0`
 *   會改走另一個分支回 `messageBoardPostUpdateFailed`（1147-1149 行），這是邊界情況，非主要路徑。
 * - **僅適用一般會員貼文，不支援官方貼文**：直接操作 `posts` 表（`DbPostsBackOffice`），沒有
 *   `isOfficial` 參數，官方貼文（`AddOfficialPost`/`EditOfficialPost` 建立）不會出現在這個審核流程。
 * - 成功時後端會做：`list_score` 重算、寫入 audit；`status=approved` 時額外處理打賞收入 summary_state
 *   （`pending`→`applied`）；`status=rejected` 時若發文者是**一般會員**（非平台/馬甲帳號）會觸發站內
 *   通知，平台官方帳號類型不會收到通知（後端內部已處理，本工具不需額外動作）。
 * - 無回傳資料（Empty），本工具成功時不 round-trip 讀回（get_message_board_posts 可由呼叫端視需要另行查證）。
 *
 * **2026-08-26 dev 實測**：pk-platform.alddev.com——對已知處於 approved 狀態的貼文重複呼叫
 * status="approved"，正確回 messageBoardPostNotExists（非法轉換被拒絕，符合預期）；對不存在的
 * postId 呼叫同樣回 messageBoardPostNotExists。**誠實限制**：因為未能在 dev 找到真正處於 pending
 * 狀態、且可安全操作（不影響其他人正在測試的資料）的貼文，未能實測「成功審核通過一筆」的完整
 * round-trip（pending→approved 再驗證讀回狀態），已驗證的是「非法轉換會被正確拒絕」這條路徑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { MESSAGE_BOARD_STATUS_MAP } from '../const.ts';

const REVIEW_STATUS_KEYS = [ 'approved', 'rejected' ] as const;

export function registerReviewPostTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_review_post',
        {
            title: 'Approve or reject a single pending message board post',
            description:
                '審核單筆待審核的大舞台動態貼文（rajah: MessageBoardPlatform.ReviewPost）。**權限狀況不明確' +
                '：這支 method 在 rajah 裡沒有任何 @Permission（service 標頭上方看似有一行 ' +
                '"# @Permission MessageBoard"，實際是死註解、不生效），很可能代表後端對它完全不做權限檢查' +
                '——任何能登入 platform 後台的帳號都可能可以呼叫，不是受限於特定權限節點**。' +
                '**只適用一般會員貼文，不支援官方貼文**（官方貼文由 AddOfficialPost/' +
                'EditOfficialPost 建立，不進入這個審核流程）。status 只能是 approved(通過) 或 rejected(拒絕)。' +
                '**不冪等**：這支操作只對「目前真的是 pending 狀態」的貼文生效，對已審核過（無論通過/拒絕/' +
                '下架等）或不存在的 id 重複呼叫，一律回 messageBoardPostNotExists——這個錯誤碼無法區分' +
                '「id 不存在」與「id 存在但已不是 pending」，不確定目前狀態時建議先用 get_message_board_posts 查一次。' +
                '通過後會觸發打賞收入結算；拒絕後若發文者是一般會員會收到站內通知（平台官方帳號不會）。' +
                '成功無回傳資料，本工具不會自動 round-trip 讀回。',
            inputSchema: {
                id: z.number().int().min(1).describe('大舞台動態貼文 id，必須目前處於 pending（待審核）狀態，來自 get_message_board_posts（commentStatus="pending"）的 id 欄位'),
                status: z.enum(REVIEW_STATUS_KEYS).describe('審核結果：approved(通過)/rejected(拒絕)，僅接受這兩種值'),
            },
        },
        async (input) => {
            const r = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.ReviewPost(
                input.id,
                MESSAGE_BOARD_STATUS_MAP[ input.status ],
            ));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: '常見原因：貼文 id 不存在，或目前不是 pending 狀態（已審核過/已下架），可先用 get_message_board_posts 確認目前狀態',
                });
            }

            return asTextResult({ success: true, message: `貼文 ${ input.id } 已審核為 ${ input.status }` });
        },
    );
}
