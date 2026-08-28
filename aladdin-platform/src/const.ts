/**
 * const.ts — 所有 tool 共用的 rajah enum 對照表與錯誤碼，集中管理避免各 tool 檔案各自重複一份。
 * 帳號/URL 等環境相關設定不放這裡，一律走 process.env（見 session.ts），不寫死 fallback。
 */

// H11（plan.md D10）：不在此硬編 error code 數字，改由 session.ts / http.ts / mcp_result.ts /
// onboard_vendor_game.ts 直接 import 生成的 AgrabahErrorCodeEnum
// （abu/platform/src/generated/remote.gen.ts）並用 forward mapping（如
// AgrabahErrorCodeEnum.loginRequired）或 reverse mapping 取代裸數字。

// ActiveStatusEnum（common.rajah:1073-1076）
export const ACTIVE_STATUS_MAP = { enabled: 1, disabled: 2 } as const;

// StatusEnum（common.rajah:1072-1080）；unknown=0 保留給呼叫端明確表達「設為未知狀態」這個
// 合法列舉值；last=255 是內部 sentinel（非列舉語意上界），不收錄進可選值。
// 2026-08-25 dev 實測（update_game_vendor_status.ts round-trip 測試）確認 enabled/disabled
// 的數值與此處一致（分別讀回 1/2）。
export const STATUS_KEYS = [ 'unknown', 'enabled', 'disabled', 'frozen', 'deleted' ] as const;
export const STATUS_MAP: Record<(typeof STATUS_KEYS)[number], number> = {
    unknown: 0,
    enabled: 1,
    disabled: 2,
    frozen: 3,
    deleted: 10,
};

// GameImageShapeEnum（game_back_office.rajah:266-272）；PlatformUploadGameImageEnum.game=1（game_back_office.rajah:627-633）
export const IMAGE_SHAPE_MAP = { square: 1, rectangle: 2, banner: 3 } as const;
export const UPLOAD_TYPE_GAME = 1;
// PlatformUploadGameImageEnum.vendor=4（game_back_office.rajah:644），供 UpdateGameVendor 的廠商方形圖上傳使用
export const UPLOAD_TYPE_VENDOR = 4;

// GameLocalizationTargetEnum（rajah/services/game.rajah:40-47，用於 GameVendorPlatform.GetLocalizations）
export const GAME_LOCALIZATION_TARGET_MAP = { gameName: 101, gameVendorName: 131, gameBrandTitle: 141 } as const;

// CustomerCategoryEnum（rajah/services/customer_back_office.rajah:250-258），客服連線類型（三方客服系統）
export const CUSTOMER_CATEGORY_MAP = { komi: 1, wbgcorp: 2, dotcloud: 3 } as const;

// CustomerConfigJumpEnum（common.rajah:1591-1596）
export const CUSTOMER_CONFIG_JUMP_MAP = { external: 0, internal: 1 } as const;

// CustomerTicketStatusEnum（customer_back_office.rajah:457-468）
export const CUSTOMER_TICKET_STATUS_MAP = { pending: 0, enabled: 1, disabled: 2, inReview: 3, processing: 4 } as const;
// CustomerIssueEnum（customer_back_office.rajah:446-455）
export const CUSTOMER_ISSUE_MAP = { player: 0, deposit: 1, withdraw: 2, other: 3 } as const;
// CustomerFromTypeEnum（customer_back_office.rajah:470-476）
export const CUSTOMER_FROM_TYPE_MAP = { aladdin: 0, komi: 1 } as const;
// CustomerDepartmentEnum（customer_back_office.rajah:996-1005）
export const CUSTOMER_DEPARTMENT_MAP = { ai: 1, risk: 2, finance: 3, manual: 5 } as const;
// CaptchaTypeEnum（verification_code_common.rajah:7-12）——AdminCaptchaConfig（aladdin-admin）/
// PlatformCaptchaConfig（本 server）共用同一組值。
export const CAPTCHA_TYPE_MAP = { off: 0, numeral: 1, arithmetic: 2, geetest: 3 } as const;

// InformationTypeEnum（rajah/services/information.rajah:2-13）——information_back_office domain
// 底下 CommonInfoPlatform（查詢跨全部類型）與各 type 專屬 service（UrgentInfoPlatform 等）的
// CreateConfig/UpdateConfig 都會用到同一組值，集中在此避免各 tool 各自重複宣告。
export const INFORMATION_TYPE_MAP = {
    urgent: 1,
    announcement: 2,
    news: 3,
    mustRead: 4,
    systemNotification: 5,
    inSiteMail: 6,
    recurringAward: 7,
    liveNotification: 8,
    notification: 9,
    marquee: 10,
    agentAnnouncement: 11,
} as const;

// H7：hosted 模式下 JWT 過期或尚未登入時回給 agent 的重登信號文字（plan.md D4/D11）。
// D11 要求 harness 只陳述事實、不引導跨後台操作，措辭止於此，不建議改用其他帳號或後台。
// stdio 模式不會用到這個常數——stdio 用 env 帳密自動重登，不會走到需要對外顯示訊號的分支。
export const HOSTED_RELOGIN_REQUIRED_MESSAGE = '登入態已失效，請重新登入後重試';

// 大舞台基本設置（GetMessageBoardPostSetting / SetMessageBoardPostSetting，
// message_board_back_office.rajah:1552-1564）用到的 enum 對照表，get/update 兩支
// tool 共用，集中在此避免各自重複一份。
//
// StatusEnum（common.rajah:1062-1069）的 enabled=1/disabled=2 兩態與上面
// ActiveStatusEnum 數值相同，大舞台設置多個開關類欄位（postsUserAuthSwitch 等）
// 底層型別是 StatusEnum，直接重用 ACTIVE_STATUS_MAP，不另外宣告一份數值相同的 map。

// PostsGiftCondsLogicEnum（message_board_back_office.rajah:345-350）
export const GIFT_CONDS_LOGIC_MAP = { all: 1, any: 2 } as const;

// TipAuditReleaseTypeEnum（message_board_back_office.rajah:959-966）
export const TIP_AUDIT_RELEASE_TYPE_MAP = { immediate: 1, nextDay: 2 } as const;

// GlobalPinModeEnum（message_board_back_office.rajah:364-371）
export const GLOBAL_PIN_MODE_MAP = { off: 1, permanent: 2, timed: 3 } as const;

// PostsChangeUserDetailChargeTimesEnum（message_board_back_office.rajah:336-343）
export const CHANGE_USER_DETAIL_CHARGE_TIMES_MAP = { noNeed: 0, minChargeTimesOne: 1, minChargeTimesTwo: 2 } as const;

// ItemCategoryEnum（inventory_common.rajah:225-246），用於 InventoryPlatform.CreateOrUpdateItem/ListItems。
// unknown（0）與 realStuff（9）刻意不列入這裡：後端 ItemDetailLogicClasses（agrabah
// servers/inventory_back_office/logics/index.ts:18-28）都沒有對應的 logic class，
// 呼叫 CreateOrUpdateItem 帶這兩個值一定回 invalidItemCategory，結構性不可用。
// roomMount（4）同樣刻意不列入：後端 RoomMount.validateOtherDetail()（agrabah
// logics/item_common_detail.ts:75-91）與 ItemDetailBase.validate()（item_detail_base.ts:99-105）
// 互相呼叫形成同步無窮遞迴，帶這個 category 呼叫必定 stack overflow（2026-08-25 fable5
// reviewer-b 發現、複驗證實的後端既有 bug，非本工具限制）。
// 見 create_or_update_item.ts 檔頭註解。
export const ITEM_CATEGORY_MAP = {
    roomGift: 1,
    messageBoardGift: 2,
    roomGuardGift: 3,
    roomGuard: 5,
    rename: 6,
    broadcast: 7,
    depositAndWithdrawCoupon: 8,
    lotteryTicket: 10,
} as const;

// PaymentTypeEnum（common.rajah:2197-2202），ItemDepositWithdrawDetail.paymentType 用。
export const PAYMENT_TYPE_MAP = { deposit: 1, withdraw: 2 } as const;

// DiscountModeEnum（inventory_common.rajah:121-126），ItemDepositWithdrawDetail.discountMode 用。
export const DISCOUNT_MODE_MAP = { bonus: 1, percent: 2 } as const;
// RiskLimitItemEnum（risk_back_office.rajah:92-97），限制遊戲 IP/地區功能的「黑名單/白名單」，
// 供 aladdin_platform_risk_platform_ip_region_get_ip_region_list（search）與
// aladdin_platform_risk_platform_ip_region_create_or_update_ip_region 共用。
export const RISK_LIMIT_ITEM_MAP = { gameBlack: 1, gameWhite: 2 } as const;

// RiskLimitMethodEnum（risk_back_office.rajah:100-105），限制方式是 IP 還是國家代碼。
export const RISK_LIMIT_METHOD_MAP = { ip: 1, countryCode: 2 } as const;

// RiskGameTypeEnum（risk_back_office.rajah:108-113），限制作用範圍是廠商還是指定遊戲。
export const RISK_GAME_TYPE_MAP = { provider: 1, specified: 2 } as const;

// PageSizeEnum（common.rajah:2442-2450）——固定選項，非任意 i32；serverDefault=0 由後端轉成
// DefaultPageSize=100。供任何吃 @Validate pageSize PageSizeEnum 參數的 list method 共用。
export const PAGE_SIZE_KEYS = [ 'serverDefault', 'size10', 'size20', 'size30', 'size50', 'size100', 'size200' ] as const;
export const PAGE_SIZE_MAP: Record<(typeof PAGE_SIZE_KEYS)[number], number> = {
    serverDefault: 0,
    size10: 10,
    size20: 20,
    size30: 30,
    size50: 50,
    size100: 100,
    size200: 200,
};
// WalletPlatform 系列 tool 共用（get_show_category/update_show_category/
// list_classification_categories/create_or_update_classification/
// get_categories_by_classification/list_user_transactions）：TransactionCategoryEnum
// 有 100+ 值（wallet_back_office.rajah），不手動謄寫一份對照表（容易漂移），
// 直接從已生成的 remote.gen.ts 匯入真正的 TS enum，用 Object.keys 動態推導出
// 字串 key 清單給 zod z.enum() 用（agent 傳字串 key，如 "paymentDeposit"，不傳數字碼），
// forward/reverse mapping 都用該 enum 物件本身的內建能力（TS 數字 enum 自動有雙向映射）。
import { TransactionCategoryEnum, TransactionStatusEnum, AgentModeForSearchAgentMemberEnum, AgentModeEnum, SystemIdEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';

export { TransactionCategoryEnum };

// SystemIdEnum（rajah/services/service_common.rajah:3，43 個值），get_audit_logs.ts 用；同款動態推導模式。
export const SYSTEM_ID_KEYS = Object.keys(SystemIdEnum).filter(
    (k) => Number.isNaN(Number(k)),
) as [ string, ...string[] ];
export function systemIdKeyToNumber(key: string): number {
    return (SystemIdEnum as unknown as Record<string, number>)[ key ];
}
export function systemIdNumberToKey(value: number): string | number {
    return (SystemIdEnum as unknown as Record<number, string>)[ value ] ?? value;
}

/** TransactionCategoryEnum 的字串 key 清單（過濾掉數字 enum 反向映射多出來的純數字 key）。 */
export const TRANSACTION_CATEGORY_KEYS = Object.keys(TransactionCategoryEnum).filter(
    (k) => Number.isNaN(Number(k)),
) as [ string, ...string[] ];

export function transactionCategoryKeyToNumber(key: string): number {
    return (TransactionCategoryEnum as unknown as Record<string, number>)[ key ];
}
/** 數字 → key 字串；查不到（未知碼）時原樣回傳數字，不讓 undefined 流入回應文案。 */
export function transactionCategoryNumberToKey(value: number): string | number {
    return (TransactionCategoryEnum as unknown as Record<number, string>)[ value ] ?? value;
}

// TransactionStatusEnum（wallet_back_office.rajah，pending/success/failed/unknown=100）
export const TRANSACTION_STATUS_KEYS = Object.keys(TransactionStatusEnum).filter(
    (k) => Number.isNaN(Number(k)),
) as [ string, ...string[] ];
export function transactionStatusKeyToNumber(key: string): number {
    return (TransactionStatusEnum as unknown as Record<string, number>)[ key ];
}
export function transactionStatusNumberToKey(value: number): string | number {
    return (TransactionStatusEnum as unknown as Record<number, string>)[ value ] ?? value;
}

// AgentModeForSearchAgentMemberEnum（搜尋專用：none=不篩選/generalAgent/ventureAgent/noAgent）
export const AGENT_MODE_FOR_SEARCH_KEYS = Object.keys(AgentModeForSearchAgentMemberEnum).filter(
    (k) => Number.isNaN(Number(k)),
) as [ string, ...string[] ];
export function agentModeForSearchKeyToNumber(key: string): number {
    return (AgentModeForSearchAgentMemberEnum as unknown as Record<string, number>)[ key ];
}

// AgentModeEnum（UserTransaction.agentMode 回傳欄位用：all/none/generalAgent/ventureAgent）
export function agentModeNumberToKey(value: number): string | number {
    return (AgentModeEnum as unknown as Record<number, string>)[ value ] ?? value;
}
// OtpCodeSettingPlatform.GetSmsSettings/UpdateSmsSettings（otp_code_back_office.rajah:132-137）用到的 enum 對照表。
// OtpSmsSettings 的 4 個 xxxStatus 開關欄位底層是 StatusEnum，數值與上面 ACTIVE_STATUS_MAP 相同，直接重用。

// OtpCodeLimitConditionEnum（otp_code.rajah:189-194）
export const OTP_LIMIT_CONDITION_MAP = { ip: 1, phone: 2 } as const;

// RegistrationLimitPeriodTypeEnum（common.rajah:2185-2192）
export const OTP_LIMIT_PERIOD_MAP = { day: 1, week: 2, permanent: 3 } as const;

// Constants.OtpCodeMinExpirySeconds/MaxExpirySeconds（otp_code.rajah:305-306）。
// 2026-08-25 讀 otp_sms_setting_manager.ts:118-124/148-150 查證：validate() 的錯誤
// 訊息文字有引用這兩個常數（"must be between ... and ..."），但實際判斷式
// isValidExpirySeconds() 只檢查 `expirySeconds > 0`，完全沒用到這兩個常數——後端
// 目前並未真的強制 60~600 這個邊界（疑似後端既有 bug：訊息與檢查邏輯不一致）。
// 這裡沿用 rajah 常數值，是 update_otp_sms_settings.ts 工具層自主收緊的保守預設，
// 不是在轉述後端已強制的行為，詳見該檔案檔頭註解。
export const OTP_CODE_MIN_EXPIRY_SECONDS = 60;
export const OTP_CODE_MAX_EXPIRY_SECONDS = 600;

/**
 * i64 欄位（如 MessageBoardPostSetting 的 postsChangeUserDetailMinChargeTotal/
 * postsGiftReceiveTotalAmount）經 protobufjs decode 後是 Long 物件
 * （{low,high,unsigned} + toNumber()，genie/src/common/index.ts 的
 * fixObjectInteger 就是處理同一件事，但 genie/client 目前沒有自動套用，見該檔案
 * 註解），直接 JSON.stringify 會印出難以閱讀、且依呼叫路徑不同而不一致的形狀
 * （物件或十進位字串）。2026-08-25 起已有多組 i64 欄位使用這支：大舞台基本設置的
 * postsChangeUserDetailMinChargeTotal/postsGiftReceiveTotalAmount；聊天室發言設定的
 * rechargeAmount；list_rooms.ts 的 roomCreatedAt/moduleResult.chat.chatRoomId；
 * get_room_announcements.ts 的 createdAtTimestamp；list_user_transactions.ts 的
 * UserTransaction.amount/beforeBalance/afterBalance/createdAtTimestamp/registerTimestamp
 * ——連伺服器端來源本身是一般 JS number 的欄位，client 解碼後仍可能是 Long/字串，不能只看
 * 伺服器端型別就跳過轉換，實測數值都在 52 bit 安全整數範圍內，維持最小作法即可，之後若出現
 * 更多組再考慮要不要抽更通用的版本。
 */
// TimeLimitTypeEnum（common.rajah:1597-1606），供 PointPlatform.GetPointSetting/UpdatePointSetting 的
// dueType 使用。unknown=0 不收錄——後端驗證只接受 absoluteTime（需 dueAtTimestamp）或 relativeTime（需 dueDay）。
export const TIME_LIMIT_TYPE_KEYS = [ 'unlimitedTime', 'absoluteTime', 'relativeTime' ] as const;
export const TIME_LIMIT_TYPE_MAP: Record<(typeof TIME_LIMIT_TYPE_KEYS)[number], number> = {
    unlimitedTime: 1, absoluteTime: 2, relativeTime: 3,
};

// GameDisplayTagEnum（game.rajah:2-18），供 PointPlatform.UpdateVipPointSetting 的
// displayTagPointRebates[].displayTag 使用。unknown=0 不收錄——GetVipPointSetting 固定回傳
// 全部非 unknown 分類各一筆，寫入時同樣以此為準。
export const GAME_DISPLAY_TAG_KEYS = [ 'slot', 'board', 'fish', 'live', 'sport', 'eSport', 'lottery' ] as const;
export const GAME_DISPLAY_TAG_MAP: Record<(typeof GAME_DISPLAY_TAG_KEYS)[number], number> = {
    slot: 1, board: 2, fish: 3, live: 4, sport: 5, eSport: 6, lottery: 7,
};

// MessageBoardTypeEnum（message_board_back_office.rajah:38-49），大舞台動態文章型態；all=3 是
// GetMessageBoardPosts 查詢用的「不篩選」值，非文章本身合法型態。GetMessageBoardPosts search.type
// 與 MessageBoardPost.type 回傳共用；ReviewPost/BatchReviewPosts 等狀態轉換類 tool 共用下方 STATUS_MAP。
export const MESSAGE_BOARD_TYPE_MAP = { text: 0, image: 1, video: 2, all: 3 } as const;

// MessageBoardStatusEnum（message_board_back_office.rajah:67-85），大舞台動態審核狀態；all=8 是
// 列表查詢專用的「不篩選」值。GetMessageBoardPosts/ReviewPost/BatchReviewPosts/DelistPost/RelistPost/
// CancelPost 等共用。
export const MESSAGE_BOARD_STATUS_MAP = {
    pending: 0, approved: 1, rejected: 2, delisted: 3,
    removePending: 4, removeApproved: 5, removeRejected: 6, removeDelisted: 7, all: 8,
} as const;

// MessageBoardCommentStatusEnum（message_board_back_office.rajah:88-101）
export const MESSAGE_BOARD_COMMENT_STATUS_MAP = {
    pending: 0, approved: 1, removedPending: 2, removedApproved: 3, all: 4, rejected: 5,
} as const;

// MessageBoardReceiveGiftEnum（message_board_back_office.rajah:60-65）；0（未設定）在後端語意是
// 「不篩選」（GetMessageBoardPosts 用 `if (options.receiveGiftStatus)` 做 truthy 判斷），故不收錄 all。
export const MESSAGE_BOARD_RECEIVE_GIFT_MAP = { enabled: 1, disabled: 2 } as const;

// MessageBoardPinFilterEnum（message_board_back_office.rajah:374-381）
export const MESSAGE_BOARD_PIN_FILTER_MAP = { all: 0, pinned: 1, notPinned: 2 } as const;

// MessageBoardHotFilterEnum（message_board_back_office.rajah:384-391）
export const MESSAGE_BOARD_HOT_FILTER_MAP = { all: 0, hot: 1, notHot: 2 } as const;

// OfficialPostStatusEnum（message_board_back_office.rajah:52-57）
export const OFFICIAL_POST_STATUS_MAP = { show: 1, hide: 2 } as const;

// UserTypeEnum（message_board_common.rajah:1-8），大舞台評論/動態的 userType/toUserType 欄位共用。
export const MESSAGE_BOARD_USER_TYPE_MAP = { unknown: 0, player: 1, platform: 2 } as const;

// MessageBoardGiftRecordStatusEnum（message_board_back_office.rajah:923-940），送禮紀錄回傳的
// status 欄位共用；無 all 值（回傳值不需要「不篩選」語意）。
export const MESSAGE_BOARD_GIFT_RECORD_STATUS_MAP = {
    unknown: 0, addProducts: 1, unexpectedError: 2, deductProductsFailed: 3, deductProductsRetryFailed: 4,
    addToReceiverFailed: 5, addToReceiverRetryFailed: 6, updateRecordFailed: 7, updateRecordRetryFailed: 8,
    addToReceiver: 9, pendingReview: 10, approvedReviewPendingRelease: 11, reviewRejected: 12,
    reviewRejectRefundFailed: 13, reviewRejectRefundRetryFailed: 14, reviewRejectRefunded: 15,
} as const;

// MessageBoardGiftRecordStatusClientEnum（message_board_back_office.rajah:886-920）——GetPostGiftRecords
// 查詢用的版本，數值與上面 STATUS_MAP 完全相同，額外多一個 all=999（「不篩選」語意，@Rules "Required"
// 故本工具省略時固定送 all）。
export const MESSAGE_BOARD_GIFT_RECORD_STATUS_CLIENT_MAP = {
    ...MESSAGE_BOARD_GIFT_RECORD_STATUS_MAP,
    all: 999,
} as const;

/** 通用「數字值 → map key 字串」反查，查不到時原樣回傳數字，不讓 undefined 流入回應文案。 */
export function numberToMapKey<T extends Record<string, number>>(map: T, value: number): string | number {
    return Object.entries(map).find(([ , v ]) => v === value)?.[ 0 ] ?? value;
}

// LoginDeviceEnum（common.rajah:2323-2330）；all=99 是搜尋用「不篩選」語意，不收錄成可選值。
export const LOGIN_DEVICE_MAP = { unknown: 0, ios: 1, android: 2, pc: 3, mac: 4 } as const;

/**
 * 數字 → 對照表 key 的字串；查不到已知 key 時原樣回傳數字，不讓未知值消失。
 * 2026-08-26 review 發現這支函式在 get_registration_ip_quota_config.ts/get_customer_tickets.ts/
 * list_customer_category_details.ts/get_otp_sms_settings.ts/get_customer_config_restrict.ts/
 * get_message_board_setting.ts 各自重複宣告過一份（逐字相同），抽到這裡供新檔案共用，避免繼續增加
 * 重複份數；既有檔案各自的本地定義維持原樣未動（surgical scope，非本次任務範圍）。
 */
export function describeEnum<T extends Record<string, number>>(map: T, value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(map).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

// PlatformStatisticTypeEnum（service_common.rajah:2281-2327），供
// aladdin_platform_statistic_platform_get_today_platform_statistic /
// get_yesterday_platform_statistic 共用（兩支都吃同一個 type 參數，集中一份避免各自重複）。
// platformProfitRate（20）刻意收錄但工具描述需另外提醒：後端 hourly_platform_statistics 表
// 從未寫入這個 type（agrabah statistic_platform.ts 註解「後端不產生此統計值，由前端即時計算」），
// 帶這個值查詢會回 24 筆補 0 的假資料，不是「今日沒有波動」的真實統計。
export const PLATFORM_STATISTIC_TYPE_KEYS = [
    'betAmount', 'betCount', 'payoutAmount', 'winLoseAmount', 'newUserCount', 'depositAmount',
    'withdrawAmount', 'paymentDifference', 'depositFee', 'withdrawFee', 'onlineUsers', 'onlineMembers',
    'maxOnlineUsers', 'maxOnlineMembers', 'validBetAmount', 'enterMembers', 'registerMembers',
    'centralWalletBalance', 'thirdPartyWalletBalance', 'platformProfitRate', 'newRegisteredUsers', 'betUserCount',
] as const;
export const PLATFORM_STATISTIC_TYPE_MAP: Record<(typeof PLATFORM_STATISTIC_TYPE_KEYS)[number], number> = {
    betAmount: 1, betCount: 2, payoutAmount: 3, winLoseAmount: 4, newUserCount: 5, depositAmount: 6,
    withdrawAmount: 7, paymentDifference: 8, depositFee: 9, withdrawFee: 10, onlineUsers: 11, onlineMembers: 12,
    maxOnlineUsers: 13, maxOnlineMembers: 14, validBetAmount: 15, enterMembers: 16, registerMembers: 17,
    centralWalletBalance: 18, thirdPartyWalletBalance: 19, platformProfitRate: 20, newRegisteredUsers: 21, betUserCount: 22,
};
// 這四類統計查詢時後端會把 currencyCode 強制清空（HourlyPlatformStatisticTypesWithNoCurrencyCode，
// agrabah statistic.ts:143），呼叫端帶任何 currencyCode 都會被忽略。
export const PLATFORM_STATISTIC_TYPES_WITH_NO_CURRENCY = [ 'onlineUsers', 'maxOnlineUsers', 'onlineMembers', 'maxOnlineMembers' ] as const;

// FixedRankingKindEnum（rajah/services/ranking.rajah:10-20）——固定排行榜種類，unknown=0
// 不收錄成可選值（FixedRankingPlatform 後端對 kind=0 一律回 invalidData，2026-08-26 dev 實測確認）。
export const FIXED_RANKING_KIND_MAP = { turnover: 1, profit: 2, contribution: 3 } as const;
export type FixedRankingKindKey = keyof typeof FIXED_RANKING_KIND_MAP;
export const FIXED_RANKING_KIND_KEYS = Object.keys(FIXED_RANKING_KIND_MAP) as [ FixedRankingKindKey, ...FixedRankingKindKey[] ];

// FixedRankingPeriodEnum（rajah/services/ranking.rajah:23-36）。today=1 已停用（rajah 註解「已停用，
// 僅供歷史資料保留」），不收錄成可選值；unknown=0 同樣不收錄——後端 `getAllowedPeriodsForKind` 只接受
// thisWeek/lastWeek/thisMonth/lastMonth（流水/盈利榜）或 allTime（等級榜），不會用到 unknown/today。
export const FIXED_RANKING_PERIOD_MAP = { thisWeek: 2, lastWeek: 3, thisMonth: 4, lastMonth: 5, allTime: 6 } as const;
export type FixedRankingPeriodKey = keyof typeof FIXED_RANKING_PERIOD_MAP;
export const FIXED_RANKING_PERIOD_KEYS = Object.keys(FIXED_RANKING_PERIOD_MAP) as [ FixedRankingPeriodKey, ...FixedRankingPeriodKey[] ];

// FixedRankingMaxDisplayCountEnum（rajah/services/ranking.rajah:51-55）；unknown=0 不收錄（同上理由）。
export const FIXED_RANKING_MAX_DISPLAY_COUNT_MAP = { hundred: 1, threeHundred: 2 } as const;
export type FixedRankingMaxDisplayCountKey = keyof typeof FIXED_RANKING_MAX_DISPLAY_COUNT_MAP;
export const FIXED_RANKING_MAX_DISPLAY_COUNT_KEYS = Object.keys(FIXED_RANKING_MAX_DISPLAY_COUNT_MAP) as [ FixedRankingMaxDisplayCountKey, ...FixedRankingMaxDisplayCountKey[] ];

// RankingTypeEnum（rajah/services/ranking.rajah:2-7），供 RankingPlatform.CreateOrUpdateActivityRankingSetting 使用。
export const RANKING_TYPE_MAP = { winLose: 1, validBet: 2 } as const;
export type RankingTypeKey = keyof typeof RANKING_TYPE_MAP;
export const RANKING_TYPE_KEYS = Object.keys(RANKING_TYPE_MAP) as [ RankingTypeKey, ...RankingTypeKey[] ];

// RankingTargetEnum（ranking_back_office.rajah:1-8），供 RankingPlatform.CreateOrUpdateActivityRankingSetting 使用。
export const RANKING_TARGET_MAP = { gameBrand: 1, game: 2, all: 3 } as const;
export type RankingTargetKey = keyof typeof RANKING_TARGET_MAP;
export const RANKING_TARGET_KEYS = Object.keys(RANKING_TARGET_MAP) as [ RankingTargetKey, ...RankingTargetKey[] ];

// ActivityRankingPeriodResetEnum（ranking_back_office.rajah:10-17），供
// RankingPlatform.CreateOrUpdateActivityRankingSetting 的 periodReset 使用。none=0 是合法值
// （未啟用週期重置），必須收錄，不能比照下面 unknown=0 系列排除。
export const ACTIVITY_RANKING_PERIOD_RESET_MAP = { none: 0, daily: 1, weekly: 2 } as const;
export type ActivityRankingPeriodResetKey = keyof typeof ACTIVITY_RANKING_PERIOD_RESET_MAP;
export const ACTIVITY_RANKING_PERIOD_RESET_KEYS = Object.keys(ACTIVITY_RANKING_PERIOD_RESET_MAP) as [ ActivityRankingPeriodResetKey, ...ActivityRankingPeriodResetKey[] ];

export function toPlainNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value);
    if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
        return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
}

/**
 * 第二組需要 toPlainNumber 的 i64 欄位：CurrencyLink.value（common.rajah:1171-1174），
 * ItemDepositWithdrawDetail 的 discountAmount/discountPercent/discountMax/paymentMin/
 * paymentMax/wageringMultiplier 都是 [CurrencyLink]，逐筆把 value 轉成一般數字，
 * 其餘欄位（code）原樣保留。輸入不是陣列（未設定/null）時原樣回傳。
 */
export function formatCurrencyLinks(links: unknown): unknown {
    if (!Array.isArray(links)) return links;
    return links.map((link) => ({ ...(link as Record<string, unknown>), value: toPlainNumber((link as { value?: unknown }).value) }));
}

/**
 * 遞迴把回傳物件裡任何 protobufjs Long 實例（i64 欄位解出來的原始型別，鴨子定型判斷式
 * 同 toPlainNumber：有 low/high 兩個 number 欄位 + toNumber() 方法）轉成一般 number，
 * 其餘型別（string/boolean/null/一般 number）原樣通過。
 *
 * 為什麼跟 toPlainNumber 分開一支：toPlainNumber 是「呼叫端已經知道這個特定欄位是 i64」時的
 * 精確轉換（含字串輸入也轉數字，適合單一已知欄位）；deepFixLongs 是「不確定整包物件裡哪些欄位
 * 是 i64」時的保守 catch-all（只轉真正還是 Long 實例的值，不對字串亂猜），用於 point_back_office
 * 系列 tool 直接透傳 rajah model 全部欄位（rebateMax/quantity/各種 timestamp/CurrencyLink.value
 * 等 i64 散落在巢狀結構各處）的情境——在呼叫端把讀回的值原樣傳回寫入 method 時，若停留在
 * Long 實例會被 JSON.stringify 自動呼叫 toJSON() 轉成十進位字串，導致這個值不再滿足 zod
 * `z.number()` schema（2026-08-25 dev 實測 UpdateVipPointSetting 復現：GetVipPointSetting 讀回的
 * rebateMax 字串化後直接餵回 UpdateVipPointSetting 觸發 zod 驗證錯誤）。在回傳給呼叫端前先在這裡
 * 攔截轉換，才能讓「讀回值直接餵回寫入 tool」這個 agent 最自然的操作模式正常運作。
 */
export function deepFixLongs<T>(value: T): T {
    if (value === null || typeof value !== 'object') return value;
    const maybeLong = value as unknown as { low?: unknown; high?: unknown; toNumber?: () => number };
    if (typeof maybeLong.low === 'number' && typeof maybeLong.high === 'number' && typeof maybeLong.toNumber === 'function') {
        return maybeLong.toNumber() as unknown as T;
    }
    if (Array.isArray(value)) return value.map((item) => deepFixLongs(item)) as unknown as T;
    const result: Record<string, unknown> = {};
    for (const [ key, item ] of Object.entries(value as Record<string, unknown>)) {
        result[ key ] = deepFixLongs(item);
    }
    return result as T;
}

/**
 * 遮罩 IPv4 位址中間兩段（如 1.2.3.4 → 1.*.*.4），供 list_agent_report_details.ts /
 * list_agent_member_game_reports.ts / list_agent_login_histories.ts 共用（2026-08-26 review
 * 發現三處各自複製貼上同一份邏輯，抽成共用函式避免日後改一處忘記改其他處）。
 * ⚠️ 只認 4 段式 IPv4：非此格式（含 IPv6、空字串以外的異常值）原樣回傳、不遮罩——呼叫端若資料庫
 * 存在 IPv6 登入紀錄（agent_login_histories 用 INET6_ATON 儲存，理論上可存 IPv6），這裡不會遮罩，
 * 各呼叫端 tool description 需自行提及此例外。
 */
export function maskIp(ip: string | null | undefined): string | null | undefined {
    if (!ip) return ip;
    const parts = ip.split('.');
    if (parts.length !== 4) return ip;
    return `${ parts[0] }.*.*.${ parts[3] }`;
}

// PointTransactionCategoryEnum（common.rajah:2282-2298），供 PointPlatform.ListPointTransactions 的
// search.category 篩選使用。unknown=0 在後端語意是「不篩選」，不收錄成可選值。
export const POINT_TRANSACTION_CATEGORY_KEYS = [
    'turnover', 'checkIn', 'exchangeProduct', 'expired', 'manualAdd', 'manualDeduct', 'roulette',
] as const;
export const POINT_TRANSACTION_CATEGORY_MAP: Record<(typeof POINT_TRANSACTION_CATEGORY_KEYS)[number], number> = {
    turnover: 1, checkIn: 2, exchangeProduct: 3, expired: 4, manualAdd: 5, manualDeduct: 6, roulette: 7,
};

/**
 * CurrencyLink（`{code, value}`，rajah model 的 `value` 是 i64）陣列轉換：`value` 經
 * protobufjs decode 同樣可能是 Long 物件，套用 toPlainNumber()。2026-08-25 review 發現
 * list_room_gifts.ts/get_room_gift_statistic_summary.ts/list_records.ts 對巢狀在
 * CurrencyLink[] 元素內的 value 原本全部漏轉（只轉了頂層/row 層的裸 i64 欄位），
 * 抽成共用函式避免重複遺漏。
 */
export function toPlainCurrencyLinks(
    links: { code?: string | null; value?: unknown }[] | null | undefined,
): { code: string | null | undefined; value: number | undefined }[] {
    return (links ?? []).map((l) => ({ code: l.code, value: toPlainNumber(l.value) }));
}

// security_restriction_back_office domain（SecurityRestrictionPlatform 系列 tool）共用的 enum 對照表。

// FieldRequirementEnum（common.rajah:2108-2115），RegistrationFieldConfig 每個註冊欄位的顯示要求。
export const FIELD_REQUIREMENT_MAP = { hidden: 1, optional: 2, required: 3 } as const;

// RegistrationTypeEnum（common.rajah:2119-2124）。dev 實測發現除了 user/agent 兩個列舉值，
// 資料庫還存在一筆 registrationType=0 的既有列（疑似歷史遺留的預設/共用設定，不在列舉定義內），
// get_registration_field_configs.ts 用 describeEnum() 對照不到時原樣回傳數字 0，不視為錯誤。
export const REGISTRATION_TYPE_MAP = { user: 1, agent: 2 } as const;

// RegistrationLimitPeriodTypeEnum（common.rajah:2184-2191）
export const REGISTRATION_LIMIT_PERIOD_MAP = { day: 1, week: 2, permanent: 3 } as const;

// LoginVerificationTypeEnum（common.rajah:2099-2104）
export const LOGIN_VERIFICATION_TYPE_MAP = { otp: 1, realName: 2 } as const;

// PasswordResetPeriodUnitEnum（common.rajah:2172-2181）
export const PASSWORD_RESET_PERIOD_UNIT_MAP = { day: 1, week: 2, month: 3, year: 4 } as const;

// TradePasswordLockRecordStatusEnum（common.rajah:2408-2414，唯讀顯示用，四個值皆可能出現在回傳資料）
export const TRADE_PASSWORD_LOCK_STATUS_MAP = { warn: 1, lock: 2, unlock: 3, clear: 4 } as const;

// ActiveStatusTradePasswordLockRecordStatusEnum（common.rajah:2416-2420），
// ListTradePasswordLockRecordSearch.status 篩選專用，只收斂 lock/unlock 兩態（後端故意隱藏 warn/clear 選項）。
export const ACTIVE_TRADE_PASSWORD_LOCK_STATUS_MAP = { lock: 2, unlock: 3 } as const;

// VerifyLimitTypeEnum（common.rajah:2422-2426）
export const VERIFY_LIMIT_TYPE_MAP = { every: 1, hour: 2, day: 3 } as const;

// TradeVerifyTypeEnum（common.rajah:2429-2438），交易密碼驗證涵蓋的操作類型；
// TradePasswordLockConfigEdit 用同名 bool 欄位（bindFiat/bindCrypto/...）逐一開關，
// ListTradePasswordLockRecordSearch.tradeVerifyType 與 TradePasswordLockRecordEssential.tradeVerifyType
// 則是單一數值（哪一種操作觸發的鎖定），兩處共用這張對照表。
export const TRADE_VERIFY_TYPE_MAP = {
    bindFiat: 1, bindCrypto: 2, bindWallet: 4, withdraw: 8, goldDeposit: 16,
    buyRoomTicket: 32, buyCar: 64, giftGiving: 128, donate: 256,
} as const;

// FreezeDurationUnitEnum（service_common.rajah:2340-2344）
export const FREEZE_DURATION_UNIT_MAP = { minutes: 1, hours: 2, days: 3 } as const;

// UserLevelTypeEnum（user_level_back_office.rajah:1-4）——會員層級的種類。auto=0 自動層級
// （由層級策略自動升降、level 由後端連號重排）、static=1 固定層級（不參與自動升降）。
// UserLevel.GetList 的 type 參數、UserLevel.Add 的 UserLevelConfig.type、以及 GetNameList
// 回傳的 type 欄位共用同一組值，故放這裡不各自宣告。
export const USER_LEVEL_TYPE_KEYS = [ 'auto', 'static' ] as const;
export const USER_LEVEL_TYPE_MAP: Record<(typeof USER_LEVEL_TYPE_KEYS)[number], number> = {
    auto: 0,
    static: 1,
};
