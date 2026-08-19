/**
 * tools/create_game.ts — agrabah_admin_create_game
 *
 * rajah: GameVendorAdmin.CreateOrUpdateGameVendorGame（game_back_office.rajah:319）
 *
 * 這是唯一真正能「憑空建立一筆全新廠商遊戲」的 method——會直接寫入
 * 全平台共用的「廠商遊戲母表」（game_vendor_games）。platform 後台沒有這個能力，
 * 只能對母表已存在的遊戲做「上架到本平台」（見 agrabah-platform 的
 * agrabah_platform_onboard_vendor_game）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GameEdit } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult } from '../mcp_result.ts';
import { GAME_TAG_MAP, GAME_TAG_KEYS, OPEN_MODE_MAP, OPEN_MODE_KEYS } from '../const.ts';

export function registerCreateGameTool(server: McpServer): void {
    server.registerTool(
        'agrabah_admin_create_game',
        {
            title: 'Create a brand-new game for a vendor',
            description:
                '在 agrabah admin 後台建立一筆全新的廠商遊戲（rajah: GameVendorAdmin.CreateOrUpdateGameVendorGame，' +
                'id 留空即為新增），會寫進全平台共用的廠商遊戲母表——這是唯一真正的「建立新遊戲」入口，' +
                'platform 後台做不到這件事。本工具操作的是全平台共用母表，結果與平台無關，不需要也不接受 platformId 參數。' +
                'gameVendorId 必須是既有場館的 id（可用 agrabah_admin_create_game_vendor ' +
                '的讀回結果拿到）——注意：場館的內部 id 全域共用（admin 建立的 id，platform 端看到的也是同一個數字），' +
                '但新建立的場館預設不會出現在任何 platform 的清單裡，要先由 admin 端呼叫 ' +
                'agrabah_admin_update_platform_game_vendor_status 為該場館啟用特定 platform，' +
                '否則 agrabah-platform 的 agrabah_platform_list_game_vendors 查不到剛建立的場館。' +
                'gameId 是廠商系統裡的原始遊戲代碼，同一 gameVendorId 底下不能重複。' +
                '成功後會呼叫 ListGames 讀回驗證。' +
                '注意：這支不支援 squareImage/rectangleImage/bannerImage 圖片欄位與 localizedName 多語系欄位——' +
                '建立後要設定圖片，改用 agrabah_admin_edit_game（同一支 gameVendorId+gameId 就能編輯剛建立的遊戲）。',
            inputSchema: {
                id: z.number().int().optional().describe('留空＝新增；帶入既有遊戲 id 則為更新'),
                gameVendorId: z.number().int().describe('廠商場館 id，新增時必填'),
                gameId: z.string().min(1).describe('廠商系統裡的原始遊戲代碼，同一廠商底下須唯一'),
                name: z.string().min(1).describe('遊戲名稱'),
                displayTag: z.enum(GAME_TAG_KEYS).optional().describe('遊戲分類：unknown/slot(電子)/board(棋牌)/fish(捕魚)/live(真人)/sport(體育)/eSport(電競)/lottery(彩票)'),
                rebateTag: z.enum(GAME_TAG_KEYS).optional().describe('返水分類，選項同 displayTag'),
                openMode: z.enum(OPEN_MODE_KEYS).optional().describe('開啟模式：embedded(內嵌，預設)/externalBrowser/embeddedWithTitle/inHouseGame/inHouseSport'),
                sortOrder: z.number().int().optional().describe('排序'),
                demo: z.boolean().optional().describe('是否為試玩'),
            },
        },
        async (input) => {
            const game = GameEdit.create({
                id: input.id,
                gameVendorId: input.gameVendorId,
                gameId: input.gameId,
                name: input.name,
                displayTag: input.displayTag ? GAME_TAG_MAP[ input.displayTag ] : undefined,
                rebateTag: input.rebateTag ? GAME_TAG_MAP[ input.rebateTag ] : undefined,
                openMode: input.openMode ? OPEN_MODE_MAP[ input.openMode ] : undefined,
                sortOrder: input.sortOrder,
                demo: input.demo,
            });

            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.CreateOrUpdateGameVendorGame(game));
            if (r.failed) return asTextResult({ success: false, errorCode: r.errorCode, message: r.message });

            // round-trip 讀回驗證：ListGames 沒有 gameId 篩選參數，只能撈該廠商前幾頁再用 gameId 比對。
            const listResult = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGames(input.gameVendorId, 1, 50));
            const matched = listResult.success
                ? listResult.data?.rows?.find((row) => row.gameId === input.gameId)
                : undefined;

            return asTextResult({
                success: true,
                message: '建立成功',
                readBack: matched ?? (listResult.success ? { note: '該廠商前 50 筆內沒找到，可能分頁較後面，非失敗', rows: listResult.data?.rows } : null),
            });
        },
    );
}
