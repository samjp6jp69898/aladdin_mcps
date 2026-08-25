/**
 * tools/get_fission_activity_options.ts — aladdin_platform_activity_platform_get_fission_activity_options
 *
 * rajah: ActivityPlatform.GetFissionActivityOptions() (rows [FissionActivityOption] 1)
 * （activity_back_office.rajah:1786，service 定義於同檔 1767 行，非 @NoPublic，rajah 註解明文
 * 「不掛 @Permission：活動編輯彈窗的 select 來源（同 roulette GetConfigNameList 模式）」——
 * 與 get_user_id_by_identifier.ts 那支「無法確認是否刻意」不同，這支有明文理由，是刻意設計）。
 * agrabah 對應實作 activity_platform.ts:1453-1477 methodGetFissionActivityOptions，確認有
 * 真實實作，非 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」——但屬於「完全不分頁的全撈」情況
 * （無參數，一次回傳全部）。這是小型下拉選單來源（裂變活動設定，非會持續成長的業務表），
 * 可放心全撈。
 *
 * agrabah 實作細節（讀源碼查證）：
 * - 資料來源是平台設定 `fission.activity.list`（跨服務 RPC
 *   `context.remote.platform.main.GetFissionActivityListSetting()`），值是 JSON 字串
 *   `{ [key]: { name?, url? } }`，本 method 解析後逐筆轉成 `{ key, name, url }`——`key` 是
 *   裂變活動 key（用於活動編輯時存檔）、`name` 是選單顯示名稱（缺省時 fallback 成 key 本身）、
 *   `url` 是登入 API 路徑快照（可能為空字串）。
 * - **平台沒有設定過 `fission.activity.list` 時（後端回 objectNotFound）不是錯誤**，本 method
 *   會直接回傳空陣列（`GenieResult.success`，`rows=[]`），不是把上游的 objectNotFound 往外拋。
 * - 設定值 JSON 格式錯誤（無法 parse）時會回 invalidData 錯誤——這是本 method 自己產生的唯一
 *   錯誤碼；上游 GetFissionActivityListSetting 若因非 objectNotFound 的其他原因失敗（例如
 *   內部 RPC 錯誤），會原樣外拋，不算本 method 自己的錯誤路徑。
 *
 * 無密鑰/PII，rajah model `FissionActivityOption`（activity_back_office.rajah 同檔案附近）
 * 註解明寫「不含 sign/privateKey」，回傳的 url 只是快照路徑，非機密。純讀取查詢，不修改任何
 * 資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-25，pk-platform.alddev.com，帳號 landon001；透過獨立 spike script，
 *     用 @modelcontextprotocol/sdk 的 Client + StdioClientTransport 直接 spawn 本 worktree
 *     的 src/stdio.ts 呼叫真正的 tool）---
 * 呼叫 aladdin_platform_activity_platform_get_fission_activity_options（無參數）：
 * success true，rows 3 筆真實資料（key 皆為數字字串、name 為中文活動名稱、url 皆為
 * `/api/v1/fission/fissionLogin`），與檔頭「讀 fission.activity.list 平台設定並解析 JSON」的
 * 敘述吻合。純讀取查詢，未寫入/修改任何 dev 資料，無需清理。本平台目前確實有設定，未測到
 * 「平台未設定、回空陣列」這個分支（讀源碼確認邏輯存在，非實測）。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetFissionActivityOptionsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_activity_platform_get_fission_activity_options',
        {
            title: 'List this platform\'s fission activity dropdown options',
            description:
                '查詢本平台的裂變活動下拉選項（rajah: ActivityPlatform.GetFissionActivityOptions），' +
                '對應後台活動編輯彈窗的裂變活動選單來源，讀自平台設定 fission.activity.list。' +
                '無參數，一次回傳全部。回傳每筆含 key（裂變活動 key，活動編輯時存檔用）、' +
                'name（選單顯示名稱）、url（登入 API 路徑快照，可能為空字串）。平台完全沒設定過' +
                '這個裂變活動清單時，回傳空陣列（不是錯誤）。純讀取查詢，不修改任何資料，可安全' +
                '重複呼叫。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.activityBackOffice.activityPlatform.GetFissionActivityOptions());
            if (r.failed) return asErrorResult(r);

            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
