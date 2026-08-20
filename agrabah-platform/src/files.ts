/**
 * files.ts — POST /files 的暫存目錄管理（D5 / plan.md §4.3 / H8）。
 *
 * 職責：
 *   - 驗證上傳內容（大小上限、magic bytes 型別白名單），不信任 client 提供
 *     的 Content-Type 或副檔名
 *   - fileId 產生（randomBytes，不可猜測）與身分綁定（記憶體 registry，
 *     供 H9 消費前查詢用）
 *   - 落地檔名一律 `<fileId>.<由 magic bytes 推導出的副檔名>`，完全不使用
 *     使用者提供的檔名——這支模組從頭到尾沒有讀取過上傳檔案的原始檔名，
 *     結構上就不存在 `../` 路徑逃逸的輸入管道
 *   - 配額（單一身分 / 全域總量）與清理策略
 *
 * 型別白名單只有 png/jpeg/webp（依 source-first 查證：agrabah 這支端點的
 * 下游 agrabah/src/managers/file_manager.ts + gate/handlers/file_handler.ts
 * 對上傳內容完全沒有型別驗證，只在決定要不要做加密副本時看副檔名字串，
 * 不驗證內容本身——equivalently 我們這層是唯一的型別防線，沒有它就是一個
 * 通往公司 dev CDN 的匿名檔案投放管道）。SVG 故意不放進白名單：它是文字格式
 * 而非本模組認得的三種二進位簽章，可內嵌 script，常被誤當圖片放行。
 *
 * 清理策略：**setInterval 週期性排程**（不是「每次上傳順手清」）。理由：
 * 上傳頻率不可預期（企劃可能整天只上傳一次），順手清理無法保證過期檔案被
 * 及時清掉；週期排程無論有沒有新上傳都會定期回收。這是 CLAUDE.md 允許的
 * 「setInterval 這類週期性排程器」，不是用等待解決正確性問題。保留時長與
 * 清理週期見下方常數；`cleanupExpiredFiles()` 額外開放自訂 ttlMs/nowMs 供
 * 測試直接呼叫驗證，不必真的等待。
 *
 * 大小與配額上限可用環境變數覆蓋（用途同 TOKENS_PATH 的 override 慣例）：
 * 測試時可調小以驗證配額擋得住，而不必真的塞爆 500MB 磁碟空間。
 */

import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync, unlinkSync, existsSync, realpathSync, readdirSync, statSync } from 'node:fs';
import { join, sep } from 'node:path';

export const TMP_DIR = process.env.AGRABAH_PLATFORM_FILES_TMP_DIR
    ?? new URL('../tmp-uploads/', import.meta.url).pathname;
mkdirSync(TMP_DIR, { recursive: true });

// D5 前提：遊戲圖示 <1MB；訂一個有餘裕但仍能擋住異常大檔的上限。
function maxFileSizeBytes(): number {
    return Number(process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES ?? 3 * 1024 * 1024); // 3MB
}

// AC 建議值：單一身分 50MB、全域總量 500MB。
function maxBytesPerIdentity(): number {
    return Number(process.env.AGRABAH_PLATFORM_FILES_MAX_PER_IDENTITY_BYTES ?? 50 * 1024 * 1024);
}

function maxTotalBytes(): number {
    return Number(process.env.AGRABAH_PLATFORM_FILES_MAX_TOTAL_BYTES ?? 500 * 1024 * 1024);
}

// 保留時長與清理週期。企劃上傳完通常會在同一輪對話裡立刻被 tool 消費掉，
// 24 小時已遠超正常使用情境，同時給跨日重試留餘裕。
const RETENTION_MS = 24 * 60 * 60 * 1000;
const CLEANUP_INTERVAL_MS = 15 * 60 * 1000;

interface FileEntry {
    identity: string;
    ext: string;
    size: number;
    uploadedAtMs: number;
}

// fileId -> 元資料。只存在記憶體：這本來就是「暫存」目錄（D5 §4.3），檔案
// 本身也會在 RETENTION_MS 內被清掉；行程重啟導致 registry 清空與這個設計
// 前提一致（重啟後暫存檔視為失效，消費端一律以 registry 為準，不直接信任
// 磁碟上還留著的檔案）。
const registry = new Map<string, FileEntry>();

export type MagicByteType = 'png' | 'jpeg' | 'webp';

const EXT_BY_TYPE: Record<MagicByteType, string> = { png: 'png', jpeg: 'jpg', webp: 'webp' };

/**
 * 用 magic bytes（檔頭）判斷型別，不信任 client 提供的 Content-Type 或
 * 上傳檔名副檔名。只認得 png / jpeg / webp 三種二進位簽章；任何其他內容
 * （含文字檔改副檔名、SVG）一律回傳 null。
 */
export function detectImageType(bytes: Uint8Array): MagicByteType | null {
    if (
        bytes.length >= 8 &&
        bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
        bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
    ) {
        return 'png';
    }
    if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
        return 'jpeg';
    }
    if (
        bytes.length >= 12 &&
        bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // "RIFF"
        bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // "WEBP"
    ) {
        return 'webp';
    }
    return null;
}

/** fileId：randomBytes 產生，不可猜測、也不編碼身分——身分綁定放 registry。 */
function generateFileId(): string {
    return randomBytes(32).toString('base64url');
}

// review 挖到的真實問題：配額原本是照 bytes.length（邏輯位元組數）計費，但
// 檔案系統實際配置是以區塊為單位（APFS/ext4 常見 4096 bytes），一堆最小
// 8 bytes 的檔案（detectImageType 認得的最短合法簽章）在配額帳本上幾乎不
// 計錢，實際磁碟卻是整份 4096 bytes 起跳——實測 3000 個 8 bytes 檔案帳本只
// 記 24000 bytes，實際吃掉 12MB，放大約 500 倍，等於配額形同虛設、擋不住
// 短時間塞爆磁碟（risk_notes 明講磁碟塞滿會連帶打死同機的 tg-dispatch 正式
// 服務）。修法：配額計費一律以此區塊大小為下限，不管檔案邏輯多小，寫進
// registry 的 size 與寫入磁碟的實際 bytes 內容解耦（落地檔案仍是真實大小，
// 只有「這筆帳算多少錢」墊高到區塊大小）。
const FS_BLOCK_SIZE_BYTES = 4096;

function accountedSize(byteLength: number): number {
    return Math.max(byteLength, FS_BLOCK_SIZE_BYTES);
}

function currentUsage(): { total: number; byIdentity: Map<string, number> } {
    let total = 0;
    const byIdentity = new Map<string, number>();
    for (const entry of registry.values()) {
        total += entry.size;
        byIdentity.set(entry.identity, (byIdentity.get(entry.identity) ?? 0) + entry.size);
    }
    return { total, byIdentity };
}

export type SaveFileResult =
    | { success: true; fileId: string }
    | { success: false; errorMessage: string };

/**
 * 驗證 + 落地一次上傳。所有拒絕路徑（大小、型別、配額）都在 writeFileSync
 * 之前判定，被拒絕的內容不會有任何 bytes 落地到暫存目錄。
 */
export function saveUploadedFile(identity: string, bytes: Uint8Array): SaveFileResult {
    if (bytes.length === 0) {
        return { success: false, errorMessage: '空檔案' };
    }

    const maxFileSize = maxFileSizeBytes();
    if (bytes.length > maxFileSize) {
        return { success: false, errorMessage: `檔案大小超過上限（${ maxFileSize } bytes）` };
    }

    const type = detectImageType(bytes);
    if (!type) {
        return { success: false, errorMessage: '型別不在白名單內（僅接受 png/jpeg/webp，以檔案內容 magic bytes 判定，不採信 Content-Type 或副檔名）' };
    }

    const charged = accountedSize(bytes.length);

    const usage = currentUsage();
    const maxTotal = maxTotalBytes();
    if (usage.total + charged > maxTotal) {
        return { success: false, errorMessage: '暫存目錄總容量已達上限，請稍後再試或聯絡工程師清理' };
    }
    const maxPerIdentity = maxBytesPerIdentity();
    const identityUsage = usage.byIdentity.get(identity) ?? 0;
    if (identityUsage + charged > maxPerIdentity) {
        return { success: false, errorMessage: `你的暫存用量已達單人上限（${ maxPerIdentity } bytes），請稍後再試` };
    }

    const fileId = generateFileId();
    const ext = EXT_BY_TYPE[type];
    // 落地檔名一律 <fileId>.<ext>：fileId 是我們自己產生的、從未經過使用者
    // 輸入，ext 也是由 magic bytes 反查的固定字面值，不是使用者提供的字串。
    const targetPath = join(TMP_DIR, `${ fileId }.${ ext }`);
    writeFileSync(targetPath, bytes);

    // registry 記的 size 是計費用的 charged（區塊大小下限），不是真實
    // bytes.length——這樣 currentUsage() 加總出來的配額才跟磁碟真實消耗一致。
    registry.set(fileId, { identity, ext, size: charged, uploadedAtMs: Date.now() });
    return { success: true, fileId };
}

export type ResolveFileResult =
    | { found: true; path: string }
    | { found: false; reason: 'not_found' | 'forbidden' };

/**
 * 消費端（H9 起）查詢 fileId 對應的本機路徑前，一律先呼叫這支確認身分吻合，
 * 不得自行用 fileId 字串組路徑。找不到 entry（含已過期被清理掉）一律視為
 * not_found；entry 存在但 identity 不符視為 forbidden——兩者都不回傳路徑，
 * 避免 A 企劃用猜測或側錄到的 fileId 讀到 B 企劃上傳的內容。
 */
export function resolveFileForIdentity(fileId: string, identity: string): ResolveFileResult {
    const entry = registry.get(fileId);
    if (!entry) {
        return { found: false, reason: 'not_found' };
    }
    if (entry.identity !== identity) {
        return { found: false, reason: 'forbidden' };
    }
    return { found: true, path: join(TMP_DIR, `${ fileId }.${ entry.ext }`) };
}

const FILE_ID_PATTERN = /^[A-Za-z0-9_-]{43}$/; // 比對 generateFileId() 的實際輸出格式（randomBytes(32).toString('base64url')，固定 43 字元的 base64url 字元集，不含 `/`）

export type ResolveFileIdResult =
    | { found: true; path: string }
    | { found: false; reason: 'invalid_format' | 'not_found' | 'forbidden' | 'outside_tmp_dir' };

/**
 * H9：圖片類 tool（onboard_vendor_game.ts）解析 fileId → 本機路徑的唯一入口，
 * 消費端不得繞過這支自行用 fileId 字串組路徑。兩層防護：
 *   1. regex 格式白名單：fileId 必須完全符合 generateFileId() 的實際輸出格式
 *      （43 字元 base64url），任何含 `/`、`..`、絕對路徑或其他字元的輸入在
 *      觸碰 registry 之前就直接拒絕。
 *   2. `resolveFileForIdentity()` 本身已經結構性安全——它用 `Map.get(fileId)`
 *      精確比對而不是字串拼接組路徑，所以只有輸入完全等於某個由
 *      `generateFileId()` 產生並存進 registry 的既有 key 才會命中——但這裡
 *      仍多一層 realpath 驗證解析出的絕對路徑真的落在 TMP_DIR 底下才回傳，
 *      defense-in-depth：即使未來 files.ts 的實作方式改變，這層保護仍然
 *      獨立成立，不依賴上游那層假設繼續正確。
 */
export function resolveFileIdForIdentity(fileId: string, identity: string): ResolveFileIdResult {
    if (!FILE_ID_PATTERN.test(fileId)) {
        return { found: false, reason: 'invalid_format' };
    }

    const result = resolveFileForIdentity(fileId, identity);
    if (!result.found) {
        return result;
    }

    let realTarget: string;
    try {
        realTarget = realpathSync(result.path);
    } catch {
        return { found: false, reason: 'not_found' };
    }
    const realTmpDir = realpathSync(TMP_DIR);
    if (realTarget !== realTmpDir && !realTarget.startsWith(realTmpDir + sep)) {
        return { found: false, reason: 'outside_tmp_dir' };
    }

    return { found: true, path: realTarget };
}

/**
 * 清理過期檔案。ttlMs/nowMs 可由呼叫端覆蓋，供測試把保留時長暫時調短、
 * 跑一次清理、確認過期檔真的被刪、未過期檔還在，不必真的等待。回傳被清掉
 * 的筆數。
 */
export function cleanupExpiredFiles(ttlMs: number = RETENTION_MS, nowMs: number = Date.now()): number {
    let removed = 0;
    for (const [ fileId, entry ] of registry) {
        if (nowMs - entry.uploadedAtMs > ttlMs) {
            const path = join(TMP_DIR, `${ fileId }.${ entry.ext }`);
            try {
                if (existsSync(path)) unlinkSync(path);
            } catch (err) {
                console.error(`[agrabah-platform files] 清理暫存檔失敗 ${ path }：${ err instanceof Error ? err.message : String(err) }`);
            }
            registry.delete(fileId);
            removed++;
        }
    }
    return removed;
}

const DISK_FILENAME_PATTERN = /^([A-Za-z0-9_-]{43})\.(png|jpg|webp)$/; // <fileId>.<ext>，比對 saveUploadedFile() 實際落地的檔名格式

/**
 * 掃描 TMP_DIR 磁碟上實際存在的檔案，刪除超過保留期、且不在 registry 追蹤
 * 範圍內的殘檔。
 *
 * 存在理由：registry 只存在記憶體（見檔頭「fileId -> 元資料」註解），行程
 * 重啟就清空；但重啟前已經落地的磁碟檔案不會跟著消失。cleanupExpiredFiles()
 * 只走 registry 迭代，永遠掃不到這些「registry 說沒有、磁碟上卻還在」的
 * 孤兒檔——重啟後它們就再也不會被任何路徑清掉，同時也不會計入配額，
 * 讓「全域 500MB 上限」這個防磁碟塞爆的機制在跨重啟情境下失去實際效力。
 * 這支函式補上「不透過 registry、直接看磁碟」這條路徑。
 *
 * 安全邊界（刪檔操作，寧可保守漏刪也不可能多刪）：
 *   - 只列舉 TMP_DIR 直接底下的項目（readdirSync 不遞迴），不觸碰子目錄。
 *   - 檔名必須完全符合 DISK_FILENAME_PATTERN（43 字元 base64url fileId +
 *     saveUploadedFile() 實際會產生的副檔名之一）；任何不符合格式的項目
 *     一律略過，不做任何動作。
 *   - 仍在 registry 裡的 fileId 一律跳過，交給 cleanupExpiredFiles() 處理，
 *     避免兩支函式對同一筆記錄互踩（例如 registry 剛好還沒過期但這支函式
 *     誤判磁碟 mtime 已過期）。
 *   - 組出路徑後用 realpathSync 驗證真的落在 TMP_DIR 底下才會刪除，比照
 *     resolveFileIdForIdentity() 既有的邊界檢查手法。
 *   - 過期判定用檔案本身的 mtime（不是 registry 的 uploadedAtMs——這支函式
 *     的存在意義正是處理 registry 裡沒有記錄的檔案，沒有 uploadedAtMs 可用）。
 */
export function cleanupOrphanedDiskFiles(ttlMs: number = RETENTION_MS, nowMs: number = Date.now()): number {
    let removed = 0;
    let entries: string[];
    try {
        entries = readdirSync(TMP_DIR);
    } catch {
        return removed; // 目錄不存在或無法讀取：視為沒有殘檔要清，不當作錯誤。
    }

    let realTmpDir: string;
    try {
        realTmpDir = realpathSync(TMP_DIR);
    } catch {
        return removed;
    }

    for (const name of entries) {
        const match = DISK_FILENAME_PATTERN.exec(name);
        if (!match) continue; // 畸形/非本模組產生的檔名：略過，絕不因此刪到目錄外或非預期的東西。

        const fileId = match[1] as string;
        if (registry.has(fileId)) continue; // 仍被追蹤中，交給 cleanupExpiredFiles()。

        const path = join(TMP_DIR, name);
        let realTarget: string;
        let mtimeMs: number;
        try {
            realTarget = realpathSync(path);
            mtimeMs = statSync(path).mtimeMs;
        } catch {
            continue; // 掃描與刪除之間檔案自然消失/無法讀取：略過，非錯誤。
        }
        if (realTarget !== realTmpDir && !realTarget.startsWith(realTmpDir + sep)) continue;
        if (nowMs - mtimeMs <= ttlMs) continue;

        try {
            unlinkSync(realTarget);
            removed++;
        } catch (err) {
            console.error(`[agrabah-platform files] 清理孤兒暫存檔失敗 ${ path }：${ err instanceof Error ? err.message : String(err) }`);
        }
    }
    return removed;
}

function runScheduledCleanup(): void {
    cleanupExpiredFiles();
    cleanupOrphanedDiskFiles();
}

// 服務啟動時先掃一次（含磁碟殘檔，見 cleanupOrphanedDiskFiles() 檔頭），
// 不必等到第一個 CLEANUP_INTERVAL_MS 週期才處理重啟前留下的孤兒檔。
runScheduledCleanup();

// 週期性排程：不論有沒有新上傳都定期回收，見檔頭「清理策略」。
setInterval(runScheduledCleanup, CLEANUP_INTERVAL_MS);
