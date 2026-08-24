/**
 * tools/get_game_localizations.ts — aladdin_platform_game_vendor_platform_get_localizations
 *
 * rajah: GameVendorPlatform.GetLocalizations（game_back_office.rajah:1059，無 @Permission）
 *
 * **這支 method 做什麼**：依 targetType（遊戲名稱 / 廠商名稱 / 品牌名稱）一次撈出本平台
 * 「該類型全部 id 的多語值」，不分頁、無篩選欄位——後端實作
 * （agrabah/src/managers/game_localization_helper.ts:31 getLocalizations）直接依 targetType
 * 當 LocalizationServiceIdEnum 查整個 localization 表，繞開「僅顯示啟用中」的設定表，
 * 所以**即使對應的廠商/品牌/遊戲目前已停用，這裡仍查得到名稱**——設計目的是給後台解析
 * 歷史紀錄（會員投注紀錄、報表等）裡的 id 用，不是給「找目前上架中的項目」用（那應該用
 * aladdin_platform_game_vendor_platform_list_game_vendors / _list_games）。
 *
 * **2026-08-24 dev 實測結果（非紙上判斷，真的打過 https://pk-platform.alddev.com）**：
 * - targetType=gameName：回傳 4950 筆（每筆 1~3 種語言，不是每筆都有全部語言，例如觀察到
 *   有筆只有 en-US+zh-CN 缺 zh-TW）——**這不是分頁類 method，是一次性全撈**，回傳筆數已經
 *   接近 5000，且會隨平台持續上架新遊戲成長，沒有看到底層有 LIMIT（`getLocalizations` 對
 *   valueMap 直接整包轉陣列回傳）；本次呼叫仍在合理時間內成功，但沒有 owner 明確保證未來
 *   不會有硬上限或效能問題，agent 呼叫前應知悉這是重量級查詢，不要頻繁重複呼叫。
 * - targetType=gameVendorName：14 筆。targetType=gameBrandTitle：27 筆（這兩者資料量小，
 *   放心用）。
 * - 帶不在白名單內的 targetType 數值（如 999）：後端回 errorCode=9（不在生成的
 *   AgrabahErrorCodeEnum 101+ 範圍內，反查會顯示「未知錯誤碼」），但 zod enum 已把 input
 *   限制在三個合法值，agent 端理論上不會觸發到這個分支。
 * - 回應有 Redis 快取（依 platformId+targetType 為 key，TTL 300 秒；後台編輯場館/品牌/遊戲
 *   名稱時會主動 invalidate），代表**呼叫後最多有 5 分鐘的資料延遲**，剛改完名稱馬上查可能
 *   還看到舊值。
 * - rajah 的 `GameLocalizationItem.id` 語意依 targetType 而不同（gameName→
 *   gameVendorGameId、gameVendorName→gameVendorId、gameBrandTitle→platformGameBrandId），
 *   要對應到「哪個廠商/品牌/遊戲」時要記得目標欄位是哪一種 id，這支 tool 不做二次查詢驗證。
 * - 此 method 沒有掛 `@Permission`（rajah 原始碼確認過，service header 亦無），任何已登入
 *   本平台的使用者都能呼叫，不受角色權限樹限制。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { GAME_LOCALIZATION_TARGET_MAP } from '../const.ts';

export function registerGetGameLocalizationsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_get_localizations',
        {
            title: 'Bulk-get localized names for games / vendors / brands',
            description:
                '批次取得本平台某一類型（遊戲名稱 / 廠商名稱 / 品牌名稱）全部 id 的多語名稱' +
                '（rajah: GameVendorPlatform.GetLocalizations）。一次性全撈、不分頁、沒有可篩選單一目標的' +
                '欄位——targetType=gameName 實測回傳近 5000 筆，是重量級查詢，不要在短時間內重複呼叫；' +
                'gameVendorName/gameBrandTitle 資料量小（十幾~數十筆）。' +
                '即使對應廠商/品牌/遊戲目前已停用，這裡仍查得到名稱（用於解析歷史紀錄），' +
                '不能拿來判斷「目前是否上架中」——上架中清單請用' +
                'aladdin_platform_game_vendor_platform_list_game_vendors 或 ' +
                'aladdin_platform_game_vendor_platform_list_games。' +
                '回傳的 id 語意依 targetType 而不同：gameName→gameVendorGameId、' +
                'gameVendorName→gameVendorId、gameBrandTitle→platformGameBrandId。' +
                '後端有 5 分鐘 Redis 快取，剛編輯完名稱馬上查可能還看到舊值。',
            inputSchema: {
                targetType: z.enum([ 'gameName', 'gameVendorName', 'gameBrandTitle' ])
                    .describe(
                        '要查哪一類多語名稱：gameName=遊戲名稱（量大，近 5000 筆，id=gameVendorGameId）、' +
                        'gameVendorName=廠商名稱（id=gameVendorId）、gameBrandTitle=品牌名稱（id=platformGameBrandId）。',
                    ),
            },
        },
        async ({ targetType }) => {
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.GetLocalizations(GAME_LOCALIZATION_TARGET_MAP[ targetType ]));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, targetType, items: r.data?.items ?? [] });
        },
    );
}
