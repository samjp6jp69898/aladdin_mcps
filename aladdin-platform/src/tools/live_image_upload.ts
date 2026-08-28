/**
 * tools/live_image_upload.ts — **共用 helper，不是一支 tool**（沒有 registerTool，不會出現在
 * tools/index.ts 的註冊清單裡）。
 *
 * 存在理由：直播管理底下兩支寫入型 tool（`create_or_update_live_tab` 的頁籤圖示、
 * `create_or_update_live_category` 的四張分類圖）都要把「呼叫端給的圖片」變成「後端檔案路徑」，
 * 而且都要走同一條路：`LivePlatform.GetUploadImageToken(type)`（rajah/services/
 * live_back_office.rajah:81）取一次性 token → `session.ts` 的 `uploadFile()` 上傳 → 拿回路徑。
 * mcps/README.md 第二節第 2 步要求「兩個以上 tool 檔案會用到的東西不要各自宣告一份」，
 * 但也要求 `const.ts` 只放 enum 對照/常數、不要塞業務邏輯，因此這段共用流程獨立一個檔案。
 *
 * 關於 `GetUploadImageToken` 為什麼沒有被包成一支獨立的對外 tool
 * （method-category-checklist.md 第 8 節「上傳/建立用 token 類」的判斷）：
 * - 它單獨回傳一個 token 字串，對呼叫端 agent 沒有任何可用性——真正要用這個 token 得對
 *   `${API_URL}/upload` 發 multipart 請求，那是 `session.ts` 的 `uploadFile()` 在做的事，
 *   不是 agent 能自己完成的步驟。單獨曝露只會讓 agent 拿到一個用不掉的憑證。
 * - 依 tool-naming-convention.md「一支 tool 內部呼叫多支 method（Get + 寫入）用寫入那支命名」，
 *   它是寫入流程的內部手段，不是獨立身分。
 * - 第 8 節同時要求查證有效期限／是否綁定呼叫者／多次呼叫是否使前一個失效，並在說明中標註
 *   「有時效性，勿快取重複使用」。查證結果（agrabah/src/managers/file_manager.ts）：
 *   有效期 1 小時（`FILE_DATA_EXPIRED_TIME = 60 * 60`）；**是一次性的**——`FileData.status`
 *   走 `waiting → uploading → uploaded`，`upload()` 對非 `waiting` 狀態的 token 直接拒絕
 *   （`fileTokenStateNotMatch`），所以同一個 token 用過就不能再用；**但 token 本身不綁定呼叫者
 *   身分**（`cacheKey` 只是 `file:{短uuid}`，不含任何 context/使用者資訊）——這是後端既有事實，
 *   不是本層能改的。
 *   本檔的做法是**每一張圖各自取一次新 token、絕不重用**（比照既有的
 *   create_home_page_popup.ts），而且 token 從頭到尾只存在於這支函式內、不會回傳給呼叫端，
 *   所以「勿快取重複使用」在結構上就成立，呼叫端沒有誤用的空間。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com）：`LiveUploadImageEnum` 五個值
 * （tabIcon=1／categoryIcon=2／categoryBackground=3／categorySquareImage=4／
 * categoryBannerImage=5，rajah:16-22）都能成功取得 token（長度 22），
 * 傳入不在列舉內的值（99）回 errorCode=9（invalidData）。
 */
import { z } from 'zod';

import { remote, withAutoRelogin, uploadFile, currentIdentityForFiles } from '../session.ts';
import { resolveFileIdForIdentity } from '../files.ts';

/** LiveUploadImageEnum（rajah/services/live_back_office.rajah:16-22）。 */
export const LIVE_UPLOAD_IMAGE_TYPE = {
    tabIcon: 1,
    categoryIcon: 2,
    categoryBackground: 3,
    categorySquareImage: 4,
    categoryBannerImage: 5,
} as const;
export type LiveUploadImageType = (typeof LIVE_UPLOAD_IMAGE_TYPE)[keyof typeof LIVE_UPLOAD_IMAGE_TYPE];

export type LiveImageInput = { path?: string; filePath?: string; fileId?: string };

/** 三選一的圖片輸入 schema，兩支 live 寫入型 tool 共用。 */
export const liveImageInputSchema = z.object({
    path: z.string().optional().describe(
        '直接指定既有的後端圖片路徑（例如從對應的 get_* 工具讀到的 /static/live/xxxx）；不會重新上傳',
    ),
    filePath: z.string().optional().describe(
        'stdio 模式專用：本機圖片檔案的絕對路徑，由本工具負責取上傳 token 並上傳',
    ),
    fileId: z.string().optional().describe(
        'hosted 模式專用：先呼叫 POST /files 上傳圖片取得的 fileId',
    ),
}).describe('path / filePath / fileId 三選一，不可同時提供多個、也不可都不提供');

/**
 * 把一個圖片輸入解析成後端檔案路徑字串。
 * - `path`：原樣回傳，不做任何上傳。
 * - `filePath`/`fileId`：取一次性上傳 token 後上傳，回傳後端給的新路徑。
 *
 * 失敗一律回 `null`，並把可讀的理由（含 label，讓呼叫端知道是哪個欄位出錯）推進 `errors`，
 * 由呼叫端決定要不要整批中止——這裡刻意不自己拋例外，因為兩支 tool 都需要「先把所有欄位的
 * 參數問題一次收集完再回報」，而不是遇到第一個錯就中斷。
 */
export async function resolveLiveImagePath(
    label: string,
    imageType: LiveUploadImageType,
    input: LiveImageInput,
    errors: string[],
): Promise<string | null> {
    const provided = [ input.path, input.filePath, input.fileId ].filter((v) => v !== undefined);
    if (provided.length === 0) {
        errors.push(`[${ label }] path / filePath / fileId 三者都沒提供`);
        return null;
    }
    if (provided.length > 1) {
        errors.push(`[${ label }] path / filePath / fileId 只能擇一提供`);
        return null;
    }

    if (input.path !== undefined) return input.path;

    let localPath: string;
    if (input.fileId !== undefined) {
        const identity = currentIdentityForFiles();
        if (identity === undefined) {
            errors.push(`[${ label }] fileId 僅限 hosted 模式使用；目前是 stdio 連線，請改用 filePath`);
            return null;
        }
        const resolved = resolveFileIdForIdentity(input.fileId, identity);
        if (!resolved.found) {
            errors.push(`[${ label }] fileId 無法使用（${ resolved.reason }）`);
            return null;
        }
        localPath = resolved.path;
    } else {
        localPath = input.filePath!;
    }

    // 每張圖各自取一次新 token，絕不重用（token 是一次性的，見檔頭第 8 節說明）。
    const tokenR = await withAutoRelogin(
        () => remote.liveBackOffice.livePlatform.GetUploadImageToken(imageType),
    );
    if (tokenR.failed || !tokenR.data?.token) {
        errors.push(`[${ label }] 取得上傳 token 失敗：errorCode=${ tokenR.errorCode } ${ tokenR.message }`);
        return null;
    }

    const uploadR = await uploadFile(tokenR.data.token, localPath);
    if (!uploadR.success) {
        errors.push(`[${ label }] ${ uploadR.message }`);
        return null;
    }

    return uploadR.path;
}
