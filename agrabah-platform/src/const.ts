/**
 * const.ts — 所有 tool 共用的 rajah enum 對照表與錯誤碼，集中管理避免各 tool 檔案各自重複一份。
 * 帳號/URL 等環境相關設定不放這裡，一律走 process.env（見 session.ts），不寫死 fallback。
 */

// AgrabahErrorCodeEnum.loginRequired，見 rajah/services/common.rajah:7
export const LOGIN_REQUIRED_ERROR_CODE = 103;

// AgrabahErrorCodeEnum.totpNeeded，見 rajah/services/common.rajah:591。Auth.Login 在帳密正確但
// 後端要求動態驗證碼時回這個 errorCode（r.data 為 null）；H6 的 POST /login 用它判斷要不要
// 標記 totpRequired，讓企劃端 skill 能明確辨識「不是帳密錯，是還要再帶 totpCode 重打一次」。
export const TOTP_NEEDED_ERROR_CODE = 1809;

// AgrabahErrorCodeEnum.gameVendorGameNotExists，見 rajah/services/common.rajah:102
export const GAME_VENDOR_GAME_NOT_EXISTS_ERROR_CODE = 303;

// ActiveStatusEnum（common.rajah:1073-1076）
export const ACTIVE_STATUS_MAP = { enabled: 1, disabled: 2 } as const;

// GameImageShapeEnum（game_back_office.rajah:266-272）；PlatformUploadGameImageEnum.game=1（game_back_office.rajah:627-633）
export const IMAGE_SHAPE_MAP = { square: 1, rectangle: 2, banner: 3 } as const;
export const UPLOAD_TYPE_GAME = 1;

// H7：hosted 模式下 JWT 過期或尚未登入時回給 agent 的重登信號文字（plan.md D4/D11）。
// D11 要求 harness 只陳述事實、不引導跨後台操作，措辭止於此，不建議改用其他帳號或後台。
// stdio 模式不會用到這個常數——stdio 用 env 帳密自動重登，不會走到需要對外顯示訊號的分支。
export const HOSTED_RELOGIN_REQUIRED_MESSAGE = '登入態已失效，請重新登入後重試';
