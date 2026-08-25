/**
 * tools/update_game_vendor.ts — aladdin_platform_game_vendor_platform_update_game_vendor
 *
 * rajah: GameVendorPlatform.GetGameVendorForEdit / UpdateGameVendor
 * （game_back_office.rajah:1073-1076，@Permission "GameVendor.Vendor.Ops.Edit"）
 *
 * 這支更新的是「本平台看到的三方場館（廠商）顯示設定」（多語名稱、方形圖示、排序），
 * 不是建立全新場館——全新場館是 aladdin-admin server 的範圍。id 來自
 * aladdin_platform_game_vendor_platform_list_game_vendors 回傳的場館 id（同一顆 id
 * 全平台共用，但要先被 admin 端啟用給本平台才會出現在該清單）。
 *
 * PlatformGameVendorEdit.name 掛 @Readonly，本 tool 不開放編輯，呼叫時原樣帶回既有值。
 *
 * method-category-checklist.md 第 4 節「Upsert/先讀現值」套用：GetGameVendorForEdit
 * 與 UpdateGameVendor 是典型 sibling 對，本 tool 照該節要求先讀現值、只覆寫呼叫端明確
 * 帶的欄位、其餘（含未實測到的 squareImageWeb/squareImageMobile 既有值）原樣帶回，
 * 完成後 round-trip 讀回驗證。
 *
 * 2026-08-24 dev（pk-platform.alddev.com）實測發現的兩個資料陷阱，如實記錄：
 *
 * 1. sortOrder 欄位在 rajah 掛 `@Rules "Range(1,100000);Required"`，但實測直接送
 *    sortOrder=0（超出宣告的 1~100000 範圍）UpdateGameVendor 仍回 errorCode=0（成功）
 *    且真的持久化到 DB（後續 GetGameVendorForEdit 讀回確認是 0，已還原成原始值）。
 *    也就是後端**沒有**強制執行這條 rajah 宣告的驗證規則，是否為其他呼叫路徑（如前端
 *    表單本身擋掉）才生效尚不確定；本 tool 的 zod schema 仍照宣告值做用戶端防呆
 *    （min 1, max 100000），但呼叫端不應假設後端會擋下範圍外的值。
 *
 * 2. 對一個不存在的 id 呼叫 UpdateGameVendor（實測 id=999999999）同樣回 errorCode=0
 *    （成功），但沒有真的建立或修改任何紀錄（事後用 GetGameVendorForEdit 查同一 id
 *    仍是 errorCode=14 找不到）。呼叫方不能用「UpdateGameVendor 沒報錯」判斷這個 id
 *    真的存在或真的被改到。本 tool 因為照上面「先讀現值」的要求，一定會先呼叫
 *    GetGameVendorForEdit，id 不存在時會在這一步就先擋下並回報，不會讓呼叫端誤以為
 *    更新成功。
 *
 * 圖片上傳（squareImageWeb/squareImageMobile）沿用 onboard_vendor_game.ts 已驗證過的
 * 同款 {code, filePath|fileId} 二選一與逐語言上傳邏輯，但這次 dev 實測用的場館
 * （Jili）兩個圖片欄位本來就是空值，沒有實際測過「已有值時只覆蓋其中一個語言、其餘語言
 * 維持原值」這條路徑，如實告知：本 tool 這部分是複用已驗證模式、非本次獨立重新驗證。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameVendorEdit } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles, assertProdConfirmed, PROD_CONFIRM_TOKEN } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { IMAGE_SHAPE_MAP, UPLOAD_TYPE_VENDOR } from '../const.ts';

// H9 同構模式（見 onboard_vendor_game.ts 同段註解）：filePath（stdio）與 fileId（hosted）
// 二選一，用兩個都 optional 的欄位在 handler 內明確擋「都帶」與「都沒帶」。
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
 * 比照 onboard_vendor_game.ts 的 uploadLocalizedImages：每個語言各自一張圖，逐筆呼叫
 * GetUploadGameImageToken（uploadType=vendor）拿新 token 再上傳（token 單次使用、
 * 1 小時過期）。
 */
async function uploadLocalizedImages(
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

        const tokenR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetUploadGameImageToken(UPLOAD_TYPE_VENDOR, IMAGE_SHAPE_MAP.square));
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

export function registerUpdateGameVendorTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_update_game_vendor',
        {
            title: 'Update a game vendor’s display setting on this platform',
            description:
                '修改本平台「遊戲管理／廠商列表」中某個三方場館（廠商）的顯示設定：多語名稱' +
                '（localizedNames）、方形圖示（squareImageWeb/squareImageMobile）、排序（sortOrder）' +
                '（rajah: GameVendorPlatform.UpdateGameVendor，game_back_office.rajah:1076）。' +
                '不是建立全新場館，全新場館是 aladdin-admin server 的範圍；gameVendorId 必須來自 ' +
                'aladdin_platform_game_vendor_platform_list_game_vendors 回傳的 id（該場館要先被 admin ' +
                '端啟用給本平台才查得到）。name（單一顯示名稱）在後端是唯讀欄位，本工具不提供編輯，' +
                '呼叫前會先讀現值原樣帶回。呼叫前會先呼叫 GetGameVendorForEdit 讀現值，只覆蓋你有帶的' +
                '欄位，其餘（含未帶到的語言、圖片）維持原值，完成後自動讀回驗證。' +
                '2026-08-24 dev 實測發現兩個資料陷阱：(1) sortOrder 雖然 rajah 宣告 Range(1,100000)，' +
                '後端實測並未強制擋下範圍外的值（送 0 會被直接存入），本工具在 zod 層仍限制 1~100000 ' +
                '做用戶端防呆，但不保證後端一定會擋；(2) 對不存在的 gameVendorId 呼叫，後端不會回錯誤' +
                '（errorCode=0），但也不會真的寫入任何資料——本工具因為一定先呼叫 GetGameVendorForEdit ' +
                '讀現值，id 不存在時會在這一步先被擋下並回報，避免誤判成功。' +
                '圖片欄位是「每個語言各自一張圖」，要幫哪個語言換圖就在 squareImageWeb/squareImageMobile ' +
                '陣列裡帶一組 {code, filePath}（stdio 模式）或 {code, fileId}（hosted 模式，fileId 來自先呼叫 ' +
                'POST /files 上傳的結果）——二選一，同時帶或都不帶都會回錯誤；任一張圖上傳失敗，整支呼叫會' +
                '直接中止、不送出更新，避免部分寫入。' +
                'prod 執行前確認（H38 同構機制）：當這個 server 是正式環境（prod）時，執行本工具前必須先用 ' +
                'AskUserQuestion（或功能相同的方式）明確詢問使用者是否要在正式環境執行這個操作，取得明確同意後' +
                '才可以帶上 confirm 參數；絕不能自行假設使用者同意。非 prod 環境不需要、也會忽略 confirm 欄位。',
            inputSchema: {
                gameVendorId: z.number().int().describe('場館 id，來自 aladdin_platform_game_vendor_platform_list_game_vendors 回傳的 id'),
                localizedNames: localizedTextSchema.describe('場館名稱的多語系版本，每個要更新的語言各帶一組 {code, value}，不帶則沿用既有值'),
                sortOrder: z.number().int().min(1).max(100000).optional().describe(
                    '前端排序，1~100000，不帶則沿用既有值。注意：dev 實測後端未強制擋下超出範圍的值，此處限制僅為用戶端防呆。',
                ),
                squareImageWeb: imageUploadSchema.describe('廠商圖示（Web 端），每個要更新的語言各帶一組 {code, filePath} 或 {code, fileId}（二選一），不帶則沿用既有值'),
                squareImageMobile: imageUploadSchema.describe('廠商圖示（行動端），格式同 squareImageWeb'),
                confirm: z.string().optional().describe(
                    `正式環境（prod）專用的強制確認欄位；非 prod 環境會被忽略、不需提供。當這個 server 是正式環境時，` +
                    `必須先取得使用者明確同意，再帶上精確字串 "${ PROD_CONFIRM_TOKEN }" 才會執行，否則本工具會拒絕執行並回錯誤。`,
                ),
            },
        },
        async (input) => {
            const { gameVendorId, localizedNames, sortOrder, squareImageWeb, squareImageMobile, confirm } = input;
            assertProdConfirmed(confirm);

            const getR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetGameVendorForEdit(gameVendorId));
            if (getR.failed) {
                return asErrorResult(getR, {
                    hint: 'GetGameVendorForEdit 讀現值失敗（常見原因：id 不存在，或這個場館尚未被 admin 端啟用給本平台）。' +
                        'UpdateGameVendor 本身對不存在的 id 不會回錯誤也不會真的寫入，所以必須靠這一步先確認 id 真的存在。',
                });
            }
            const base = getR.data?.gameVendor;
            if (!base) return asTextResult({ success: false, message: '讀取目前設定失敗：後端回傳空值' });

            const squareWebResult = await uploadLocalizedImages(squareImageWeb, base.squareImageWeb);
            const squareMobileResult = await uploadLocalizedImages(squareImageMobile, base.squareImageMobile);
            const uploadErrors = [ ...squareWebResult.errors, ...squareMobileResult.errors ];
            if (uploadErrors.length > 0) {
                return asTextResult({ success: false, message: '部分圖片上傳失敗，未送出任何更新（避免部分寫入）', errors: uploadErrors });
            }

            const merged = PlatformGameVendorEdit.create({
                ...base,
                ...(sortOrder !== undefined ? { sortOrder } : {}),
                ...(localizedNames ? { localizedName: mergeLocalizedStrings(localizedNames, base.localizedName) } : {}),
                ...(squareImageWeb ? { squareImageWeb: squareWebResult.merged } : {}),
                ...(squareImageMobile ? { squareImageMobile: squareMobileResult.merged } : {}),
            });

            const updateR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.UpdateGameVendor(merged));
            if (updateR.failed) return asErrorResult(updateR);

            const checkR = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetGameVendorForEdit(gameVendorId));
            return asTextResult({
                success: true,
                message: '更新成功',
                gameVendor: checkR.success ? checkR.data?.gameVendor : null,
            });
        },
    );
}
