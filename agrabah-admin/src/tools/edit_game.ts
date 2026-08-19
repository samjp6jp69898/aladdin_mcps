/**
 * tools/edit_game.ts — agrabah_admin_edit_game
 *
 * rajah: GameVendorAdmin.ListGames（定位既有遊戲的內部 id）+ GetGameVendorGameForEdit(id) +
 * CreateOrUpdateGameVendorGame（game_back_office.rajah:300, 317, 319）
 *
 * 跟 create_game.ts 的差異：這支是「編輯既有遊戲」，用業務鍵 gameVendorId+gameId 定位
 * （GetGameVendorGameForEdit 本身只吃內部流水號 id，所以要先用 ListGames 查一次換到 id），
 * 讀既有資料當基準值、只覆蓋你有帶的欄位——包含圖片上傳。這是唯一支援圖片上傳的 admin tool。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GameEdit } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile } from '../session.ts';
import { asTextResult } from '../mcp_result.ts';
import { GAME_TAG_MAP, GAME_TAG_KEYS, OPEN_MODE_MAP, OPEN_MODE_KEYS, IMAGE_SHAPE_MAP } from '../const.ts';

const imageUploadSchema = z.array(z.object({
    code: z.string().describe('語系代碼，例如 zh-CN、zh-TW、en-US——是這張圖要顯示給哪個語言看，不是平台代碼'),
    filePath: z.string().describe('本機圖片檔案的絕對路徑'),
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
 * 呼叫端要為每個想更新的語言各自帶一組 {code, filePath}；每筆各自呼叫一次
 * GetUploadGameVendorGameImageToken 拿新 token 再上傳（token 單次使用、1 小時過期）。
 */
async function uploadLocalizedImages(
    shape: keyof typeof IMAGE_SHAPE_MAP,
    uploads: { code: string; filePath: string }[] | undefined,
    existing: { code: string; value: string }[] | undefined,
): Promise<{ merged: { code: string; value: string }[]; errors: string[] }> {
    const merged = [ ...(existing ?? []) ];
    const errors: string[] = [];
    if (!uploads || uploads.length === 0) return { merged, errors };

    for (const { code, filePath } of uploads) {
        const tokenR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.GetUploadGameVendorGameImageToken(IMAGE_SHAPE_MAP[ shape ]));
        if (tokenR.failed || !tokenR.data?.token) {
            errors.push(`[${ code }] 取得上傳 token 失敗：errorCode=${ tokenR.errorCode } ${ tokenR.message }`);
            continue;
        }

        const uploadR = await uploadFile(tokenR.data.token, filePath);
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

export function registerEditGameTool(server: McpServer): void {
    server.registerTool(
        'agrabah_admin_edit_game',
        {
            title: 'Edit an existing vendor game (including image uploads)',
            description:
                '編輯一款「已存在」的廠商遊戲（rajah: GameVendorAdmin.CreateOrUpdateGameVendorGame 的更新語意）——' +
                '要新增全新遊戲請用 agrabah_admin_create_game，這支只處理既有遊戲。' +
                '本工具操作的是全平台共用母表，結果與平台無關，不需要也不接受 platformId 參數。' +
                '用 gameVendorId+gameId 這組業務鍵定位（不用先知道內部流水號 id，工具內部會自動查）。' +
                '讀既有資料當基準值，只有你有帶的欄位會覆蓋，沒帶的欄位維持原值，完成後自動讀回驗證。' +
                'squareImage/rectangleImage/bannerImage 這三個圖片欄位是「每個語言各自一張圖」，不是一張圖套用全部語言——' +
                '要幫哪個語言換圖，就在對應的 squareImages/rectangleImages/bannerImages 陣列裡帶一組 {code, filePath}，' +
                'filePath 是本機圖片檔案的絕對路徑。若有任何一張圖上傳失敗，整支呼叫會直接中止、不會送出更新（避免部分寫入），' +
                '並在 errors 裡列出哪個語言失敗。' +
                'localizedNames 是遊戲名稱的多語系版本（跟 name 不是同一個欄位，name 是單一顯示名稱），' +
                '格式同樣是每個語言各帶一組 {code, value}，帶到的語言覆蓋既有值、沒帶到的語言維持原值。',
            inputSchema: {
                gameVendorId: z.number().int().describe('廠商場館 id'),
                gameId: z.string().min(1).describe('廠商系統裡的原始遊戲代碼，用來定位既有遊戲（同一廠商底下唯一）'),
                name: z.string().optional().describe('遊戲名稱（單一顯示名稱，非多語系），不帶則沿用既有值'),
                localizedNames: localizedTextSchema.describe('遊戲名稱的多語系版本，每個要更新的語言各帶一組 {code, value}，不帶則沿用既有值'),
                displayTag: z.enum(GAME_TAG_KEYS).optional().describe('遊戲分類：unknown/slot(電子)/board(棋牌)/fish(捕魚)/live(真人)/sport(體育)/eSport(電競)/lottery(彩票)，不帶則沿用既有值'),
                rebateTag: z.enum(GAME_TAG_KEYS).optional().describe('返水分類，選項同 displayTag，不帶則沿用既有值'),
                openMode: z.enum(OPEN_MODE_KEYS).optional().describe('開啟模式：embedded/externalBrowser/embeddedWithTitle/inHouseGame/inHouseSport，不帶則沿用既有值'),
                sortOrder: z.number().int().optional().describe('排序，不帶則沿用既有值'),
                demo: z.boolean().optional().describe('是否為試玩，不帶則沿用既有值'),
                squareImages: imageUploadSchema.describe('方形圖，每個要更新的語言各帶一組 {code, filePath}，不帶則沿用既有值'),
                rectangleImages: imageUploadSchema.describe('直方圖，格式同 squareImages'),
                bannerImages: imageUploadSchema.describe('橫幅圖，格式同 squareImages'),
            },
        },
        async (input) => {
            const { gameVendorId, gameId, displayTag, rebateTag, openMode, squareImages, rectangleImages, bannerImages, localizedNames, ...rest } = input;

            // GetGameVendorGameForEdit 只吃內部流水號，先用 ListGames 把 gameId 換成 id。
            const listR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGames(gameVendorId, 1, 200));
            if (listR.failed) return asTextResult({ success: false, errorCode: listR.errorCode, message: listR.message });

            const matchedRow = listR.data?.rows?.find((row) => row.gameId === gameId);
            if (!matchedRow) {
                return asTextResult({
                    success: false,
                    message: `在廠商 ${ gameVendorId } 底下找不到 gameId=${ gameId } 的遊戲（已檢查前 200 筆）。若這是全新遊戲請改用 agrabah_admin_create_game；若該廠商遊戲數超過 200 筆導致查不到，需回報。`,
                });
            }

            const getR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.GetGameVendorGameForEdit(matchedRow.id));
            if (getR.failed) return asTextResult({ success: false, errorCode: getR.errorCode, message: getR.message });

            const base = getR.data?.game;

            const squareResult = await uploadLocalizedImages('square', squareImages, base?.squareImage);
            const rectangleResult = await uploadLocalizedImages('rectangle', rectangleImages, base?.rectangleImage);
            const bannerResult = await uploadLocalizedImages('banner', bannerImages, base?.bannerImage);
            const uploadErrors = [ ...squareResult.errors, ...rectangleResult.errors, ...bannerResult.errors ];
            if (uploadErrors.length > 0) {
                return asTextResult({ success: false, message: '部分圖片上傳失敗，未送出任何更新（避免部分寫入）', errors: uploadErrors });
            }

            const merged = GameEdit.create({
                ...(base ?? {}),
                id: matchedRow.id,
                gameVendorId,
                gameId,
                ...Object.fromEntries(Object.entries(rest).filter(([ , v ]) => v !== undefined)),
                displayTag: displayTag ? GAME_TAG_MAP[ displayTag ] : base?.displayTag,
                rebateTag: rebateTag ? GAME_TAG_MAP[ rebateTag ] : base?.rebateTag,
                openMode: openMode ? OPEN_MODE_MAP[ openMode ] : base?.openMode,
                ...(squareImages ? { squareImage: squareResult.merged } : {}),
                ...(rectangleImages ? { rectangleImage: rectangleResult.merged } : {}),
                ...(bannerImages ? { bannerImage: bannerResult.merged } : {}),
                ...(localizedNames ? { localizedName: mergeLocalizedStrings(localizedNames, base?.localizedName) } : {}),
            });

            const updateR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.CreateOrUpdateGameVendorGame(merged));
            if (updateR.failed) return asTextResult({ success: false, errorCode: updateR.errorCode, message: updateR.message });

            const checkR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.GetGameVendorGameForEdit(matchedRow.id));
            return asTextResult({
                success: true,
                message: '更新成功',
                game: checkR.success ? checkR.data?.game : null,
            });
        },
    );
}
