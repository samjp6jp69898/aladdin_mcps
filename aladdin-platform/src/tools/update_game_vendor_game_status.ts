/**
 * tools/update_game_vendor_game_status.ts — aladdin_platform_game_vendor_platform_update_game_vendor_game_status
 *
 * rajah: GameVendorPlatform.UpdateGameVendorGameStatus(gameVendorId i32 1, gameId string 2, newStatus StatusEnum 3)
 * （game_back_office.rajah:1091，需要 @Permission "GameVendor.Game.Status.Toggle"）——
 * 用業務鍵（gameVendorId + gameId，非內部流水號 id）定位單一遊戲，切換它「在當前這個平台底下」的
 * 上下架狀態（`platform_game_vendor_games.status`）。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:1142-1163，
 * methodUpdateGameVendorGameStatus；同檔 171-204，ensurePlatformGameVendorGame）：
 *
 * **關鍵風險（本工具的核心設計都是為了防這個）**：這支方法底層第一步呼叫
 * `ensurePlatformGameVendorGame(gameVendorId, gameId)`：
 * 1. 先查全平台共用的「廠商遊戲母表」（`game_vendor_games`）有沒有這個 gameVendorId+gameId，
 *    沒有 → 回 errorCode=303（gameVendorGameNotExists），這個分支行為正常、可信賴。
 * 2. 母表有 → 再查本平台是否已經上架過這款遊戲（`platform_game_vendor_games` 有沒有
 *    對應列）。**若還沒上架，這個函式會直接自動新增一筆 `platform_game_vendor_games`
 *    （status 預設 enabled、sortOrder 沿用母表值、name 取當前語系翻譯），視同「靜默上架」，
 *    然後才繼續往下走 `updateStatus()` 把狀態改成呼叫端指定的 newStatus**。也就是說，對一款
 *    「母表有、但本平台還沒上架」的遊戲呼叫這支「切換狀態」方法，副作用不是「操作失敗」，而是
 *    「先幫你把它上架，再套用你指定的狀態」——跟工具名稱字面上「切換既有狀態」的預期不符，
 *    是本工具必須向呼叫端明確揭露、且預設要擋下來的行為（見下方 `forceOnboard` 參數）。
 *    這個 `ensurePlatformGameVendorGame` 同樣被既有的 `update_game_vendor_game.ts`（背後呼叫
 *    `GetGameVendorGameForEdit` + `UpdateGameVendorGame`）使用，是本 server 已有的既定上架機制，
 *    不是本工具獨有的怪異行為，但套用在「狀態切換」這個語意上仍需要額外防呆。
 *    **這個「靜默上架」實際上為什麼不算憑空生變化（獨立 review 2026-08-25 補充查證）**：
 *    `GameVendorPlatform.ListGames` 本身查詢時就是 `LEFT JOIN platform_game_vendor_games ... ` +
 *    `IFNULL(pgvg.status, gvg.status)`（`game_vendor_platform.ts:560-573`）——一款母表已存在、
 *    廠商已上架的遊戲，即使還沒有 `platform_game_vendor_games` 列，在 `ListGames` 清單裡也早就
 *    顯示成「已啟用」了，不是要等 `ensurePlatformGameVendorGame` 建立列之後才「憑空冒出來」。
 *    更關鍵的是玩家端真正的可見性判斷（`servers/game/caches/gameListCache.ts:16-26`）用的是
 *    完全同構的 `LEFT JOIN ... (pgvg.status IS NULL OR pgvg.status = enabled)` 邏輯——也就是說，
 *    這款遊戲不管有沒有呼叫過本工具，只要母表狀態是 enabled，玩家端本來就已經看得到、玩得到。
 *    `ensurePlatformGameVendorGame` 建立的列只是把「查詢時用 IFNULL 推算出的預設值」materialize
 *    成一筆實體資料列（sortOrder/name 也是直接抄母表當下值，不是另外算出新值），本工具再覆蓋
 *    呼叫端明確要求變更的 status 欄位，不會產生任何「呼叫前後玩家端可見性突然改變」的隱藏效果。
 *    這個安全性推論依賴 `ListGames` 與 `gameListCache.ts` 兩處查詢的 LEFT JOIN/IFNULL 語意保持一致；
 *    未來若任一處查詢邏輯改成不同的 fallback 規則，這裡的安全假設需要重新檢視。
 * - 找到/建立 platform 列之後，改用 `updateStatus()` helper（`common/database_helper.ts`，
 *   跟姊妹方法 `UpdateGameVendorStatus` 相同的 helper，*不是* `UpdateGameVendorMaintenanceStatus`
 *   那種直接裸 UPDATE 的寫法）——**這支方法本身沒有姊妹方法 `UpdateGameVendorMaintenanceStatus`
 *   的「不存在 id 靜默成功」風險**，`updateStatus()` 會檢查 affectedRows，0 列時回
 *   errorCode=14（objectNotFound）。但因為呼叫前已經被 `ensurePlatformGameVendorGame` 保證
 *   platform 列一定存在（不存在就已經被建立），這個 objectNotFound 分支理論上不會被本方法
 *   實際觸發到（除非極端競態）。
 * - `PlatformGameVendorGameEdit`（`GetGameVendorGameForEdit` 的回傳型別）**沒有 status 欄位**，
 *   無法用它讀現值；而且它跟 `UpdateGameVendorGameStatus` 一樣會呼叫
 *   `ensurePlatformGameVendorGame`，用它當「讀現值」步驟一樣會觸發靜默上架，不能拿來當安全的
 *   唯讀基準。改用 `ListGames(search{gameVendorId}, page, pageSize)`（`PlatformGameVendorGameEssential`
 *   含 `status` 欄位）當唯讀基準——這支純粹是查詢，不呼叫 `ensurePlatformGameVendorGame`，
 *   不會有上架副作用。**但這支 search 沒有「用 gameId 字串精確查找」的欄位**（`gameIds` 是
 *   `@Hide` 的 `[i32]`，吃的是內部流水號、不是業務鍵字串），只能用 gameVendorId 篩選後逐頁掃描
 *   比對每筆 row 的 `gameId` 字串——比照 method-category-checklist.md 第 2 節 B 級／第 5 節規則：
 *   `pageSize` 是裸 `i32`（非 `PageSizeEnum`，伺服器未強制上限），本工具固定用 200（該規則慣用
 *   安全上限）逐頁掃描，總掃描列數上限 20 頁 × 200 = 4000 筆、整體逾時 30 秒、**單頁請求逾時 5 秒**
 *   （`withPageTimeout()`，`Promise.race` 對單頁請求加時間上限；remote client 本身沒有內建的
 *   請求逾時/取消機制，這裡是「不再等待該次回應」的軟性逾時，不會真的中止已送出的底層 HTTP 請求），
 *   任一項觸頂皆回傳 `hitScanCap: true` 而非誤報「已掃完」。
 * - `forceOnboard` 參數：預設 `false`。掃描後若在本平台清單裡找不到這個 gameId（代表尚未上架，
 *   或掃描觸頂無法確認），本工具**預設直接拒絕呼叫底層 RPC**，回報「找不到，是否要改走明確的上架
 *   工具 aladdin_platform_game_vendor_platform_update_game_vendor_game」，避免呼叫端以為在切換
 *   既有遊戲狀態、實際上卻在不知情的情況下觸發了上架。呼叫端若讀完本說明後確認就是要「上架同時指定
 *   初始狀態」，可明確帶 `forceOnboard: true` 略過這道防呆、直接呼叫底層 RPC。
 *
 * **2026-08-25 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，範圍：
 * 已上架遊戲的 round-trip 切換 enabled/disabled + 讀回驗證 + 切回原值復原，全程無殘留髒資料；
 * 非法列舉值 254 → errorCode=9；不存在的業務鍵 → errorCode=303）。
 *
 * **2026-08-25 改用真正 MCP stdio Client 補測（`@modelcontextprotocol/sdk` Client + StdioClientTransport
 * 走 `tools/call`，涵蓋 zod schema 驗證與 `registerTool` handler，不繞過 MCP 工具層）時發現並修正一個
 * 真實 bug**：`ListGames` 的 `totalPage` 欄位**只有第 1 頁回傳正確值，第 2 頁起一律回 0**（疑似後端只在
 * 第一頁做 COUNT 查詢的最佳化）。原本的掃描迴圈每頁都無條件覆寫 `totalPage`，導致第 2 頁起被 0 蓋掉，
 * 誤判「已無下一頁」而提早中止掃描——用 gameVendorId=1（Jili，155 筆已上架遊戲）搭配臨時調降
 * `SCAN_PAGE_SIZE=50` 讓資料集跨 4 頁重現：修正前掃到第 2 頁（100 筆）就誤判找不到清單第 155 筆
 * （page 4 才有的 gameId="583"）；修正後（只在拿到非 0 值時才更新 `totalPage`）正確掃到第 4 頁、
 * `scannedPages=4` 找到目標並完成 round-trip 切換 enabled/disabled + 復原，讀回驗證通過。這個修正對
 * `SCAN_PAGE_SIZE=200`（正式使用的值）同樣適用——目前 dev 上沒有任何廠商在本平台的已上架遊戲數超過
 * 200 筆（實測最大 155 筆），因此 `SCAN_PAGE_SIZE=200` 這個設定值本身尚未在真實資料上跑出第 2 頁，
 * 但掃描邏輯本身已用等價的跨頁情境（`SCAN_PAGE_SIZE=50`）驗證過同一段程式碼、同一個 totalPage 陷阱。
 * 也額外驗證了單頁 5 秒逾時的 `withPageTimeout()` 不影響正常情境下的成功路徑。
 * **未在 dev 上實測 `forceOnboard` 觸發靜默上架的分支**——這條
 * 路徑目前沒有對應的刪除 API，一旦觸發會在 dev 留下一筆無法清除的 `platform_game_vendor_games`
 * 紀錄，risk/報酬不成比例，因此改以讀原始碼（agrabah 實作 + `ensurePlatformGameVendorGame` 完整
 * 邏輯）交叉核對取代實打，信心來源是這段程式碼已被既有、已上線的 `update_game_vendor_game.ts` 走過
 * 同一條路徑。若之後需要對這個分支做 dev 實測，建議挑一個之後就要下架的一次性測試 gameId、測完呼叫
 * 本工具把它切成 disabled 收尾（無法真正刪除，只能停用）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameVendorGameEssentialSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_MAP, STATUS_KEYS } from '../const.ts';

const SCAN_PAGE_SIZE = 200;
const SCAN_MAX_PAGES = 20;
const SCAN_TIMEOUT_MS = 30_000;
const SCAN_PAGE_TIMEOUT_MS = 5_000;

const PAGE_TIMEOUT_MARKER = Symbol('page-timeout');

/** method-category-checklist.md 第 2 節 B 級要求的「單頁請求逾時 5 秒」——remote client 本身沒有內建逾時。 */
async function withPageTimeout<T>(promise: Promise<T>): Promise<T | typeof PAGE_TIMEOUT_MARKER> {
    return Promise.race([
        promise,
        new Promise<typeof PAGE_TIMEOUT_MARKER>((resolve) => setTimeout(() => resolve(PAGE_TIMEOUT_MARKER), SCAN_PAGE_TIMEOUT_MS)),
    ]);
}

/** 純讀取掃描，不觸發 ensurePlatformGameVendorGame 的上架副作用。 */
async function findGameStatusByBusinessKey(gameVendorId: number, gameId: string) {
    const startedAt = Date.now();
    let totalPage = 1;
    let scannedPages = 0;
    let scannedRows = 0;
    for (let page = 1; page <= totalPage && page <= SCAN_MAX_PAGES; page++) {
        if (Date.now() - startedAt > SCAN_TIMEOUT_MS) {
            return { failedResult: undefined, matchedRow: undefined, scannedPages, scannedRows, hitScanCap: true } as const;
        }
        const search = PlatformGameVendorGameEssentialSearch.create({ gameVendorId });
        const listR = await withPageTimeout(withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListGames(search, page, SCAN_PAGE_SIZE)));
        if (listR === PAGE_TIMEOUT_MARKER) {
            return { failedResult: undefined, matchedRow: undefined, scannedPages, scannedRows, hitScanCap: true } as const;
        }
        if (listR.failed) return { failedResult: listR, matchedRow: undefined, scannedPages, scannedRows, hitScanCap: false } as const;
        scannedPages++;
        const rows = listR.data?.rows ?? [];
        scannedRows += rows.length;
        // 2026-08-25 dev 實測發現：ListGames 的 totalPage 只有第 1 頁回傳正確值，第 2 頁起一律回 0
        // （疑似後端只在第一頁做 COUNT 查詢的最佳化）。只在拿到「非 0」的值時才更新，避免用第 2 頁
        // 起的 0 覆蓋掉第 1 頁已知的正確頁數而提早誤判「已無下一頁」中止掃描。
        if (listR.data?.totalPage) totalPage = listR.data.totalPage;
        const matchedRow = rows.find((row) => row.gameId === gameId);
        if (matchedRow) return { failedResult: undefined, matchedRow, scannedPages, scannedRows, hitScanCap: false } as const;
        if (rows.length < SCAN_PAGE_SIZE) break; // 無 totalPage 可信賴時，回傳筆數小於 pageSize 視為最後一頁
    }
    const hitScanCap = scannedPages >= SCAN_MAX_PAGES && scannedPages < totalPage;
    return { failedResult: undefined, matchedRow: undefined, scannedPages, scannedRows, hitScanCap } as const;
}

export function registerUpdateGameVendorGameStatusTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_update_game_vendor_game_status',
        {
            title: "Update a game's on-platform status by vendor game business key",
            description:
                '把某個廠商遊戲（用 gameVendorId+gameId 業務鍵定位，非內部流水號）「在當前這個平台底下」的' +
                '上下架狀態改成指定值（rajah: GameVendorPlatform.UpdateGameVendorGameStatus，需要權限節點 ' +
                'GameVendor.Game.Status.Toggle）。' +
                '**重要風險**：這支底層 RPC 對「母表存在、但本平台尚未上架」的遊戲，會先靜默把它上架' +
                '（用預設 enabled 可見狀態、母表排序值）再套用你指定的狀態——不是回錯誤（實際上這不算憑空' +
                '產生新的可見性變化，因為 ListGames 查詢本身與玩家端可見性判斷都用同一套「未上架視同母表狀態」' +
                'fallback 邏輯，詳見檔頭註解，但仍建議透過本工具而非直接呼叫底層 RPC，以取得明確防呆與讀回驗證）。' +
                '本工具預設會先用' +
                '（不會觸發上架副作用的）唯讀清單掃描確認這個 gameId 已經上架在本平台，若掃描不到就直接拒絕' +
                '呼叫底層 RPC 並回報，避免你在不知情的情況下觸發上架；確認就是要「上架同時指定初始狀態」的話，' +
                '明確帶 forceOnboard=true 才會略過這道防呆繼續執行。' +
                '若母表本身就沒有這個 gameVendorId+gameId（廠商遊戲從未存在），無論 forceOnboard 為何都會收到' +
                '底層錯誤 errorCode=303（gameVendorGameNotExists）。' +
                'gameVendorId 用 aladdin_platform_game_vendor_platform_list_game_vendors 查；gameId 用 ' +
                'aladdin_platform_game_vendor_platform_list_games 查本平台已上架的遊戲清單取得業務鍵。' +
                'status 合法值（rajah StatusEnum）：unknown/enabled/disabled/frozen/deleted，一般上架/下架只會用到 ' +
                'enabled/disabled。newStatus 帶非法列舉值時回 errorCode=9（invalidData，dev 實測確認）。' +
                '目標狀態與現值相同時直接呼叫後端也會成功，本工具仍先讀現值、相同則短路不呼叫後端，純粹省一次寫入 RPC。' +
                '由於這支 RPC 沒有帶 status 的業務鍵單筆查詢方法（`GetGameVendorGameForEdit` 沒有 status 欄位，' +
                '且同樣有上架副作用不能拿來讀現值），本工具改用 ListGames 依 gameVendorId 逐頁掃描比對 gameId 定位' +
                '（單頁 200 筆、最多 20 頁／4000 筆、整體逾時 30 秒、單頁請求逾時 5 秒，觸頂會在回應標注 ' +
                'hitScanCap:true，不代表遊戲不存在，請縮小範圍或提高信心後重試）。' +
                'prod 執行前確認：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。' +
                '**2026-08-25 已通過 dev 實測**（已上架遊戲的 round-trip 切換 + 復原、非法列舉值、不存在業務鍵），' +
                '並用真正 MCP stdio Client 打 tools/call 補測跨頁掃描情境（過程中發現並修正 totalPage 分頁陷阱，' +
                '詳見檔頭註解）。forceOnboard 觸發的靜默上架分支因為沒有對應刪除 API、會在 dev 留下無法清除的紀錄，改以讀原始碼' +
                '交叉核對取代實打，未做 dev 實測，詳見檔頭註解。',
            inputSchema: {
                gameVendorId: z.number().int().describe('遊戲廠商 id，來自 aladdin_platform_game_vendor_platform_list_game_vendors'),
                gameId: z.string().min(1).describe('廠商系統裡的原始遊戲代碼（業務鍵），來自 aladdin_platform_game_vendor_platform_list_games 回傳的 gameId 欄位'),
                status: z.enum(STATUS_KEYS).describe('目標狀態：unknown/enabled/disabled/frozen/deleted，一般上架/下架用 enabled/disabled'),
                forceOnboard: z.boolean().optional().describe(
                    '預設 false。若這個 gameId 尚未上架到本平台，預設會拒絕執行並回報，避免誤觸發底層的靜默上架副作用；' +
                    '確認要「上架同時指定初始狀態」時才帶 true 略過這道防呆',
                ),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async ({ gameVendorId, gameId, status, forceOnboard, confirm }) => {
            assertProdConfirmed(confirm);
            const targetStatus = STATUS_MAP[ status ];

            const found = await findGameStatusByBusinessKey(gameVendorId, gameId);
            if (found.failedResult) return asErrorResult(found.failedResult);

            if (!found.matchedRow) {
                if (found.hitScanCap) {
                    return asTextResult({
                        success: false,
                        message: `掃描本平台廠商 ${ gameVendorId } 已上架遊戲清單觸頂（已掃 ${ found.scannedPages } 頁／` +
                            `${ found.scannedRows } 筆）仍未找到 gameId=${ gameId }，無法確認是否已上架，未呼叫底層 RPC。`,
                        hitScanCap: true,
                        scannedPages: found.scannedPages,
                        scannedRows: found.scannedRows,
                    });
                }
                if (!forceOnboard) {
                    return asTextResult({
                        success: false,
                        message: `在本平台廠商 ${ gameVendorId } 已上架清單裡找不到 gameId=${ gameId }（已掃描 ${ found.scannedPages } 頁／` +
                            `${ found.scannedRows } 筆）。可能是打錯 gameId，或這款遊戲在母表存在但本平台尚未上架——直接呼叫底層 RPC ` +
                            '會靜默把它上架再套用指定狀態，本工具預設不這麼做。若確認就是要「上架同時指定初始狀態」，請帶 forceOnboard=true 重試；' +
                            '若只是想走正規上架流程，改用 aladdin_platform_game_vendor_platform_update_game_vendor_game。',
                        scannedPages: found.scannedPages,
                        scannedRows: found.scannedRows,
                    });
                }
                // forceOnboard=true：明確略過防呆，直接呼叫底層 RPC（會觸發 ensurePlatformGameVendorGame 靜默上架）。
            } else if (found.matchedRow.status === targetStatus) {
                return asTextResult({
                    success: true,
                    message: '目標狀態與現值相同，未呼叫後端 RPC',
                    readBack: found.matchedRow,
                });
            }

            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateGameVendorGameStatus(gameVendorId, gameId, targetStatus));
            if (r.failed) return asErrorResult(r);

            const after = await findGameStatusByBusinessKey(gameVendorId, gameId);
            return asTextResult({
                success: true,
                message: found.matchedRow ? '更新成功' : '已上架並設定為指定狀態（forceOnboard 路徑）',
                readBack: after.matchedRow ?? { note: '讀回掃描中沒找到這個 id，非預期，請人工確認', hitScanCap: after.hitScanCap },
            });
        },
    );
}
