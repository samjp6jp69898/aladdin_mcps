#!/usr/bin/env bun
/**
 * write-fallback-manifest.ts — 由 run-agent.ts 組出的 bash EXIT trap 呼叫
 * （見該檔的 wrapperScript）。不管 sub-agent 是正常結束、被內層 bash timeout
 * 殺（SIGTERM）、還是中途 crash，這個 trap 都會觸發一次，保證
 * scratch/{requestId}/manifest.json 至少存在一份可解析的內容。
 *
 * 只有在 manifest.json 不存在或是空檔案時才寫入 fallback——sub-agent 若已經
 * 依 prompt 指示正常寫出 manifest.json，這裡不覆蓋它的內容。
 *
 * JSON 序列化交給 JS 原生 JSON.stringify，不在 bash 裡手刻跳脫字元（bash
 * trap 本身用單引號包住整段 trap body 以延遲 $? 求值，若在裡面手刻 JSON 字面
 * 值會撞上單引號巢狀衝突，改成呼叫這支獨立腳本更簡單也更不容易寫錯）。
 */
import { existsSync, statSync, writeFileSync } from 'node:fs';

const [ , , manifestPath, exitCodeRaw ] = process.argv;

if (manifestPath === undefined || manifestPath.length === 0) {
    console.error('write-fallback-manifest: 缺少 manifestPath 參數');
    process.exit(1);
}

const alreadyWritten = existsSync(manifestPath) && statSync(manifestPath).size > 0;
if (!alreadyWritten) {
    writeFileSync(manifestPath, JSON.stringify({
        success: false,
        errorKind: 'agent_exit_without_manifest',
        summary: `sub-agent 結束（exit code ${ exitCodeRaw ?? 'unknown' }）前未寫出 manifest.json，可能被 timeout 終止或中途 crash，此為呼叫端自動補寫的 fallback 內容。`,
        files: [],
        verification: { ran: false, notes: '' },
        warnings: [],
    }));
}
