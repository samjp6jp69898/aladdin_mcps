/**
 * constants.ts — 所有 tool 共用的 rajah enum 對照表與錯誤碼，集中管理避免各 tool 檔案各自重複一份。
 * 帳號/URL 等環境相關設定不放這裡，一律走 process.env（見 session.ts），不寫死 fallback。
 */

// AgrabahErrorCodeEnum.loginRequired，見 rajah/services/common.rajah:7
export const LOGIN_REQUIRED_ERROR_CODE = 103;

// AgrabahErrorCodeEnum.totpNeeded，見 rajah/services/common.rajah:591。Auth.Login 在帳密正確但
// 後端要求動態驗證碼時回這個 errorCode（r.data 為 null）；H6 的 POST /login 用它判斷要不要
// 標記 totpRequired，讓企劃端 skill 能明確辨識「不是帳密錯，是還要再帶 totpCode 重打一次」。
export const TOTP_NEEDED_ERROR_CODE = 1809;

// Gate 判斷 platform 是看 HTTP Host header 查 core.domains，這個 header 是沿用既有 test-method
// 腳本的慣例（admin 站台本身沒有多平台概念，不確定是否必要，先保留）。
export const ADMIN_HEADER_PLATFORM_CODE = '0';

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

// dev 環境 2026-08-18 實測 GameVendorAdmin.ListAdapters() 拿到的已知合法值，僅供參考、非強制窮舉
// （後端可能持續新增，agent 若不確定應先向操作者確認，或直接嘗試、依錯誤訊息判斷）。
export const KNOWN_ADAPTERS = [
    'encanto', 'jili', 'in_house', 'ks', 'ameba', 'pragmatic_play', 'pocket_game', 'JDB', 'BGLive', 'BGFish',
    'PA', 'BBIN', 'SBTY', 'PMTY', 'IM', 'PT', 'KY', 'FB', 'FC', 'CQ9', 'VR', 'OBLive', 'OBHash', 'DBBoard',
    'DBPanda', 'DBPocket', 'DbLottery', 'DbEsport', 'DBFish', 'gfg', 'sw', 'MgPlus', 'LeiHuo', 'OG', 'TCG',
    'Allbet', 'JJFish',
];
