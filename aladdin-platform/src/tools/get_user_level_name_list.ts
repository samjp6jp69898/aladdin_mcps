/**
 * tools/get_user_level_name_list.ts — aladdin_platform_user_level_get_name_list
 *
 * rajah: UserLevel.GetNameList（user_level_back_office.rajah:233，@LoginRequired、無 @Permission）——
 * 取得本平台全部會員層級的「id → 名稱」對照清單，供其他 tool 的 userLevelId 參數取得合法值。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/user_level_back_office/services/user_level.ts:41-49，methodGetNameList）：
 * 真的查 DB（DbUserLevelConfig，`platform_id = ? AND deleted = 0`），非 placeholder；已軟刪的層級
 * 不會出現在結果裡。無參數、不分頁——一個平台的層級設定是小型列舉表（後台手動新增，不會成長成
 * 歷史/log 規模）。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：完全不分頁的全撈，屬「小型列舉表可放心用」。
 * 回傳欄位只有 id/name/type/color，不含任何 PII 或憑證，不適用第 8 節。
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetUserLevelNameListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_user_level_get_name_list',
        {
            title: "List the current platform's user level id/name pairs",
            description:
                '取得本平台全部會員層級的 id/名稱對照清單（rajah: UserLevel.GetNameList，' +
                '後台「會員管理」→「會員層級」）。無參數、不分頁，一次回傳所有未刪除的層級。' +
                '**其他需要 userLevelId／targetLevelId 的 tool（例如 ' +
                'aladdin_platform_user_level_get_user_list、aladdin_platform_user_level_update、' +
                'aladdin_platform_user_level_delete）一律先呼叫本 tool 取得合法 id，不要自己猜數字。** ' +
                'type 是 UserLevelTypeEnum（auto=0 自動層級／static=1 固定層級）；' +
                'color 是後台色票的整數表示（@Type "Color"），不是層級大小。' +
                '已軟刪除（deleted=1）的層級不會出現在結果裡。' +
                '2026-08-28 dev 實測（pk-platform.alddev.com）回傳真實資料。',
            inputSchema: {},
        },
        async () => {
            const r = await withAutoRelogin(() => remote.userLevelBackOffice.userLevel.GetNameList());
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [] });
        },
    );
}
