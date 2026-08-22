/**
 * tools/upsert_game.ts — aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game
 *
 * rajah: GameVendorAdmin.CreateOrUpdateGameVendorGame（game_back_office.rajah:319）——底層
 * 是同一支 upsert RPC，id 留空為新增、帶入既有 id 為更新。本工具用 gameVendorId+gameId
 * 業務鍵先定位（GameVendorAdmin.ListGames 逐頁掃描到底 + GetGameVendorGameForEdit 讀現值）：
 * 找到既有遊戲就走更新語意（讀現值合併、只覆蓋你有帶的欄位，含圖片上傳/多語系名稱）；
 * 找不到就走新增語意（此時 name 必填）。
 *
 * 2026-08-22 前這是兩支分開的 tool（create_game.ts 直接建立 / edit_game.ts 用業務鍵編輯）。
 * 套用「<server>_<service>_<method>」命名規則時，兩支底層呼叫的其實是同一支
 * CreateOrUpdateGameVendorGame，天生會撞名；改為合併成一支 upsert 工具，讓 tool 邊界
 * 忠實反映「底層本來就是一支 upsert method」這個結構性事實，而不是在命名層面加字尾
 * 勉強分成兩支。合併同時補上舊 create_game.ts 缺的一步：舊版直接帶 id 更新時不會先讀現值
 * 合併，只送呼叫端當下給的欄位，有把沒帶到的欄位覆蓋成 undefined 的風險（不符合
 * method-category-checklist.md 第 4 節「先讀現值、只覆蓋要改欄位」的強制要求）；合併後
 * 一律先用業務鍵定位＋讀現值，不再提供繞過讀現值的直接 id 捷徑。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GameEdit } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { GAME_TAG_MAP, GAME_TAG_KEYS, OPEN_MODE_MAP, OPEN_MODE_KEYS, IMAGE_SHAPE_MAP } from '../const.ts';

// H9（plan.md D5 / §4.3）：filePath（stdio，本機工程師連線）與 fileId（hosted，
// 企劃端遠端連線，先呼叫 POST /files 上傳取得）二選一並存，不用 zod union——
// union 對「兩者都帶」這種情況預設會靜默用第一個匹配成員、忽略多餘欄位，
// 無法產生 AC4 要求的明確錯誤；改用兩個都 optional 的欄位，在 handler 內用
// 模式判斷明確擋下「都帶」與「都沒帶」兩種情況，見 uploadLocalizedImages()。
const imageUploadSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US——是這張圖要顯示給哪個語言看，不是平台代碼'),
    filePath: z.string().optional().describe(
        'stdio 模式專用（工程師本機直接執行這個 MCP server 時）：本機圖片檔案的絕對路徑。' +
        '與 fileId 二選一，不可同時提供、也不可兩者都不提供。',
    ),
    fileId: z.string().optional().describe(
        'hosted 模式專用（企劃端透過遠端連線呼叫）：先呼叫 POST /files 上傳圖片取得的 fileId。' +
        '與 filePath 二選一，不可同時提供、也不可兩者都不提供。',
    ),
})).optional();

const localizedTextSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US'),
    value: z.string().describe('該語系下的文字值'),
})).optional();

/**
 * localizedName 跟圖片欄位一樣是「每個語言各自一份」，但不需要上傳流程，直接是文字，
 * 純同步合併：帶到的語言覆蓋既有值（或新增），沒帶到的語言維持原值。
 */
function mergeLocalizedStrings(
    entries: { code: string; value: string }[] | undefined,
    existing: { code: string; value: string }[] | undefined,
): { code: string; value: string }[] {
    const merged = [ ...(existing ?? []) ];
    if (!entries) return merged;

    for (const { code, value } of entries) {
        const idx = merged.findIndex((ls) => ls.code === code);
        if (idx !== -1) merged[ idx ] = { code, value };
        else merged.push({ code, value });
    }

    return merged;
}

/**
 * 這個欄位在後端設計上是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制。
 * 呼叫端要為每個想更新的語言各自帶一組 {code, filePath|fileId}；每筆各自呼叫一次
 * GetUploadGameVendorGameImageToken 拿新 token 再上傳（token 單次使用、1 小時過期）。
 *
 * H9：fileId（hosted）先解析成本機暫存路徑，再餵進與 filePath（stdio）完全相同的
 * 下游上傳流程（GetUploadGameVendorGameImageToken → uploadFile）——上傳到 agrabah
 * 的既有機制完全不變，hosted 模式只是多一步「fileId → 本機路徑」的解析。
 */
async function uploadLocalizedImages(
    shape: keyof typeof IMAGE_SHAPE_MAP,
    uploads: { code: string; filePath?: string; fileId?: string }[] | undefined,
    existing: { code: string; value: string }[] | undefined,
): Promise<{ merged: { code: string; value: string }[]; errors: string[] }> {
    const merged = [ ...(existing ?? []) ];
    const errors: string[] = [];
    if (!uploads || uploads.length === 0) return { merged, errors };

    for (const { code, filePath, fileId } of uploads) {
        if (filePath !== undefined && fileId !== undefined) {
            errors.push(`[${ code }] 同時提供了 filePath 與 fileId，兩者二選一，請只帶其中一個`);
            continue;
        }
        if (filePath === undefined && fileId === undefined) {
            errors.push(`[${ code }] 缺少 filePath 或 fileId（stdio 模式帶 filePath，hosted 模式帶 fileId，擇一提供）`);
            continue;
        }

        let resolvedFilePath: string;
        if (fileId !== undefined) {
            const identity = currentIdentityForFiles();
            if (identity === undefined) {
                errors.push(`[${ code }] fileId 僅限 hosted 模式使用；目前是 stdio 連線，請改用 filePath`);
                continue;
            }
            const resolved = resolveFileIdForIdentity(fileId, identity);
            if (!resolved.found) {
                errors.push(`[${ code }] fileId 無法使用（${ resolved.reason }）：可能格式不合法、已過期、不存在、或不屬於你，請重新呼叫 POST /files 取得新的 fileId`);
                continue;
            }
            resolvedFilePath = resolved.path;
        } else {
            resolvedFilePath = filePath!;
        }

        const tokenR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.GetUploadGameVendorGameImageToken(IMAGE_SHAPE_MAP[ shape ]));
        if (tokenR.failed || !tokenR.data?.token) {
            errors.push(`[${ code }] 取得上傳 token 失敗：errorCode=${ tokenR.errorCode } ${ tokenR.message }`);
            continue;
        }

        const uploadR = await uploadFile(tokenR.data.token, resolvedFilePath);
        if (!uploadR.success) {
            errors.push(`[${ code }] ${ uploadR.message }`);
            continue;
        }

        const idx = merged.findIndex((ls) => ls.code === code);
        if (idx !== -1) merged[ idx ] = { code, value: uploadR.path };
        else merged.push({ code, value: uploadR.path });
    }

    return { merged, errors };
}

const LIST_PAGE_SIZE = 200;

/**
 * 用 gameVendorId+gameId 業務鍵逐頁掃描定位既有遊戲的內部流水號 id。
 * ListGames 沒有 gameId 篩選參數，只能翻頁比對——廠商遊戲數可能超過一頁（例如
 * PP電子-XO 有 518 款），只查第一頁會漏掉排在後面的遊戲，故逐頁掃到找到或掃完為止。
 * create/update 兩種模式共用：呼叫前先判斷「這筆是不是已經存在」，寫入後也重用它
 * 做新增情境的 round-trip 讀回。
 */
async function findGameRowByBusinessKey(gameVendorId: number, gameId: string) {
    let totalPage = 1;
    let scannedPages = 0;
    for (let page = 1; page <= totalPage; page++) {
        const listR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGames(gameVendorId, page, LIST_PAGE_SIZE));
        if (listR.failed) return { listR, matchedRow: undefined, scannedPages } as const;
        scannedPages++;
        totalPage = listR.data?.totalPage ?? 1;
        const matchedRow = listR.data?.rows?.find((row) => row.gameId === gameId);
        if (matchedRow) return { listR: undefined, matchedRow, scannedPages } as const;
    }
    return { listR: undefined, matchedRow: undefined, scannedPages } as const;
}

export function registerUpsertGameTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game',
        {
            title: 'Create or update a vendor game (upsert, including image uploads)',
            description:
                '新增或編輯一款廠商遊戲（rajah: GameVendorAdmin.CreateOrUpdateGameVendorGame，upsert 語意），' +
                '會寫進全平台共用的「廠商遊戲母表」（game_vendor_games）——這是唯一真正的「建立新遊戲」入口，' +
                'platform 後台做不到這件事，只能對母表已存在的遊戲做「上架到本平台」（見 aladdin-platform 的 ' +
                'aladdin_platform_game_vendor_platform_update_game_vendor_game）。本工具操作的是全平台共用母表，' +
                '結果與平台無關，不需要也不接受 platformId 參數。' +
                '用 gameVendorId+gameId 這組業務鍵判斷是新增還是更新（工具內部會自動查，不用先知道內部流水號 id）：' +
                '這個廠商底下已經有這個 gameId → 讀既有資料當基準值，只有你有帶的欄位會覆蓋，沒帶的欄位維持原值；' +
                '沒有 → 視為新增全新遊戲，此時 name 必填。' +
                'gameVendorId 必須是既有場館的 id（可用 aladdin_admin_game_vendor_admin_list_game_vendors 查母表，或用 ' +
                'aladdin_admin_game_vendor_admin_create_or_update_game_vendor 的讀回結果拿到）——注意：場館的內部 id 全域共用（admin 建立的 id，platform 端看到的也是同一個數字），' +
                '但新建立的場館預設不會出現在任何 platform 的清單裡，要先由 admin 端呼叫 ' +
                'aladdin_admin_game_vendor_admin_update_platform_game_vendor_status 為該場館啟用特定 platform，' +
                '否則 aladdin-platform 的 aladdin_platform_game_vendor_platform_list_game_vendors 查不到剛建立的場館。' +
                'squareImage/rectangleImage/bannerImage 這三個圖片欄位是「每個語言各自一張圖」，不是一張圖套用全部語言——' +
                '要幫哪個語言換圖，就在對應的 squareImages/rectangleImages/bannerImages 陣列裡帶一組 {code, filePath}（stdio 模式，' +
                '工程師本機直接執行時用）或 {code, fileId}（hosted 模式，企劃端遠端連線時用，fileId 來自先呼叫 POST /files 上傳的結果）——' +
                '兩者二選一，每筆項目只能帶其中一個，同時帶或都不帶都會回錯誤。若有任何一張圖上傳失敗，整支呼叫會直接中止、不會送出更新（避免部分寫入），' +
                '並在 errors 裡列出哪個語言失敗。' +
                'localizedNames 是遊戲名稱的多語系版本（跟 name 不是同一個欄位，name 是單一顯示名稱），' +
                '格式同樣是每個語言各帶一組 {code, value}，帶到的語言覆蓋既有值、沒帶到的語言維持原值。' +
                'prod 執行前確認（H36）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 AskUserQuestion' +
                '（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後才可以帶上 confirm 參數；' +
                '絕不能自行假設使用者同意。非 prod 環境（dev/pre/evi）不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                gameVendorId: z.number().int().describe('廠商場館 id，必填'),
                gameId: z.string().min(1).describe('廠商系統裡的原始遊戲代碼，同一廠商底下須唯一——工具用它判斷這筆是新增還是更新'),
                name: z.string().optional().describe('遊戲名稱（單一顯示名稱，非多語系）。若 gameId 是全新遊戲則必填；若是編輯既有遊戲，不帶則沿用既有值'),
                localizedNames: localizedTextSchema.describe('遊戲名稱的多語系版本，每個要更新的語言各帶一組 {code, value}，編輯既有遊戲時不帶則沿用既有值'),
                displayTag: z.enum(GAME_TAG_KEYS).optional().describe('遊戲分類：unknown/slot(電子)/board(棋牌)/fish(捕魚)/live(真人)/sport(體育)/eSport(電競)/lottery(彩票)，編輯既有遊戲時不帶則沿用既有值'),
                rebateTag: z.enum(GAME_TAG_KEYS).optional().describe('返水分類，選項同 displayTag，編輯既有遊戲時不帶則沿用既有值'),
                openMode: z.enum(OPEN_MODE_KEYS).optional().describe('開啟模式：embedded(內嵌，預設)/externalBrowser/embeddedWithTitle/inHouseGame/inHouseSport，編輯既有遊戲時不帶則沿用既有值'),
                sortOrder: z.number().int().optional().describe('排序，編輯既有遊戲時不帶則沿用既有值'),
                demo: z.boolean().optional().describe('是否為試玩，編輯既有遊戲時不帶則沿用既有值'),
                squareImages: imageUploadSchema.describe('方形圖，每個要更新的語言各帶一組 {code, filePath} 或 {code, fileId}（二選一），編輯既有遊戲時不帶則沿用既有值'),
                rectangleImages: imageUploadSchema.describe('直方圖，格式同 squareImages'),
                bannerImages: imageUploadSchema.describe('橫幅圖，格式同 squareImages'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            const { gameVendorId, gameId, name, displayTag, rebateTag, openMode, squareImages, rectangleImages, bannerImages, localizedNames, confirm, ...rest } = input;
            assertProdConfirmed(confirm);

            const found = await findGameRowByBusinessKey(gameVendorId, gameId);
            if (found.listR?.failed) return asErrorResult(found.listR);
            const matchedRow = found.matchedRow;
            const isCreate = !matchedRow;

            if (isCreate && !name) {
                return asTextResult({
                    success: false,
                    message: `在廠商 ${ gameVendorId } 底下找不到 gameId=${ gameId } 的既有遊戲（已掃描全部 ${ found.scannedPages } 頁），視為新增；新增全新遊戲時 name 必填。`,
                });
            }

            let base;
            if (matchedRow) {
                const getR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.GetGameVendorGameForEdit(matchedRow.id));
                if (getR.failed) return asErrorResult(getR);
                base = getR.data?.game;
            }

            const squareResult = await uploadLocalizedImages('square', squareImages, base?.squareImage);
            const rectangleResult = await uploadLocalizedImages('rectangle', rectangleImages, base?.rectangleImage);
            const bannerResult = await uploadLocalizedImages('banner', bannerImages, base?.bannerImage);
            const uploadErrors = [ ...squareResult.errors, ...rectangleResult.errors, ...bannerResult.errors ];
            if (uploadErrors.length > 0) {
                return asTextResult({ success: false, message: '部分圖片上傳失敗，未送出任何更新（避免部分寫入）', errors: uploadErrors });
            }

            const merged = GameEdit.create({
                ...(base ?? {}),
                id: matchedRow?.id,
                gameVendorId,
                gameId,
                ...Object.fromEntries(Object.entries(rest).filter(([ , v ]) => v !== undefined)),
                name: name ?? base?.name,
                displayTag: displayTag ? GAME_TAG_MAP[ displayTag ] : base?.displayTag,
                rebateTag: rebateTag ? GAME_TAG_MAP[ rebateTag ] : base?.rebateTag,
                openMode: openMode ? OPEN_MODE_MAP[ openMode ] : base?.openMode,
                ...(squareImages ? { squareImage: squareResult.merged } : {}),
                ...(rectangleImages ? { rectangleImage: rectangleResult.merged } : {}),
                ...(bannerImages ? { bannerImage: bannerResult.merged } : {}),
                ...(localizedNames ? { localizedName: mergeLocalizedStrings(localizedNames, base?.localizedName) } : {}),
            });

            const writeR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.CreateOrUpdateGameVendorGame(merged));
            if (writeR.failed) return asErrorResult(writeR);

            if (matchedRow) {
                // 更新：id 本來就知道，直接讀回驗證。
                const checkR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.GetGameVendorGameForEdit(matchedRow.id));
                return asTextResult({
                    success: true,
                    message: '更新成功',
                    game: checkR.success ? checkR.data?.game : null,
                });
            }

            // 新增：CreateOrUpdateGameVendorGame 不會直接回傳新 id，只能查回驗證。比照舊版
            // create_game.ts 的作法，只用便宜的第一頁查找（不是像上面業務鍵定位那樣逐頁掃到底）
            // ——這裡純粹是「順手驗證剛剛真的寫進去了」，不是本工具賴以判斷新增/更新的關鍵路徑，
            // 沒必要為了它把每次新增的成本翻倍成兩次逐頁全掃。
            const listResult = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGames(gameVendorId, 1, 50));
            const matched = listResult.success
                ? listResult.data?.rows?.find((row) => row.gameId === gameId)
                : undefined;

            return asTextResult({
                success: true,
                message: '建立成功',
                game: matched ?? null,
                ...(!matched && listResult.success ? { note: '該廠商前 50 筆內沒找到，可能分頁較後面，非失敗' } : {}),
            });
        },
    );
}
