/**
 * tools/create_game_vendor.ts — agrabah_admin_create_game_vendor
 *
 * rajah: GameVendorAdmin.CreateOrUpdateGameVendor（game_back_office.rajah:310）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GameVendorEdit, GameVendorEssentialSearch } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult } from '../mcp_result.ts';
import { KNOWN_ADAPTERS, WALLET_TYPE_MAP } from '../const.ts';

export function registerCreateGameVendorTool(server: McpServer): void {
    server.registerTool(
        'agrabah_admin_create_game_vendor',
        {
            title: 'Create a third-party game vendor',
            description:
                '在 agrabah admin 後台建立一筆三方遊戲場館（rajah: GameVendorAdmin.CreateOrUpdateGameVendor，' +
                'id 留空即為新增）。呼叫前不需要手動先登入，本工具會在偵測到未登入或 token 過期時自動登入/重登一次。' +
                '成功後會自動用場館名稱呼叫 ListGameVendors 讀回剛建立的資料一併回傳，方便確認實際存進去的值。' +
                '注意：adapter / currencyCode / defaultLanguage 都是後端既有清單裡的值，不是任意字串，' +
                '填錯會被後端拒絕（回傳非 0 的 errorCode），此時不要自行猜測重試，應把後端訊息回報給操作者確認正確值。',
            inputSchema: {
                id: z.number().int().optional().describe('留空＝新增；帶入既有場館 id 則為更新（本 POC 主要驗證新增流程）'),
                adapter: z.string().describe(
                    `必須是後端已註冊的三方廠商 adapter 代碼。dev 環境 2026-08-18 實測已知合法值（可能隨時間增加，非窮舉）：${ KNOWN_ADAPTERS.join(', ') }`,
                ),
                name: z.string().min(1).describe('場館顯示名稱，建議加測試前綴如 ZZZ_TEST_ 方便事後辨識/清理'),
                walletType: z.enum([ 'normal', 'agent', 'commission' ]).describe('錢包型態：normal=一般錢包 / agent=代理錢包 / commission=佣金錢包'),
                currencyCode: z.string().describe('幣別代碼（例如 USD、TWD），須為平台既有幣別，否則會被拒絕'),
                exchangeRate: z.number().int().describe('匯率 × 10000 的整數（例如匯率 1.0 要傳 10000、32.5 要傳 325000），這是後端實際儲存值，不是顯示用小數'),
                defaultLanguage: z.string().describe('預設語系代碼（例如 en-US、zh-TW），須為平台既有語系'),
                transferLimit: z.number().int().min(0).describe('轉帳額度上限，整數，最小值 0'),
                userPrefix: z.string().optional().describe('使用者帳號前綴'),
                decryptedKey: z.string().optional().describe('廠商金鑰明文，後端會加密存放'),
                decryptedToken: z.string().optional().describe('廠商 token 明文'),
                apiUrl: z.string().optional().describe('廠商 API URL'),
                decimalPlaces: z.number().int().optional().describe('小數位數'),
                payload: z.string().optional().describe('額外設定，自由文字（TextArea）'),
                timezone: z.number().int().optional().describe('時區代碼'),
            },
        },
        async (input) => {
            const { walletType, ...rest } = input;
            const fields = { ...rest, walletType: WALLET_TYPE_MAP[ walletType ] };

            const gameVendor = GameVendorEdit.create(fields);
            const r = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.CreateOrUpdateGameVendor(gameVendor));
            if (r.failed) return asTextResult({ success: false, errorCode: r.errorCode, message: r.message });

            // round-trip 讀回驗證：用剛送出的名稱查回實際存的資料（比照 test-method 的「寫入型 method SOP」）。
            const search = GameVendorEssentialSearch.create({ name: fields.name });
            const listResult = await withAutoRelogin(() => remote.gameBackOffice.gameVendorAdmin.ListGameVendors(search, 1, 5));

            return asTextResult({
                success: true,
                message: '建立成功',
                readBack: listResult.success ? listResult.data?.rows : null,
            });
        },
    );
}
