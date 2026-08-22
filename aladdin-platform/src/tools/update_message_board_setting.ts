/**
 * tools/update_message_board_setting.ts — aladdin_platform_message_board_platform_set_message_board_post_setting
 *
 * rajah: MessageBoardPlatform.GetMessageBoardPostSetting + SetMessageBoardPostSetting
 * （message_board_back_office.rajah:1560-1564，@Permission "MessageBoard.MbSetting.Setup.Save"）
 *
 * 對應前端頁面：「大舞台中心」(message-board) →「大舞台設定」(message-board-setting)
 * 頁籤下的「基本設置」(message-board-setup) 分頁，abu/platform/src/pages/message_board/
 * MessageBoardSetup.vue 的 saveSettings()——實際打的就是 SetMessageBoardPostSetting，
 * 送出的是整包 MessageBoardPostSetting（不是只送有改的欄位）。
 *
 * SetMessageBoardPostSetting 吃的是完整物件，不是 partial patch，且 rajah 全庫沒有
 * @Optional/@Partial 這類「欄位存在性」標記可以判斷後端會不會把沒帶到的欄位當成
 * 「明確要歸零」覆蓋掉（method-category-checklist.md 第 4 節）——所以這裡照該檢查清單
 * 要求的模式：先呼叫 GetMessageBoardPostSetting 讀現值，只覆蓋呼叫端明確帶的欄位，
 * 其餘（含 id/version/commentWeight/likeWeight/postsGiftPlatformCommission/
 * postsChangeUserDetailMinChargeVersion 等前端「基本設置」頁面本來就不給編輯的內部欄位）
 * 原樣帶回，完成後再讀一次做 round-trip 驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { MessageBoardPostSetting } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ACTIVE_STATUS_MAP,
    GIFT_CONDS_LOGIC_MAP,
    TIP_AUDIT_RELEASE_TYPE_MAP,
    GLOBAL_PIN_MODE_MAP,
    CHANGE_USER_DETAIL_CHARGE_TIMES_MAP,
} from '../const.ts';
import { formatMessageBoardSetting } from './get_message_board_setting.ts';

const statusToggle = z.enum([ 'enabled', 'disabled' ]);

export function registerUpdateMessageBoardSettingTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_message_board_platform_set_message_board_post_setting',
        {
            title: 'Update message board (stage) basic setting',
            description:
                '修改本平台「大舞台中心」→「大舞台設定」頁籤中「基本設置」分頁的設定並儲存' +
                '（rajah: MessageBoardPlatform.SetMessageBoardPostSetting，就是該頁面「儲存」按鈕實際打的 API）。' +
                '無參數，單例設定，平台由連線本身判定，不需要、也不接受 platformId。' +
                '所有欄位皆為 optional：只帶你要改的欄位，其餘會先讀現值原樣帶回，不會被清空或歸零' +
                '（後端這支 method 吃整包物件、不是 partial patch，見檔頭註解）。' +
                '完成後會自動讀回最新設定一併回傳，方便核對是否真的改成功。' +
                'postsGiftWageringMultiplier 要傳「顯示倍率 × 10000」的整數（例如要設成 1.5 倍，傳 15000，' +
                '不是傳 1.5 或 1.5 萬）——這是後端實際儲存格式，前端輸入框顯示的小數只是除以 10000 後的結果。' +
                'pinEffectiveHours 只有在 globalPinMode="timed"（限時置頂）時才有意義，其他模式下後端會忽略這個值。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                // 基本設置
                postsUserAuthSwitch: statusToggle.optional().describe('貼文使用者需認證開關'),
                postsReviewSwitch: statusToggle.optional().describe('貼文需審核開關'),
                postsCommentReviewSwitch: statusToggle.optional().describe('評論需審核開關'),
                postsLevel: z.number().int().min(0).optional().describe('可發貼文的大舞台等級門檻'),
                postsCommentLevel: z.number().int().min(0).optional().describe('可發評論的大舞台等級門檻'),
                postsGiftSendLevel: z.number().int().min(0).optional().describe('可打賞的大舞台等級門檻'),

                // 個人資訊設置
                postsChangeUserDetailMinChargeTimes: z.enum([ 'noNeed', 'minChargeTimesOne', 'minChargeTimesTwo' ]).optional()
                    .describe('更改使用者資訊需充值次數：noNeed=不需充值、minChargeTimesOne=需充值1次、minChargeTimesTwo=需充值2次'),
                postsChangeUserDetailMinChargeTotal: z.number().int().min(0).optional().describe('更改使用者資訊需充值總金額'),
                postsReviewChangeUserDetailSwitch: statusToggle.optional().describe('更改使用者資訊需審核開關'),

                // 動態打賞設置
                postsGiftCondsLogic: z.enum([ 'all', 'any' ]).optional().describe('打賞達成條件邏輯：all=需同時滿足全部條件、any=滿足任一條件即可'),
                postsGiftCondsCrntDayCharge: z.number().int().min(0).optional().describe('打賞達成條件－當日充值金額門檻'),
                postsGiftCondsThreeDayCharge: z.number().int().min(0).optional().describe('打賞達成條件－三日累計充值金額門檻'),

                // 打賞審核設定
                tipAuditSwitch: statusToggle.optional().describe('打賞審核開關（開啟後 app 端打賞需審核）'),
                tipAuditReleaseType: z.enum([ 'immediate', 'nextDay' ]).optional().describe('打賞審核通過後發放方式：immediate=立即、nextDay=次日'),

                // 打賞上限設置
                postsGiftReceiveTimes: z.number().int().min(0).optional().describe('可接受打賞提交次數上限'),
                postsGiftReceiveTotalAmount: z.number().int().min(0).optional().describe('可接受打賞總金額上限'),

                // 用戶打賞限制
                postsGiftSamePostsSenderReceiveTimes: z.number().int().min(0).optional().describe('同一貼文、同一打賞者可打賞次數上限'),

                // 稽核設定
                postsGiftNeedOverWageringToSendSwitch: statusToggle.optional().describe('打賞需滿足稽核流水開關'),
                postsGiftWageringMultiplier: z.number().int().min(0).optional().describe('打賞稽核倍率，後端實際儲存值＝顯示倍率 × 10000 的整數（例：1.5 倍傳 15000）'),

                // 發布動態限制
                postsTitleLengthLimit: z.number().int().min(0).max(250).optional().describe('標題長度限制（字元數，0~250）'),
                postsCommentLengthLimit: z.number().int().min(0).max(250).optional().describe('評論長度限制（字元數，0~250）'),
                postsThumbNumsLimit: z.number().int().min(0).optional().describe('圖片數量限制'),
                postsThumbSizeLimit: z.number().int().min(0).optional().describe('圖片尺寸限制'),
                postsVideoSecsLimit: z.number().int().min(0).optional().describe('影片秒數限制'),
                postsVideoSizeLimit: z.number().int().min(0).optional().describe('影片尺寸限制'),

                // 置頂/熱門配置
                autoHotSwitch: z.boolean().optional().describe('自動熱門總開關'),
                autoHotLikeThreshold: z.number().int().optional().describe('自動熱門－達多少讚數自動轉熱門'),
                autoHotEffectiveHours: z.number().int().optional().describe('自動熱門－有效期（小時）'),
                globalPinMode: z.enum([ 'off', 'permanent', 'timed' ]).optional().describe('全局置頂模式：off=關閉、permanent=永久、timed=限時'),
                pinEffectiveHours: z.number().int().optional().describe('全局置頂限時模式的有效期（小時），僅 globalPinMode="timed" 時生效'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            assertProdConfirmed(input.confirm);

            const getR = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.GetMessageBoardPostSetting());
            if (getR.failed) return asErrorResult(getR);

            const base = getR.data?.setting;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const overrides: Record<string, unknown> = {};
            if (input.postsUserAuthSwitch !== undefined) overrides.postsUserAuthSwitch = ACTIVE_STATUS_MAP[ input.postsUserAuthSwitch ];
            if (input.postsReviewSwitch !== undefined) overrides.postsReviewSwitch = ACTIVE_STATUS_MAP[ input.postsReviewSwitch ];
            if (input.postsCommentReviewSwitch !== undefined) overrides.postsCommentReviewSwitch = ACTIVE_STATUS_MAP[ input.postsCommentReviewSwitch ];
            if (input.postsLevel !== undefined) overrides.postsLevel = input.postsLevel;
            if (input.postsCommentLevel !== undefined) overrides.postsCommentLevel = input.postsCommentLevel;
            if (input.postsGiftSendLevel !== undefined) overrides.postsGiftSendLevel = input.postsGiftSendLevel;

            if (input.postsChangeUserDetailMinChargeTimes !== undefined) {
                overrides.postsChangeUserDetailMinChargeTimes = CHANGE_USER_DETAIL_CHARGE_TIMES_MAP[ input.postsChangeUserDetailMinChargeTimes ];
            }
            if (input.postsChangeUserDetailMinChargeTotal !== undefined) overrides.postsChangeUserDetailMinChargeTotal = input.postsChangeUserDetailMinChargeTotal;
            if (input.postsReviewChangeUserDetailSwitch !== undefined) {
                overrides.postsReviewChangeUserDetailSwitch = ACTIVE_STATUS_MAP[ input.postsReviewChangeUserDetailSwitch ];
            }

            if (input.postsGiftCondsLogic !== undefined) overrides.postsGiftCondsLogic = GIFT_CONDS_LOGIC_MAP[ input.postsGiftCondsLogic ];
            if (input.postsGiftCondsCrntDayCharge !== undefined) overrides.postsGiftCondsCrntDayCharge = input.postsGiftCondsCrntDayCharge;
            if (input.postsGiftCondsThreeDayCharge !== undefined) overrides.postsGiftCondsThreeDayCharge = input.postsGiftCondsThreeDayCharge;

            if (input.tipAuditSwitch !== undefined) overrides.tipAuditSwitch = ACTIVE_STATUS_MAP[ input.tipAuditSwitch ];
            if (input.tipAuditReleaseType !== undefined) overrides.tipAuditReleaseType = TIP_AUDIT_RELEASE_TYPE_MAP[ input.tipAuditReleaseType ];

            if (input.postsGiftReceiveTimes !== undefined) overrides.postsGiftReceiveTimes = input.postsGiftReceiveTimes;
            if (input.postsGiftReceiveTotalAmount !== undefined) overrides.postsGiftReceiveTotalAmount = input.postsGiftReceiveTotalAmount;

            if (input.postsGiftSamePostsSenderReceiveTimes !== undefined) {
                overrides.postsGiftSamePostsSenderReceiveTimes = input.postsGiftSamePostsSenderReceiveTimes;
            }

            if (input.postsGiftNeedOverWageringToSendSwitch !== undefined) {
                overrides.postsGiftNeedOverWageringToSendSwitch = ACTIVE_STATUS_MAP[ input.postsGiftNeedOverWageringToSendSwitch ];
            }
            if (input.postsGiftWageringMultiplier !== undefined) overrides.postsGiftWageringMultiplier = input.postsGiftWageringMultiplier;

            if (input.postsTitleLengthLimit !== undefined) overrides.postsTitleLengthLimit = input.postsTitleLengthLimit;
            if (input.postsCommentLengthLimit !== undefined) overrides.postsCommentLengthLimit = input.postsCommentLengthLimit;
            if (input.postsThumbNumsLimit !== undefined) overrides.postsThumbNumsLimit = input.postsThumbNumsLimit;
            if (input.postsThumbSizeLimit !== undefined) overrides.postsThumbSizeLimit = input.postsThumbSizeLimit;
            if (input.postsVideoSecsLimit !== undefined) overrides.postsVideoSecsLimit = input.postsVideoSecsLimit;
            if (input.postsVideoSizeLimit !== undefined) overrides.postsVideoSizeLimit = input.postsVideoSizeLimit;

            if (input.autoHotSwitch !== undefined) overrides.autoHotSwitch = input.autoHotSwitch;
            if (input.autoHotLikeThreshold !== undefined) overrides.autoHotLikeThreshold = input.autoHotLikeThreshold;
            if (input.autoHotEffectiveHours !== undefined) overrides.autoHotEffectiveHours = input.autoHotEffectiveHours;
            if (input.globalPinMode !== undefined) overrides.globalPinMode = GLOBAL_PIN_MODE_MAP[ input.globalPinMode ];
            if (input.pinEffectiveHours !== undefined) overrides.pinEffectiveHours = input.pinEffectiveHours;

            const merged = MessageBoardPostSetting.create({ ...base, ...overrides });

            const setR = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.SetMessageBoardPostSetting(merged));
            if (setR.failed) return asErrorResult(setR);

            const checkR = await withAutoRelogin(() => remote.messageBoardBackOffice.messageBoardPlatform.GetMessageBoardPostSetting());
            const checkSetting = checkR.failed ? undefined : checkR.data?.setting;
            return asTextResult({
                success: true,
                message: '大舞台基本設置已更新',
                setting: checkSetting ? formatMessageBoardSetting(checkSetting as unknown as Record<string, unknown>) : null,
            });
        },
    );
}
