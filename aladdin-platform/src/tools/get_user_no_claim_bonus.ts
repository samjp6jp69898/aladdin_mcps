/**
 * tools/get_user_no_claim_bonus.ts — aladdin_platform_fund_adjustment_platform_get_user_no_claim_bonus
 *
 * rajah: FundAdjustmentPlatform.GetUserNoClaimBonus(id i32 1) (noClaimBonus bool 1)
 * （fund_adjustment_back_office.rajah:513；service FundAdjustmentPlatform 定義於同檔 471 行、
 * @Module "FundAdjustment"（469）、service 級 @Permission "Finance.FundAdjustment"（470），
 * 這支 method 另掛 @Permission "Finance.FundAdjustment.List.Ops.Edit"（512）。
 * 非 @NoPublic、非 Placeholder、無 @Totp。rajah 註解原文：「取得資金調整單該會員是否被
 * 『禁止領取優惠彩金』」，對應審核彈窗開啟時的前置檢查。）
 *
 * agrabah 對應實作：fund_adjustment_platform.ts:723-730 methodGetUserNoClaimBonus →
 * FundAdjustmentManager.getAdjustmentUserNoClaimBonus（fund_adjustment_manager.ts:379-386）→
 * isMemberNoClaimBonus（同檔 :518-528）。確認有真實 override，不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 1 節「讀取單筆（by id）」的變形——回傳的是單一 bool
 * 而非 model，但定位方式與檢查要求相同。該節要求的處理如下：
 * - 「id 不存在的實際行為必須實測」：見 dev 驗證第 2 點。
 * - 「跨租戶風險」：getUserFundAdjustmentDetail(context, id, context.platformId)
 *   （fund_adjustment_manager.ts:380）的 platformId 取自登入態不是參數，結構性擋住跨平台讀取。
 * - 「Get 前綴不保證唯讀」：已逐行讀過三層實作，全程只有 DB 查詢與跨服務讀取 RPC
 *   （GetAppUserPrivilegesByPlatformId），**沒有任何寫入**，是真的唯讀。
 *
 * ⚠️ **注意這支查的是「會員身上的旗標」，不是「這張單被拒絕了沒」**：
 * 名稱容易被誤讀成「這張調整單有沒有被禁止領取」。實際上它是：用這張單找到會員與調整類型，
 * 再去問「這名會員的帳號特權清單裡有沒有 noClaimBonus（禁止領取優惠彩金）」。
 * 同一名會員的所有彩金類調整單，這支都會回同一個答案。
 *
 * agrabah 實作細節（讀源碼查證，非推測；行號對 agrabah main 於 2026-08-28 的內容）：
 *
 * - **⚠️ 非彩金類的調整單一律直接回 false，不代表「這名會員沒有被禁止」**：
 *   isMemberNoClaimBonus 第一件事就是
 *   `if (!isBonusRelatedManualAddCategory(category)) return ServiceResult.fromData(false)`
 *   （fund_adjustment_manager.ts:519-521）——**連查都不查會員的特權旗標就回 false**。
 *   所以拿一張「手動上分-充值」的單子來問，得到的 false 只代表「這個類型不受該限制」，
 *   完全不代表這名會員沒有 noClaimBonus 旗標。要判斷會員本身的旗標，必須挑一張彩金類的單子問。
 *
 * - **「彩金相關手動上分類型」是明確的六個值**（BONUS_RELATED_MANUAL_ADD_CATEGORY_SET，
 *   fund_adjustment_manager.ts:91-98）：manualAddPaymentDepositDiscount（手動上分-充值優惠）、
 *   manualAddPaymentWithdrawDiscount（手動上分-提現優惠）、manualAddActivityGift（手動上分-活動彩金）、
 *   manualAddPromotionBonus（手動上分-優惠活動）、manualAddInviteFriends（手動上分-邀請好友）、
 *   manualAddVipBonus（手動上分-VIP彩金）。
 *   ⚠️ 這個集合**比 rajah 的 ManualBonusCategoryEnum（rajah:126-131，只有 manualAddActivityGift
 *   與 manualAddVipBonus 兩個）大**——真正決定行為的是 agrabah 這個六元素集合，不是那個 enum。
 *   所有下分（manualDeduct*）類型都不在集合內，一律回 false。
 *
 * - **旗標來源是會員的「帳號特權」清單**：
 *   `GetAppUserPrivilegesByPlatformId(userId, platformId)` 回傳的 privileges 陣列裡有沒有
 *   AppUserCharacterPrivilegesEnum.noClaimBonus（fund_adjustment_manager.ts:522-527）。
 *   該 RPC 失敗時**整支回錯誤**（:523-526，先寫 error log 再 errorTo），不會靜默降級成 false。
 *
 * - **這個旗標會真的擋住審核**：同 manager 的 ensureReviewAllowed（:391-400）在審核前呼叫
 *   同一支檢查，為 true 時回 AgrabahErrorCodeEnum.fundAdjustmentReviewNoClaimBonus 直接擋下
 *   整筆審核。所以這支 tool 的用途是「審核前先問清楚會不會被擋」，回 true 就別去按審核。
 *   （本 MCP 沒有提供審核 tool——AdjustmentReview 因為是不可逆金流 + @Totp 已標記為
 *   needs_clarification，未實作。）
 *
 * - **調整單不存在時回錯誤**：getUserFundAdjustmentDetail 查不到會回
 *   ErrorCode.idNotExists（fund_adjustment_manager.ts:952 區段），不是回 false。
 *   本 tool 原樣呈現 errorCode，不把它歸納成 false。
 *
 * - PII（第 8 節）：回傳只有一個 bool，**不含任何個資欄位**。
 *
 * - **id 的 i32 邊界**：rajah 是 `id i32 1`（rajah:513）。超過 2147483647 會被 protobuf 無聲
 *   截斷成另一個合法 id，於是會回答**別張調整單／別名會員**的結果。本 tool 用 const.ts 的
 *   I32_MAX 擋下（同 server 慣例，見 create_or_update_room_mute.ts:155）。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool，不是繞過 tool 直接打 RPC）---
 * 1. **非彩金類單（id=1440，categoryKey=manualAddPaymentDeposit）**：success、noClaimBonus=false，
 *    本 tool 依 categoryKeyForContext 判定 categoryIsBonusRelated=**false** 並在 interpretation
 *    明講「後端根本沒有去查會員旗標，不可據此判斷該會員沒有 noClaimBonus」——正是檔頭警告的情境。
 * 2. **不帶 categoryKeyForContext**：同一張單回 noClaimBonus=false、categoryIsBonusRelated=**null**、
 *    interpretation 明講「無法分辨這個 false 是類型不受限還是會員真的沒有旗標」，
 *    確認選填參數缺席時不會給出過度自信的結論。
 * 3. **彩金類單（id=1424，categoryKey=manualAddActivityGift，屬於受限六類之一）**：
 *    success、noClaimBonus=false、categoryIsBonusRelated=**true**，interpretation 為
 *    「後端有實際查過會員旗標，false 代表該會員確實沒有此限制」。與第 1 點形成對照組，
 *    證實同樣是 false、語意完全不同。
 *    （該平台 dev 資料上目前找不到 noClaimBonus=true 的會員，故 true 分支未能實測到，
 *    這點如實記錄、不宣稱已驗證。）
 * 4. **id 不存在**：id=99999999 → success=false、errorCode=11（genie 基礎層 ErrorCode.idNotExists，
 *    genie/src/common/error_code.ts:13；非 AgrabahErrorCodeEnum，故 errorName 顯示「(未知錯誤碼)」）。
 *    確認查無此單是回錯誤而不是回 false。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { I32_MAX, MANUAL_CATEGORY_KEYS } from '../const.ts';

/**
 * 受「禁止領取優惠彩金」限制的手動上分類型（agrabah
 * fund_adjustment_manager.ts:91-98 的 BONUS_RELATED_MANUAL_ADD_CATEGORY_SET）。
 * 只有本 tool 用得到，故留在檔案內、不放 const.ts。列在這裡是為了讓回傳能明確告訴呼叫端
 * 「false 是因為類型不受限，還是因為會員真的沒有旗標」。
 */
const BONUS_RELATED_CATEGORY_KEYS = [
    'manualAddPaymentDepositDiscount',
    'manualAddPaymentWithdrawDiscount',
    'manualAddActivityGift',
    'manualAddPromotionBonus',
    'manualAddInviteFriends',
    'manualAddVipBonus',
] as const;

export function registerGetUserNoClaimBonusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fund_adjustment_platform_get_user_no_claim_bonus',
        {
            title: 'Check whether the member on a fund adjustment order is barred from claiming bonuses',
            description:
                '用一張資金調整單的 id，查「這張單的會員是否被標記為禁止領取優惠彩金（noClaimBonus）」' +
                '（rajah: FundAdjustmentPlatform.GetUserNoClaimBonus），對應後台審核彈窗開啟時的前置檢查。' +
                '回 true 代表這名會員有該限制，這張彩金類的上分單在審核時會被後端直接擋下' +
                '（錯誤碼 fundAdjustmentReviewNoClaimBonus）。' +
                '⚠️ **查的是「會員身上的旗標」，不是「這張單被拒絕了沒」**：它是用這張單找到會員與調整類型後，' +
                '去問該會員的帳號特權清單有沒有 noClaimBonus。同一名會員的所有彩金類單子答案都一樣。' +
                '⚠️ **最容易誤判的地方：非彩金類的調整單一律直接回 false，而且後端「連查都不查」會員旗標**。' +
                '受此限制的只有六種手動上分類型：manualAddPaymentDepositDiscount（充值優惠）、' +
                'manualAddPaymentWithdrawDiscount（提現優惠）、manualAddActivityGift（活動彩金）、' +
                'manualAddPromotionBonus（優惠活動）、manualAddInviteFriends（邀請好友）、' +
                'manualAddVipBonus（VIP彩金）。' +
                '拿其他類型（例如「手動上分-充值」或任何下分單）來問，得到的 false 只代表「這個類型不受此限制」，' +
                '**完全不代表這名會員沒有被禁止領取彩金**。要判斷會員本身的旗標，請挑一張上述六種類型的單子問。' +
                '本 tool 會在回傳中附上 categoryIsBonusRelated 提示這次的答案屬於哪一種情況——' +
                '但這個判斷需要你另外提供該單的 category（見 categoryKeyForContext 參數說明）。' +
                '調整單 id 不存在時回錯誤（不是回 false），錯誤碼原樣呈現。' +
                'id 請用 aladdin_platform_fund_adjustment_platform_list_user_fund_adjustment 查出，' +
                '該 tool 的回傳同時會給你 categoryKey。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。回傳只有一個布林值，不含任何個資。',
            inputSchema: {
                id: z
                    .number()
                    .int()
                    .min(1)
                    .max(I32_MAX)
                    .describe(
                        '資金調整單 id（rajah 型別 i32），來自 ' +
                        'aladdin_platform_fund_adjustment_platform_list_user_fund_adjustment 回傳的 id 欄位。' +
                        `⚠️ 必須落在 i32 範圍（1 ~ ${ I32_MAX }）：超過會被 protobuf 無聲截斷成另一個合法 id，` +
                        '結果會若無其事地回答別張單／別名會員的狀況，故本 tool 直接擋下。',
                    ),
                categoryKeyForContext: z
                    .enum(MANUAL_CATEGORY_KEYS)
                    .optional()
                    .describe(
                        '選填，且**不會送給後端**：把該單的 categoryKey（例如 "manualAddActivityGift"，' +
                        '可從 list_user_fund_adjustment 或 get_user_fund_adjustment_review_info 取得）帶進來，' +
                        '本 tool 就能在回傳裡直接告訴你「這次的 false 是因為類型不受限，還是會員真的沒有旗標」。' +
                        '不帶的話回傳的 categoryIsBonusRelated 會是 null（無法判斷）。'
                        + '⚠️ 這裡用的是封閉選項（ManualCategoryEnum 的字串代碼），'
                        + '打錯字會被直接擋下——刻意如此：若容許自由字串，typo 會讓本 tool 誤判成'
                        + '「類型不受限」並給出一個有自信但錯誤的結論，比不填更糟。',
                    ),
            },
        },
        async ({ id, categoryKeyForContext }) => {
            const r = await withAutoRelogin(() =>
                remote.fundAdjustmentBackOffice.fundAdjustmentPlatform.GetUserNoClaimBonus(id),
            );
            if (r.failed) return asErrorResult(r);

            const noClaimBonus = r.data?.noClaimBonus ?? false;
            const categoryIsBonusRelated = categoryKeyForContext
                ? (BONUS_RELATED_CATEGORY_KEYS as readonly string[]).includes(categoryKeyForContext)
                : null;

            return asTextResult({
                success: true,
                requestedId: id,
                noClaimBonus,
                categoryKeyForContext: categoryKeyForContext ?? null,
                categoryIsBonusRelated,
                interpretation:
                    noClaimBonus
                        ? '這名會員被標記為禁止領取優惠彩金；這張彩金類上分單在審核時會被後端擋下。'
                        : categoryIsBonusRelated === false
                            ? 'false 是因為這張單的 category 不屬於受限的六種彩金類上分，後端根本沒有去查會員旗標——'
                              + '不可據此判斷該會員沒有 noClaimBonus。'
                            : categoryIsBonusRelated === true
                                ? '這張單屬於受限的彩金類上分，後端有實際查過會員旗標，false 代表該會員確實沒有此限制。'
                                : '未提供 categoryKeyForContext，無法分辨這個 false 是「類型不受限」還是「會員真的沒有旗標」。',
                bonusRelatedCategoryKeys: BONUS_RELATED_CATEGORY_KEYS,
            });
        },
    );
}
