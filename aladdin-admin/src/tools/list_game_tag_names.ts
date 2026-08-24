/**
 * tools/list_game_tag_names.ts — aladdin_admin_game_vendor_admin_list_all_game_tag_names_by_type
 *
 * rajah: GameVendorAdmin.ListAllGameTagNamesByType(gameTagType GameTagTypeEnum 1) (tags [GameTagNameEdit] 1)
 * （game_back_office.rajah:339，@Permission "GameVendor.TagNames"）
 *
 * agrabah 對應實作：src/servers/game_back_office/services/game_vendor_admin.ts 的
 * methodListAllGameTagNamesByType，真的有 override（不是落回 base class notImplemented）；
 * 讀原始碼確認底層是逐一遍歷 GameTagManager.getTagEnum(gameTagType) 拿到的**寫死在 TS enum
 * 裡**的固定 tag 集合（vendorFee/appDisplay/rebate → GameVendorFeeTagEnum/GameDisplayTagEnum/
 * GameRebateTagEnum；frontendGroup → 對照表裡是一個空物件 `{}`），完全不查會隨業務成長的資料表，
 * 屬於 method-category-checklist.md 第 2 節「完全不分頁的全撈」中「小型列舉表可放心用」的情況。
 *
 * dev 驗證：2026-08-24 直接用 abu/.claude/skills/test-method 腳本範本打
 * https://admin.alddev.com（憑證 abu/.claude/skills/test-method/credentials.admin.env），
 * 依序呼叫 gameTagType=vendorFee/appDisplay/rebate/frontendGroup 與一個不合法值 99，
 * 終端機實際印出的原始回傳見本次任務的 dev_verification_evidence。以下 description 內
 * 的具體數字（8 筆、frontendGroup 空陣列、tag=0 無 name、errorCode=9 等）均照該次實測結果
 * 原樣描述，非推測。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { GAME_TAG_TYPE_MAP, GAME_TAG_TYPE_KEYS } from '../const.ts';

export function registerListGameTagNamesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_game_vendor_admin_list_all_game_tag_names_by_type',
        {
            title: 'List all game tag names by tag type',
            description:
                '依標籤類型列出「遊戲標籤」的完整多語名稱清單（rajah: GameVendorAdmin.ListAllGameTagNamesByType，' +
                'game_back_office.rajah:339）。這不是分頁查詢，一次回傳該類型下全部標籤，沒有 page/pageSize 參數——' +
                '2026-08-24 dev 站台（https://admin.alddev.com）實測 vendorFee/appDisplay/rebate 三種類型各自固定回傳 8 筆' +
                '（GameVendorFeeTagEnum/GameDisplayTagEnum/GameRebateTagEnum 共用同一組 tag 值 0~7：' +
                'unknown/slot/board/fish/live/sport/eSport/lottery），這些是後端寫死在 TS enum 裡的內建標籤，' +
                '數量不會隨資料成長，一次全撈是安全的。' +
                '\n\n**已知資料陷阱一（2026-08-24 dev 站台實測 + 讀原始碼 GameTagManager.getTagEnum() 確認為結構性行為，' +
                '非偶發）**：gameTagType=frontendGroup（前台自訂分類標籤）呼叫這支方法一律回傳空陣列（tags.length=0），' +
                '無論資料庫（DbPlatformGameTag）裡該平台實際建立了多少筆自訂標籤都一樣——這支方法只讀「寫死在程式碼裡' +
                '的內建 enum 標籤」，frontendGroup 在後端對照表中對應到一個空物件，完全不查資料庫。要查某平台' +
                'frontendGroup 的真實標籤清單，這支方法不適用，需要另一支查 DbPlatformGameTag 的 method（目前 admin ' +
                'server 尚未包裝成 MCP tool）。呼叫端若拿到 frontendGroup 的空陣列，不能解讀成「這個平台沒設定任何' +
                '前台標籤」，只能解讀成「這支方法本來就查不到」。' +
                '\n**已知資料陷阱二**：個別標籤的 name（多語名稱陣列）可能缺漏部分語系、或整個欄位不存在——2026-08-24 ' +
                'dev 站台實測 vendorFee 類型全部 8 筆 tag 回傳裡都**沒有 name 這個 key**（不是空陣列，是欄位本身沒出現）；' +
                'rejah 定義此欄位為 `name [LocalizationString] 3`，dev 這批測試資料目前查不到值，可能是這批 vendorFee ' +
                '標籤本來就沒設定過多語系名稱，也可能是資料本身的狀態，不代表 rajah 定義有誤。呼叫端不應假設每筆一定' +
                '有 name 欄位、更不應假設有完整三語系（en-US/zh-CN/zh-TW）。' +
                '\n傳入不在下方列舉範圍內的 gameTagType 數值，2026-08-24 dev 站台實測（傳 99）後端在協定層就直接擋下' +
                '（errorCode=9、message="gameTagType"，是通用參數驗證錯誤，不是這支方法定義的業務錯誤碼 ' +
                'gameTagTypeNotExists=317），所以本 tool 的 gameTagType 參數只接受下方四個已知合法值，不接受任意數字。',
            inputSchema: {
                gameTagType: z.enum(GAME_TAG_TYPE_KEYS).describe(
                    '要查詢的標籤類型（rajah GameTagTypeEnum）：' +
                    'vendorFee=遊戲廠商殺數計算用分類；appDisplay=前端顯示用分類；rebate=返水分類用；' +
                    'frontendGroup=前台遊戲標籤(平台自訂標籤)——見上方 description「已知資料陷阱一」，此類型' +
                    '呼叫本方法固定回傳空陣列，不代表該平台沒有前台標籤。',
                ),
            },
        },
        async ({ gameTagType }) => {
            const r = await withAutoRelogin(() =>
                remote.gameBackOffice.gameVendorAdmin.ListAllGameTagNamesByType(GAME_TAG_TYPE_MAP[ gameTagType ]),
            );
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, gameTagType, tags: r.data?.tags ?? [] });
        },
    );
}
