/**
 * constants.ts — 所有 tool 共用的 rajah enum 對照表與錯誤碼，集中管理避免各 tool 檔案各自重複一份。
 * 帳號/URL 等環境相關設定不放這裡，一律走 process.env（見 session.ts），不寫死 fallback。
 */

// H11（plan.md D10）：不在此硬編 error code 數字，改由 session.ts / http.ts / mcp_result.ts
// 直接 import 生成的 AgrabahErrorCodeEnum（abu/admin/src/generated/remote.gen.ts）並用
// forward mapping（如 AgrabahErrorCodeEnum.loginRequired）或 reverse mapping 取代裸數字。

// H7：hosted 模式下 JWT 過期或尚未登入時回給 agent 的重登信號文字（plan.md D4/D11）。
// D11 要求 harness 只陳述事實、不引導跨後台操作，措辭止於此，不建議改用其他帳號或後台。
// stdio 模式不會用到這個常數——stdio 用 env 帳密自動重登，不會走到需要對外顯示訊號的分支。
export const HOSTED_RELOGIN_REQUIRED_MESSAGE = '登入態已失效，請重新登入後重試';

// WalletTypeEnum（common.rajah:1195-1202）
export const WALLET_TYPE_MAP = { normal: 1, agent: 2, commission: 3 } as const;

// GameDisplayTagEnum / GameRebateTagEnum 共用同一組值（game.rajah:2-18, game_back_office.rajah:75-91）
export const GAME_TAG_MAP = { unknown: 0, slot: 1, board: 2, fish: 3, live: 4, sport: 5, eSport: 6, lottery: 7 } as const;
export const GAME_TAG_KEYS = Object.keys(GAME_TAG_MAP) as [ keyof typeof GAME_TAG_MAP, ...(keyof typeof GAME_TAG_MAP)[] ];

// UrlOpenModeEnum（common.rajah:1113-1119）
export const OPEN_MODE_MAP = { embedded: 0, externalBrowser: 1, embeddedWithTitle: 2, inHouseGame: 3, inHouseSport: 4 } as const;
export const OPEN_MODE_KEYS = Object.keys(OPEN_MODE_MAP) as [ keyof typeof OPEN_MODE_MAP, ...(keyof typeof OPEN_MODE_MAP)[] ];

// GameImageShapeEnum（game_back_office.rajah:266-272）——admin 端 GetUploadGameVendorGameImageToken 只吃 shape，沒有 uploadType
export const IMAGE_SHAPE_MAP = { square: 1, rectangle: 2, banner: 3 } as const;

// StatusEnum（common.rajah:1061-1069，註解「database data status」，通用資料狀態）。
// 不含 last=255：該值是 enum 的上界哨兵，不是真實可寫入的狀態值。
export const STATUS_MAP = { unknown: 0, enabled: 1, disabled: 2, frozen: 3, deleted: 10 } as const;
export const STATUS_KEYS = Object.keys(STATUS_MAP) as [ keyof typeof STATUS_MAP, ...(keyof typeof STATUS_MAP)[] ];

// dev 環境 2026-08-18 實測 GameVendorAdmin.ListAdapters() 拿到的已知合法值，僅供參考、非強制窮舉
// （後端可能持續新增，agent 若不確定應先向操作者確認，或直接嘗試、依錯誤訊息判斷）。
export const KNOWN_ADAPTERS = [
    'encanto', 'jili', 'in_house', 'ks', 'ameba', 'pragmatic_play', 'pocket_game', 'JDB', 'BGLive', 'BGFish',
    'PA', 'BBIN', 'SBTY', 'PMTY', 'IM', 'PT', 'KY', 'FB', 'FC', 'CQ9', 'VR', 'OBLive', 'OBHash', 'DBBoard',
    'DBPanda', 'DBPocket', 'DbLottery', 'DbEsport', 'DBFish', 'gfg', 'sw', 'MgPlus', 'LeiHuo', 'OG', 'TCG',
    'Allbet', 'JJFish',
];
