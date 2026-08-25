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
// TimeLimitTypeEnum（common.rajah:1597-1606），供 PointPlatform.GetPointSetting/UpdatePointSetting 的
// dueType 使用。unknown=0 不收錄——後端驗證只接受 absoluteTime（需 dueAtTimestamp）或 relativeTime（需 dueDay）。
export const TIME_LIMIT_TYPE_KEYS = [ 'unlimitedTime', 'absoluteTime', 'relativeTime' ] as const;
export const TIME_LIMIT_TYPE_MAP: Record<(typeof TIME_LIMIT_TYPE_KEYS)[number], number> = {
    unlimitedTime: 1, absoluteTime: 2, relativeTime: 3,
};

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

// PointTransactionCategoryEnum（common.rajah:2282-2298），供 PointPlatform.ListPointTransactions 的
// search.category 篩選使用。unknown=0 在後端語意是「不篩選」，不收錄成可選值。
export const POINT_TRANSACTION_CATEGORY_KEYS = [
    'turnover', 'checkIn', 'exchangeProduct', 'expired', 'manualAdd', 'manualDeduct', 'roulette',
] as const;
export const POINT_TRANSACTION_CATEGORY_MAP: Record<(typeof POINT_TRANSACTION_CATEGORY_KEYS)[number], number> = {
    turnover: 1, checkIn: 2, exchangeProduct: 3, expired: 4, manualAdd: 5, manualDeduct: 6, roulette: 7,
};
