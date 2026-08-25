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

// WalletPlatform 系列 tool 共用（get_show_category/update_show_category/
// list_classification_categories/create_or_update_classification/
// get_categories_by_classification/list_user_transactions）：TransactionCategoryEnum
// 有 100+ 值（wallet_back_office.rajah），不手動謄寫一份對照表（容易漂移），
// 直接從已生成的 remote.gen.ts 匯入真正的 TS enum，用 Object.keys 動態推導出
// 字串 key 清單給 zod z.enum() 用（agent 傳字串 key，如 "paymentDeposit"，不傳數字碼），
// forward/reverse mapping 都用該 enum 物件本身的內建能力（TS 數字 enum 自動有雙向映射）。
import { TransactionCategoryEnum, TransactionStatusEnum, AgentModeForSearchAgentMemberEnum, AgentModeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';

export { TransactionCategoryEnum };

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

/**
 * i64 欄位（如 MessageBoardPostSetting 的 postsChangeUserDetailMinChargeTotal/
 * postsGiftReceiveTotalAmount）經 protobufjs decode 後是 Long 物件
 * （{low,high,unsigned} + toNumber()，genie/src/common/index.ts 的
 * fixObjectInteger 就是處理同一件事，但 genie/client 目前沒有自動套用，見該檔案
 * 註解），直接 JSON.stringify 會印出難以閱讀、且依呼叫路徑不同而不一致的形狀
 * （物件或十進位字串）。這個 codebase 目前只有一組 i64 欄位需要這樣轉換
 * （大舞台基本設置），實測數值都在 52 bit 安全整數範圍內，先用最小作法處理，
 * 之後若有第二組 i64 欄位需要同樣處理再考慮要不要抽更通用的版本。
 */
export function toPlainNumber(value: unknown): number | undefined {
    if (value === null || value === undefined) return undefined;
    if (typeof value === 'number') return value;
    if (typeof value === 'string') return Number(value);
    if (typeof value === 'object' && typeof (value as { toNumber?: () => number }).toNumber === 'function') {
        return (value as { toNumber: () => number }).toNumber();
    }
    return Number(value);
}
