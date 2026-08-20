/**
 * spawn_kit_script.ts — 唯一跟 ../aladdin-ai-assistant-kit/make-starter-kit.ts 打交道的地方。
 *
 * 刻意不重寫 token 簽發邏輯：make-starter-kit.ts 本身就是「先檢查、再寫入」、暫存檔+rename
 * 的 atomic 名冊寫入、STATIC_FILES 白名單複製……這些正確性細節都已經在那支腳本裡做好，
 * 這裡重寫一份等於製造兩份會漂移的實作。這個 server 的價值只在於把「打 bun 指令」換成
 * 「用自然語言呼叫 tool」，不是要取代那支腳本。
 */

import { execFileSync } from 'node:child_process';

const KIT_DIR = '/Users/user/aladdin/obsidian/mcps/aladdin-ai-assistant-kit';
const KIT_SCRIPT = `${ KIT_DIR }/make-starter-kit.ts`;

export interface KitScriptResult {
    /** true 代表腳本以 exit code 0 結束（等同 CLI 使用者眼中的成功）。 */
    success: boolean;
    /** 腳本印到 stdout 的完整內容（含操作結果、下一步提示等人類可讀文字）。 */
    stdout: string;
    /** 失敗時腳本印到 stderr 的內容（缺參數、id 已存在、grant 被擋等錯誤訊息都印在這）。 */
    stderr: string;
}

export function runKitScript(args: string[]): KitScriptResult {
    try {
        const stdout = execFileSync('bun', [ KIT_SCRIPT, ...args ], {
            cwd: KIT_DIR,
            encoding: 'utf8',
            timeout: 30_000,
        });
        return { success: true, stdout, stderr: '' };
    } catch (err) {
        // execFileSync 對非 0 exit code 是 throw，不是回傳——node child_process 把
        // stdout/stderr/status 都掛在丟出來的 error 物件上，這裡把它們榨出來。
        const e = err as { status?: number; stdout?: string; stderr?: string; message: string };
        return {
            success: false,
            stdout: e.stdout ?? '',
            stderr: e.stderr || e.message,
        };
    }
}
