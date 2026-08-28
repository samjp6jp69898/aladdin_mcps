/**
 * tools/get_wagering_scopes.ts — aladdin_platform_wagering_platform_get_wagering_scopes
 *
 * rajah: WageringPlatform.GetWageringScopes（wagering_back_office.rajah:401）。
 * 方法本身沒有獨立 @Permission，套用 service 級的 @Permission "Finance.Wagering"（同檔 389）。
 * 注意 agrabah 端 doc comment（wagering_platform.ts:341）寫「@Permission "Finance.Wagering.GetWageringScopes"」，
 * 但 rajah 裡不存在這個節點，那行註解是錯的，不要採信——以 rajah 為準。
 *
 * 分類（method-category-checklist.md）：
 * - 主分類第 1 節「讀取單筆」：吃單一 id。該節要求的三項檢查都已查證——後端只有一次
 *   SELECT、無任何寫入/audit/cache 寫入（唯讀且冪等，不是第 1 節警告的那種「名為 Get 實為
 *   claim」）；SQL 的 platform_id 來自 context 無法由呼叫端指定（跨租戶安全）；id 不存在的
 *   行為已實打驗證，見下方 description。
 * - 回傳是陣列，按第 2 節字面判準也會命中「完全不分頁的全撈」，但不套用 B 級逐頁掃描要求：
 *   單筆稽核的 scope 列數被 user_wagering_scopes 的 UNIQUE INDEX
 *   uk_wagering_id_display_tag_brand_id（wagering_id, display_tag, brand_id）
 *   以「該筆稽核建立時勾選的類型 × 品牌」為上界，不是會持續成長的歷史/log 型資料表。
 *
 * 回傳型別 WageringScopeStructure 只有 displayTag i32 與 brandIds [i32]，整條路徑沒有 i64，
 * 不會出現 protobufjs Long 實例，因此刻意不套 deepFixLongs（不是漏了）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerGetWageringScopesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_get_wagering_scopes',
        {
            title: 'Get wagering scope restrictions of one wagering record',
            description:
                '查單一筆稽核紀錄的「稽核限定」明細，也就是這筆打碼量必須在哪些遊戲類型／品牌下注才能消掉' +
                '（rajah: WageringPlatform.GetWageringScopes，套用 service 級權限節點 Finance.Wagering）。' +
                'wageringId 是稽核紀錄的 id，來源是 aladdin_platform_wagering_platform_list_user_wagerings ' +
                '或 aladdin_platform_wagering_platform_get_user_un_wagering_detail 回傳的 rows[].id，不要自己編。' +
                '**最重要的已知限制：這支 method 無法讓你分辨「查無此筆」與「這筆沒有限定」。**' +
                '2026-08-28 讀原始碼查證（agrabah/src/servers/wagering_back_office/services/' +
                'wagering_platform.ts:348-357，SQL 在同檔 313-331）並實打 dev 驗證：實作是對 ' +
                'user_wagering_scopes 做 JSON_ARRAYAGG 聚合，命中 0 列時聚合結果為 NULL，' +
                '方法一律回 success + 空陣列。dev 實測「不存在的 id」與「真實但未設限定的紀錄」' +
                '回傳完全相同，都是空。要事先知道某筆到底有沒有限定，請看 list_user_wagerings 回傳的 ' +
                'wageringScope 欄位（該欄位是限定「數量」，0 代表不指定）。' +
                '**欄位對照**：displayTag 是本平台的遊戲類型編號，對照 ' +
                'aladdin_platform_game_vendor_platform_list_all_game_display_tags 回傳的 **tags[].tag**' +
                '（注意那支 tool 回的是 tags 不是 rows，且該 model 沒有 id 欄位，識別欄位就叫 tag）；' +
                '低位值域與 GameDisplayTagEnum（rajah/services/game.rajah:1-19：0=unknown／1=slot 電子／' +
                '2=board 棋牌／3=fish 捕魚／4=live 真人／5=sport 體育／6=eSport 電競／7=lottery 彩票）對齊，' +
                '但各平台可再自建編號（dev 上就有 101 以上的自訂類型），所以請以該平台實際清單為準、' +
                '不要把它當成固定 enum。brandIds 是遊戲品牌 id 陣列，對照 ' +
                'aladdin_platform_game_vendor_platform_list_all_brands 的 rows[].id。' +
                '本工具純讀取；**既有紀錄的稽核限定無法修改**——限定只能在建立稽核時指定，' +
                '寫入路徑是 WageringPlatform.ManualAddUserWagering（wagering_back_office.rajah:409，' +
                '參數 ManualAddUserWageringParameters.wageringScopes，需要 ' +
                'Finance.Wagering.List.ManualAddUserWagering 權限 + @Totp），該 write method ' +
                '會直接改動個別會員的提款門檻，本 MCP 未包成 tool。',
            inputSchema: {
                wageringId: z.number().int().min(1).describe(
                    '稽核紀錄 id，取自 list_user_wagerings 或 get_user_un_wagering_detail 的 rows[].id。' +
                    'user_wagerings.id 是 INT UNSIGNED AUTO_INCREMENT，0／負值不可能存在，故本工具直接擋下' +
                    '（避免多製造一種「空陣列」的歧義來源）。存在但不屬於本平台、或屬於本平台但沒有限定時，' +
                    '不會報錯，會回空陣列（見工具說明）',
                ),
            },
        },
        async ({ wageringId }) => {
            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringPlatform.GetWageringScopes(wageringId));
            if (r.failed) return asErrorResult(r);

            const scopes = r.data?.wageringScopes ?? [];
            return asTextResult({
                success: true,
                wageringId,
                wageringScopes: scopes,
                notes: scopes.length === 0
                    ? '空陣列有三種可能且後端不區分：(a) 這筆稽核本來就不限定遊戲範圍、'
                        + '(b) wageringId 不存在、(c) 這筆稽核屬於別的平台（SQL 帶 platform_id = 本次登入平台）。'
                        + '想確認是哪一種，請先用 list_user_wagerings 查這個 id 是否存在、其 wageringScope 是否為 0'
                    : 'displayTag = 本平台遊戲類型編號，對照 list_all_game_display_tags 的 tags[].tag（不是 rows[].id）；'
                        + 'brandIds = 遊戲品牌 id 陣列，對照 list_all_brands 的 rows[].id',
            });
        },
    );
}
