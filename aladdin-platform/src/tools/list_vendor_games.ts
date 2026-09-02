/**
 * tools/list_vendor_games.ts — aladdin_platform_game_vendor_platform_list_games
 *
 * rajah: GameVendorPlatform.ListGames（game_back_office.rajah:1041）
 *
 * 2026-09-02 修正真實出包：建 search 時漏帶 `displayTag` / `rebateTag`，導致這支
 * tool 對任何廠商都回 `rows: []`、`totalPage: 0`。
 *
 * 根因是 protobuf 預設值撞上後端的哨兵值契約：沒帶的欄位會取 proto3 預設 0，而
 * 後端 `displayTag` / `rebateTag` 的「全部（不篩選）」哨兵是 **-1**，0 是合法的
 * 分類值（未知分類）——
 * agrabah/src/servers/game_back_office/services/game_vendor_platform.ts:612-617
 * 原文即有此提醒：
 *   // displayTag / rebateTag：-1 = 全部（0 為合法分類值，不可用 truthy 判斷）
 *   { type: GameTagTypeEnum.appDisplay, tag: search.displayTag, skip: search.displayTag === -1 },
 *   { type: GameTagTypeEnum.rebate,     tag: search.rebateTag,   skip: search.rebateTag === -1 }
 * 漏帶等於多送了「分類 = 0 且返水標籤 = 0」這兩個條件，交集為空時後端在同檔
 * :583-584 直接把 rows 清空並 return success——**RPC 是成功的，只是資料被靜默
 * 篩光**，呼叫端完全看不出是查詢方式寫錯了還是真的沒資料。
 *
 * 實證（CQA pk 平台 platform_id=2、gameVendorId=29 的 VR 廠商）：後台「遊戲管理 >
 * 遊戲列表」用 VR 篩選看得到 23 款啟用中的遊戲，而這 23 款的 appDisplay / rebate
 * tag 全是 7、沒有任何一筆是 0，所以用 tag=0 去篩必然是空集合。
 *
 * abu 前端沒踩到同一顆雷，是因為它有一支專門補哨兵值的 helper：
 * abu/platform/src/helpers/game_search.ts:88-102 的 `createGameSearch()` 一律把
 * displayTag / rebateTag 預設成 -1。本檔比照同一套契約。
 *
 * 另外兩個容易一起誤補、實際上**不該補**的欄位（已查證）：
 * - `frontendGroupTag`：後端契約 0 = 全部（同檔 :616），漏帶正好就是全部。
 * - `badgeId`：後端同檔 :701 用 truthy 判斷，漏帶＝不篩選。
 *
 * 同類缺陷可用 aladdin_mcps/scripts/check-sentinel-fields.ts 全面重跑稽核。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformGameVendorGameEssentialSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { ACTIVE_STATUS_MAP, DISPLAY_TAG_ALL, REBATE_TAG_ALL } from '../const.ts';

export function registerListVendorGamesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_game_vendor_platform_list_games',
        {
            title: "List a game vendor's games on this platform",
            description:
                '查詢某個三方遊戲廠商在本平台已上架的遊戲清單（rajah: GameVendorPlatform.ListGames）。' +
                'gameVendorId 用 aladdin_platform_game_vendor_platform_list_game_vendors 回傳的 id。' +
                '注意：這是本平台已上架的遊戲，不是廠商在三方系統裡的完整遊戲庫——若某遊戲廠商已經串接但這裡查不到，' +
                '代表該遊戲在「廠商遊戲母表」（由廠商同步 job 自動帶入）已存在、但本平台尚未呼叫過 ' +
                'aladdin_platform_game_vendor_platform_update_game_vendor_game 上架，不代表廠商完全沒有這款遊戲。' +
                '本 POC 只開放 gameVendorId/name/status 三個篩選條件對外（displayTag/frontendGroupTag/rebateTag/badgeId ' +
                '等下拉篩選欄位需要另外查對應清單，尚未實作，如需要請回報）——但內部一律送出 displayTag=-1、' +
                'rebateTag=-1 這兩個「全部」哨兵值，不是省略不帶：後端契約 -1 才代表全部，0 是合法的分類值，' +
                '漏帶會讓查詢被靜默篩成空陣列（2026-09-02 真實出包，詳見檔頭）。',
            inputSchema: {
                gameVendorId: z.number().int().describe('遊戲廠商 id，來自 aladdin_platform_game_vendor_platform_list_game_vendors'),
                name: z.string().optional().describe('依遊戲名稱篩選'),
                status: z.enum([ 'enabled', 'disabled' ]).optional().describe('上架狀態篩選'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 50'),
            },
        },
        async ({ gameVendorId, name, status, page, pageSize }) => {
            const search = PlatformGameVendorGameEssentialSearch.create({
                gameVendorId,
                name: name ?? '',
                status: status ? ACTIVE_STATUS_MAP[ status ] : undefined,
                // 這兩個哨兵值不可省略：後端「全部」是 -1，protobuf 預設的 0 是合法
                // 分類值，漏帶會被當成真實篩選條件而把結果篩成空陣列（見檔頭）。
                displayTag: DISPLAY_TAG_ALL,
                rebateTag: REBATE_TAG_ALL,
            });
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorPlatform.ListGames(search, page ?? 1, pageSize ?? 50));
            if (r.failed) return asErrorResult(r);
            return asTextResult({ success: true, rows: r.data?.rows ?? [], totalPage: r.data?.totalPage });
        },
    );
}
