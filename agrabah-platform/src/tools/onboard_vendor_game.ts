/**
 * tools/onboard_vendor_game.ts — agrabah_platform_onboard_vendor_game
 *
 * rajah: GameVendorPlatform.GetGameVendorGameForEdit / UpdateGameVendorGame
 * （game_back_office.rajah:1074, 1076）
 *
 * 重要：這不是「建立全新遊戲」。platform 後台沒有這個能力——`UpdateGameVendorGame`
 * 依賴的 `ensurePlatformGameVendorGame`（agrabah 後端）會先查「廠商遊戲母表」
 * （game_vendor_games，全平台共用、通常由廠商同步 job 自動帶入）有沒有這個
 * gameVendorId+gameId 組合，沒有就直接回錯（gameVendorGameNotExists=303），
 * 不會憑空生資料。此工具做的是「把母表已存在、但本平台還沒設定過的遊戲，
 * 上架到本平台（或更新既有的平台顯示設定）」。若要新增一款全新遊戲（母表也沒有），
 * 要用 agrabah-admin 的 agrabah_admin_create_game。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameVendorGameEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { AgrabahErrorCodeEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { IMAGE_SHAPE_MAP, UPLOAD_TYPE_GAME } from '../const.ts';

// H9（plan.md D5 / §4.3）：filePath（stdio，本機工程師連線）與 fileId（hosted，
// 企劃端遠端連線，先呼叫 POST /files 上傳取得）二選一並存，不用 zod union——
// union 對「兩者都帶」這種情況預設會靜默用第一個匹配成員、忽略多餘欄位，
// 無法產生 AC4 要求的明確錯誤；改用兩個都 optional 的欄位，在 handler 內用
// 模式判斷明確擋下「都帶」與「都沒帶」兩種情況，見 uploadLocalizedImages()。
const imageUploadSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US——必須是這個平台已啟用的語言，且是這張圖要顯示給哪個語言看'),
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
 * 這個欄位在後端設計上是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制
 * （見 abu/platform 的 ImageUploadCard.vue / PropertyFileEdit.vue，每次上傳只綁一個語言 tab）。
 * 所以呼叫端要為每個想更新的語言各自帶一組 {code, filePath|fileId}；每筆各自呼叫一次
 * GetUploadGameImageToken 拿新 token 再上傳（token 單次使用、1 小時過期）。
 *
 * H9：fileId（hosted）先解析成本機暫存路徑，再餵進與 filePath（stdio）完全相同的
 * 下游上傳流程（GetUploadGameImageToken → uploadFile）——上傳到 agrabah 的既有機制
 * 完全不變，hosted 模式只是多一步「fileId → 本機路徑」的解析。
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

        const tokenR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetUploadGameImageToken(UPLOAD_TYPE_GAME, IMAGE_SHAPE_MAP[ shape ]));
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

export function registerOnboardVendorGameTool(server: McpServer): void {
    server.registerTool(
        'agrabah_platform_onboard_vendor_game',
        {
            title: 'Onboard (or update) a vendor game on this platform',
            description:
                '把某個三方遊戲廠商「已存在於廠商遊戲母表」的一款遊戲，上架到本平台（若本平台是第一次設定該遊戲，' +
                '後端會自動建立平台專屬設定紀錄；若已存在則是更新）——不是新增全新遊戲。' +
                '母表資料通常由廠商同步 job 自動帶入，若呼叫失敗且 errorCode=303（gameVendorGameNotExists），' +
                '代表母表根本沒有這個 gameId，此工具無法處理，要新增全新遊戲請改用 agrabah-admin MCP 的 ' +
                'agrabah_admin_create_game。呼叫前會先讀既有設定當基準值，只有你有帶的欄位會覆蓋，' +
                '沒帶的欄位維持原值，完成後自動讀回驗證。' +
                '注意：displayTag/rebateTag/badgeId 是後端既有分類清單的 id（本 POC 未提供對應查詢 tool，' +
                '不確定合法值時應先詢問操作者，不要亂猜數字）。' +
                'squareImage/rectangleImage/bannerImage 這三個圖片欄位是「每個語言各自一張圖」，不是一張圖套用全部語言——' +
                '要幫哪個語言換圖，就在對應的 squareImages/rectangleImages/bannerImages 陣列裡帶一組 {code, filePath}（stdio 模式，' +
                '工程師本機直接執行時用）或 {code, fileId}（hosted 模式，企劃端遠端連線時用，fileId 來自先呼叫 POST /files 上傳的結果）——' +
                '兩者二選一，每筆項目只能帶其中一個，同時帶或都不帶都會回錯誤。若有任何一張圖上傳失敗，整支呼叫會直接中止、不會送出更新（避免部分寫入），' +
                '並在 errors 裡列出哪個語言失敗。' +
                'localizedNames 是遊戲名稱的多語系版本（跟 name 不是同一個欄位，name 是單一顯示名稱），' +
                '格式同樣是每個語言各帶一組 {code, value}，帶到的語言覆蓋既有值、沒帶到的語言維持原值。',
            inputSchema: {
                gameVendorId: z.number().int().describe('遊戲廠商 id，來自 agrabah_platform_list_game_vendors'),
                gameId: z.string().min(1).describe('廠商遊戲 id（廠商系統裡的原始遊戲代碼，不是本平台的流水號）'),
                name: z.string().optional().describe('遊戲名稱（單一顯示名稱，非多語系），不帶則沿用既有值'),
                localizedNames: localizedTextSchema.describe('遊戲名稱的多語系版本，每個要更新的語言各帶一組 {code, value}，不帶則沿用既有值'),
                sortOrder: z.number().int().min(1).max(100000).optional().describe('前端排序，1~100000，不帶則沿用既有值'),
                displayTag: z.number().int().optional().describe('遊戲分類 id（GameDisplayTagEnum 之類的既有分類），不帶則沿用既有值'),
                rebateTag: z.number().int().optional().describe('平台返水標籤 id，不帶則沿用既有值'),
                badgeId: z.number().int().optional().describe('指定角標 id，不帶則沿用既有值'),
                frontendGroupTag: z.array(z.number().int()).optional().describe('前台遊戲標籤 id 陣列，不帶則沿用既有值'),
                validBetThreshold: z.number().int().optional().describe('有效投注金額門檻，不帶則沿用既有值'),
                squareImages: imageUploadSchema.describe('方形圖，每個要更新的語言各帶一組 {code, filePath} 或 {code, fileId}（二選一），不帶則沿用既有值'),
                rectangleImages: imageUploadSchema.describe('直方圖，格式同 squareImages'),
                bannerImages: imageUploadSchema.describe('橫幅圖，格式同 squareImages'),
            },
        },
        async (input) => {
            const { gameVendorId, gameId, squareImages, rectangleImages, bannerImages, localizedNames, ...overrides } = input;

            const getR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetGameVendorGameForEdit(gameVendorId, gameId));
            if (getR.failed) {
                return asErrorResult(getR, {
                    hint: getR.errorCode === AgrabahErrorCodeEnum.gameVendorGameNotExists
                        ? '廠商遊戲母表沒有這個 gameId，這是全新遊戲，此工具無法憑空建立，請改用 agrabah-admin 的 agrabah_admin_create_game。'
                        : undefined,
                });
            }

            const base = getR.data?.game;

            const squareResult = await uploadLocalizedImages('square', squareImages, base?.squareImage);
            const rectangleResult = await uploadLocalizedImages('rectangle', rectangleImages, base?.rectangleImage);
            const bannerResult = await uploadLocalizedImages('banner', bannerImages, base?.bannerImage);
            const uploadErrors = [ ...squareResult.errors, ...rectangleResult.errors, ...bannerResult.errors ];
            if (uploadErrors.length > 0) {
                return asTextResult({ success: false, message: '部分圖片上傳失敗，未送出任何更新（避免部分寫入）', errors: uploadErrors });
            }

            const merged = PlatformGameVendorGameEdit.create({
                ...(base ?? {}),
                ...Object.fromEntries(Object.entries(overrides).filter(([ , v ]) => v !== undefined)),
                ...(squareImages ? { squareImage: squareResult.merged } : {}),
                ...(rectangleImages ? { rectangleImage: rectangleResult.merged } : {}),
                ...(bannerImages ? { bannerImage: bannerResult.merged } : {}),
                ...(localizedNames ? { localizedName: mergeLocalizedStrings(localizedNames, base?.localizedName) } : {}),
            });

            const updateR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateGameVendorGame(gameVendorId, gameId, merged));
            if (updateR.failed) {
                return asErrorResult(updateR);
            }

            const checkR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetGameVendorGameForEdit(gameVendorId, gameId));
            return asTextResult({
                success: true,
                message: '上架/更新成功',
                game: checkR.success ? checkR.data?.game : null,
            });
        },
    );
}
