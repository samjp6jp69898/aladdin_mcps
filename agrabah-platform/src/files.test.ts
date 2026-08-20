import { describe, test, expect, beforeEach } from 'bun:test';
import { mkdtempSync, mkdirSync, existsSync, rmSync, readdirSync, writeFileSync, unlinkSync, utimesSync, symlinkSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// TMP_DIR 在 files.ts 模組載入時就會被讀取一次並 mkdirSync，所以必須在
// import 之前把環境變數指到一個測試專用的暫存目錄——不能借用真實的
// tmp-uploads/（會跟其他並行跑的東西互相污染，也不該讓測試在 repo 目錄下
// 留下真實檔案）。用 top-level await 確保 import 發生在設定環境變數之後。
const testTmpDir = mkdtempSync(join(tmpdir(), 'agrabah-platform-files-test-'));
process.env.AGRABAH_PLATFORM_FILES_TMP_DIR = testTmpDir;

const { detectImageType, saveUploadedFile, resolveFileForIdentity, cleanupExpiredFiles, cleanupOrphanedDiskFiles } = await import('./files.ts');

/** 建一個開頭是合法 PNG 簽章、其餘填 0 的 buffer，用來精確控制測試檔案大小。 */
function pngBytes(size: number): Uint8Array {
    const bytes = new Uint8Array(Math.max(size, 8));
    bytes.set([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);
    return bytes.subarray(0, size);
}

// 真實的 1x1 透明 PNG（base64），用來驗證「一張真 png 通過」不只是簽章對，
// 內容也是合法圖片。
const REAL_PNG_BASE64 = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';

// registry 是 files.ts 內的模組級單例，跨測試不會自動清空——每個測試開始前
// 先用「未來時間點 + ttlMs=0」的 cleanupExpiredFiles() 把前一個測試留下的
// entry 全部視為過期並清掉，讓每個測試看到的配額/計數都是從零開始，不受
// 執行順序影響。這是刻意重用production 的清理路徑做測試隔離，不是另外新增
// 一個 test-only 的重置函式。
beforeEach(() => {
    cleanupExpiredFiles(0, Date.now() + 60_000);
});

describe('detectImageType — magic bytes 判定，不信任副檔名/Content-Type', () => {
    test('真實 png 簽章', () => {
        expect(detectImageType(Buffer.from(REAL_PNG_BASE64, 'base64'))).toBe('png');
    });

    test('jpeg 簽章（FF D8 FF）', () => {
        expect(detectImageType(new Uint8Array([ 0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0 ]))).toBe('jpeg');
    });

    test('webp 簽章（RIFF....WEBP）', () => {
        const bytes = new Uint8Array(16);
        bytes.set([ 0x52, 0x49, 0x46, 0x46 ], 0); // RIFF
        bytes.set([ 0x57, 0x45, 0x42, 0x50 ], 8); // WEBP
        expect(detectImageType(bytes)).toBe('webp');
    });

    test('shell script 改副檔名成 .png：內容不是圖片，magic bytes 判定失敗', () => {
        const bytes = new TextEncoder().encode('#!/bin/bash\necho pwned\n');
        expect(detectImageType(bytes)).toBeNull();
    });

    test('html 改副檔名成 .png：magic bytes 判定失敗', () => {
        const bytes = new TextEncoder().encode('<html><body>hi</body></html>');
        expect(detectImageType(bytes)).toBeNull();
    });

    test('真實 SVG：文字格式非本模組認得的二進位簽章，故意不放進白名單（可內嵌 script）', () => {
        const bytes = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>');
        expect(detectImageType(bytes)).toBeNull();
    });

    test('空內容', () => {
        expect(detectImageType(new Uint8Array(0))).toBeNull();
    });
});

describe('saveUploadedFile', () => {
    test('真實 png 上傳成功，落地檔名為 <fileId>.png（不採信任何使用者提供的檔名）', () => {
        const bytes = Buffer.from(REAL_PNG_BASE64, 'base64');
        const result = saveUploadedFile('real-png-identity', bytes);
        expect(result.success).toBe(true);
        if (!result.success) throw new Error('unreachable');
        expect(existsSync(join(testTmpDir, `${ result.fileId }.png`))).toBe(true);
    });

    test('型別不在白名單：不落地任何檔案', () => {
        const before = new Set(readdirSync(testTmpDir));
        const result = saveUploadedFile('reject-type-identity', new TextEncoder().encode('not an image'));
        expect(result.success).toBe(false);
        const after = new Set(readdirSync(testTmpDir));
        expect(after).toEqual(before);
    });

    test('超過單檔大小上限：回明確錯誤且不落地', () => {
        process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES = '100';
        try {
            const before = readdirSync(testTmpDir).length;
            const result = saveUploadedFile('too-big-identity', pngBytes(200));
            expect(result.success).toBe(false);
            if (result.success) throw new Error('unreachable');
            expect(result.errorMessage).toContain('大小超過上限');
            expect(readdirSync(testTmpDir).length).toBe(before);
        } finally {
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES;
        }
    });

    test('單一身分配額：連續上傳到超過單人上限後第 N 次被拒，cleanup 後恢復正常', () => {
        // 配額計費有 FS_BLOCK_SIZE_BYTES(4096) 下限（見 files.ts 的 accountedSize()，
        // 修正 review 挖到的「一堆小檔案在帳本上幾乎不計錢，實際磁碟卻整區塊起跳」
        // 放大問題），所以上限值要抓 4096 的倍數級距，不能再用遠小於 4096 的數字。
        process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES = '100000';
        process.env.AGRABAH_PLATFORM_FILES_MAX_PER_IDENTITY_BYTES = '10000';
        process.env.AGRABAH_PLATFORM_FILES_MAX_TOTAL_BYTES = '100000';
        try {
            const identity = 'per-identity-quota-test';
            const first = saveUploadedFile(identity, pngBytes(100));
            const second = saveUploadedFile(identity, pngBytes(100));
            const third = saveUploadedFile(identity, pngBytes(100)); // 每筆計費 4096：4096*3=12288 > 10000

            expect(first.success).toBe(true);
            expect(second.success).toBe(true);
            expect(third.success).toBe(false);
            if (third.success) throw new Error('unreachable');
            expect(third.errorMessage).toContain('單人上限');

            // 清掉這個身分名下的所有檔（用未來時間點讓 ttlMs=0 判定必定成立），配額恢復。
            const removed = cleanupExpiredFiles(0, Date.now() + 60_000);
            expect(removed).toBe(2);

            const afterCleanup = saveUploadedFile(identity, pngBytes(100));
            expect(afterCleanup.success).toBe(true);
        } finally {
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES;
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_PER_IDENTITY_BYTES;
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_TOTAL_BYTES;
        }
    });

    test('全域總量配額：不同身分共同計入總量，超過後回明確錯誤且不落地', () => {
        process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES = '100000';
        process.env.AGRABAH_PLATFORM_FILES_MAX_PER_IDENTITY_BYTES = '100000';
        process.env.AGRABAH_PLATFORM_FILES_MAX_TOTAL_BYTES = '10000';
        try {
            const a = saveUploadedFile('total-quota-identity-a', pngBytes(100));
            const b = saveUploadedFile('total-quota-identity-b', pngBytes(100));
            const c = saveUploadedFile('total-quota-identity-c', pngBytes(100)); // 每筆計費 4096：4096*3=12288 > 10000

            expect(a.success).toBe(true);
            expect(b.success).toBe(true);
            expect(c.success).toBe(false);
            if (c.success) throw new Error('unreachable');
            expect(c.errorMessage).toContain('總容量');

            cleanupExpiredFiles(0, Date.now() + 60_000);
        } finally {
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES;
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_PER_IDENTITY_BYTES;
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_TOTAL_BYTES;
        }
    });

    // review 挖到的真實問題回歸測試：大量「合法但極小」的檔案（例如 8 bytes，
    // detectImageType 認得的最短合法簽章）若照 bytes.length 計費，配額帳本
    // 幾乎不計錢，但檔案系統實際是以區塊（常見 4096 bytes）為單位配置磁碟，
    // 造成配額形同虛設、擋不住短時間塞爆磁碟。驗證：把總量上限設在「用 1
    // byte 檔案不可能塞爆但用 4096 計費後很快會頂到」的級距，確認遠早於用
    // 邏輯 bytes.length 計算會超過的次數就被擋下。
    test('配額計費有區塊大小下限：大量最小合法檔案不能繞過總量配額（磁碟放大攻擊）', () => {
        process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES = '100000';
        process.env.AGRABAH_PLATFORM_FILES_MAX_PER_IDENTITY_BYTES = '10000000'; // 夠大，這個測試只測全域總量
        process.env.AGRABAH_PLATFORM_FILES_MAX_TOTAL_BYTES = '40960'; // 10 個區塊
        try {
            const tinyPng = pngBytes(8); // detectImageType 認得的最短合法 png 簽章
            let succeeded = 0;
            for (let i = 0; i < 20; i++) {
                const result = saveUploadedFile(`tiny-flood-identity-${ i }`, tinyPng);
                if (result.success) succeeded++;
            }

            // 若沒有區塊大小下限：20 個 8-byte 檔案總共只算 160 bytes，遠低於
            // 40960，20 次全部會成功——這正是 review 實測出的漏洞。
            // 有下限後：每筆計費 4096，40960 / 4096 = 10，第 11 次起應被拒。
            expect(succeeded).toBe(10);
        } finally {
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_FILE_BYTES;
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_PER_IDENTITY_BYTES;
            delete process.env.AGRABAH_PLATFORM_FILES_MAX_TOTAL_BYTES;
            cleanupExpiredFiles(0, Date.now() + 60_000);
        }
    });
});

describe('resolveFileForIdentity — fileId 與上傳者身分綁定', () => {
    test('擁有者查詢自己上傳的 fileId：找到', () => {
        const result = saveUploadedFile('owner-identity', pngBytes(32));
        expect(result.success).toBe(true);
        if (!result.success) throw new Error('unreachable');

        const resolved = resolveFileForIdentity(result.fileId, 'owner-identity');
        expect(resolved.found).toBe(true);
        if (!resolved.found) throw new Error('unreachable');
        expect(existsSync(resolved.path)).toBe(true);
    });

    test('非擁有者用同一個 fileId 查詢：forbidden，不回傳路徑（避免 A 企劃用 B 企劃的 fileId）', () => {
        const result = saveUploadedFile('alice-identity', pngBytes(32));
        expect(result.success).toBe(true);
        if (!result.success) throw new Error('unreachable');

        const resolved = resolveFileForIdentity(result.fileId, 'bob-identity');
        expect(resolved).toEqual({ found: false, reason: 'forbidden' });
    });

    test('不存在的 fileId：not_found', () => {
        const resolved = resolveFileForIdentity('does-not-exist', 'anyone');
        expect(resolved).toEqual({ found: false, reason: 'not_found' });
    });
});

describe('cleanupExpiredFiles — 清理策略（ttlMs/nowMs 可注入，不需真的等待）', () => {
    test('過期檔被刪、未過期檔還在', () => {
        const t0 = Date.now();
        const expired = saveUploadedFile('cleanup-expired-identity', pngBytes(16));
        expect(expired.success).toBe(true);
        if (!expired.success) throw new Error('unreachable');

        // 把「現在」模擬成 t0 + 200ms，保留時長設 100ms：這筆檔案視為過期。
        const removed = cleanupExpiredFiles(100, t0 + 200);
        expect(removed).toBe(1);

        const afterExpire = resolveFileForIdentity(expired.fileId, 'cleanup-expired-identity');
        expect(afterExpire).toEqual({ found: false, reason: 'not_found' });

        // 剛上傳的檔案，用同一個 ttl 但「現在」就是真實現在，未超過保留時長，不該被清。
        const fresh = saveUploadedFile('cleanup-fresh-identity', pngBytes(16));
        expect(fresh.success).toBe(true);
        if (!fresh.success) throw new Error('unreachable');

        const removedFresh = cleanupExpiredFiles(100, Date.now());
        expect(removedFresh).toBe(0);

        const afterFresh = resolveFileForIdentity(fresh.fileId, 'cleanup-fresh-identity');
        expect(afterFresh.found).toBe(true);
        if (!afterFresh.found) throw new Error('unreachable');
        expect(existsSync(afterFresh.path)).toBe(true);
    });
});

describe('cleanupOrphanedDiskFiles — 補「不在 registry 裡的磁碟殘檔」清理路徑（重啟後遺留，H28 磁碟韌性）', () => {
    // 依 generateFileId() 的實際輸出格式手動組一個「看起來像合法 fileId」的
    // 43 字元 base64url 字串。故意不透過 saveUploadedFile()：那樣會同時寫進
    // registry，測不到「registry 沒有這筆記錄」這個前提（模擬行程重啟後
    // registry 清空、但磁碟上還留著上次的檔案）。
    function fakeFileId(): string {
        return randomBytes(32).toString('base64url');
    }

    test('過期殘檔（不在 registry）會被刪', () => {
        const path = join(testTmpDir, `${ fakeFileId() }.png`);
        writeFileSync(path, pngBytes(16));
        const past = new Date(Date.now() - 1000 * 1000);
        utimesSync(path, past, past);

        const removed = cleanupOrphanedDiskFiles(100, Date.now());
        expect(removed).toBe(1);
        expect(existsSync(path)).toBe(false);
    });

    test('未過期殘檔（不在 registry）不會被刪', () => {
        const path = join(testTmpDir, `${ fakeFileId() }.jpg`);
        writeFileSync(path, pngBytes(16));

        const removed = cleanupOrphanedDiskFiles(60_000, Date.now());
        expect(removed).toBe(0);
        expect(existsSync(path)).toBe(true);

        unlinkSync(path);
    });

    test('仍在 registry 裡的檔案，即使磁碟 mtime 已過期，也不會被這支函式動到（交給 cleanupExpiredFiles 處理，避免兩支函式互踩）', () => {
        const result = saveUploadedFile('still-tracked-identity', pngBytes(16));
        expect(result.success).toBe(true);
        if (!result.success) throw new Error('unreachable');
        const path = join(testTmpDir, `${ result.fileId }.png`);
        const past = new Date(Date.now() - 1000 * 1000);
        utimesSync(path, past, past);

        const removed = cleanupOrphanedDiskFiles(100, Date.now());
        expect(removed).toBe(0);
        expect(existsSync(path)).toBe(true);

        cleanupExpiredFiles(0, Date.now() + 60_000); // 收尾釋放配額，不影響後續測試
    });

    test('畸形檔名（不符合 <43字元base64url>.<ext> 格式）一律略過，即使檔案很舊也不刪', () => {
        const badNames = [ 'not-a-valid-fileid.png', `${ fakeFileId() }.txt`, `${ fakeFileId() }.PNG`, 'a.png' ];
        for (const name of badNames) {
            const path = join(testTmpDir, name);
            writeFileSync(path, pngBytes(16));
            const past = new Date(Date.now() - 1000 * 1000);
            utimesSync(path, past, past);
        }

        const removed = cleanupOrphanedDiskFiles(100, Date.now());
        expect(removed).toBe(0);
        for (const name of badNames) {
            expect(existsSync(join(testTmpDir, name))).toBe(true);
            unlinkSync(join(testTmpDir, name));
        }
    });

    test('檔名符合格式但實際是指向目錄外的 symlink：realpath 邊界檢查擋下，不刪除目錄外的目標', () => {
        const outsideDir = mkdtempSync(join(tmpdir(), 'agrabah-platform-files-outside-'));
        const outsideTarget = join(outsideDir, 'sensitive.png');
        writeFileSync(outsideTarget, pngBytes(16));
        const past = new Date(Date.now() - 1000 * 1000);
        utimesSync(outsideTarget, past, past);

        const linkPath = join(testTmpDir, `${ fakeFileId() }.png`);
        symlinkSync(outsideTarget, linkPath);

        const removed = cleanupOrphanedDiskFiles(100, Date.now());
        expect(removed).toBe(0);
        expect(existsSync(outsideTarget)).toBe(true);

        unlinkSync(linkPath);
        rmSync(outsideDir, { recursive: true, force: true });
    });

    test('TMP_DIR 目錄不存在時不會崩潰，回傳 0', () => {
        rmSync(testTmpDir, { recursive: true, force: true });
        expect(() => cleanupOrphanedDiskFiles()).not.toThrow();
        expect(cleanupOrphanedDiskFiles()).toBe(0);
        mkdirSync(testTmpDir, { recursive: true }); // 還原，避免影響後續測試與 process.on('exit') 清理
    });
});

// 不用 afterAll 清 testTmpDir 也可以（每次跑測試都用 mkdtempSync 開新目錄），
// 但既然有現成的工具函式，順手清掉避免系統暫存目錄堆積測試殘留。
process.on('exit', () => {
    try {
        rmSync(testTmpDir, { recursive: true, force: true });
    } catch {
        // 測試環境清理失敗不影響測試結果本身，忽略。
    }
});
