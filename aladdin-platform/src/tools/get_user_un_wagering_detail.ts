/**
 * tools/get_user_un_wagering_detail.ts — aladdin_platform_wagering_platform_get_user_un_wagering_detail
 *
 * rajah: WageringPlatform.GetUserUnWageringDetail（wagering_back_office.rajah:403）。
 * 方法本身沒有獨立 @Permission，套用 service 級的 @Permission "Finance.Wagering"（同檔 389）。
 *
 * 分類（method-category-checklist.md 第 2 節「讀取清單」）：**B 級**——參數只有範圍鍵
 * userId + page/pageSize，沒有任何能鎖定單一目標的欄位，正是該節點名的高風險形狀。
 * B 級的兩條強制要求都已處理：
 * 1.「禁止把這類 method 包成用業務鍵查特定一筆的內部查找工具」——本工具就是單純的分頁清單，
 *    不在內部做任何「掃頁找某一筆」的定位邏輯，所以該節的逐頁掃描細則（20 頁上限／逾時／
 *    hitScanCap 結構化狀態）不適用。要用業務鍵定位稽核紀錄，已有 A 級的 sibling
 *    ListUserWagerings（同檔 396，search 內有 identifier/userId 可鎖定目標，已包成
 *    ..._list_user_wagerings），不需要也不應該在這裡重新發明逐頁比對。
 *    （GetWageringScopes 不是這裡的業務鍵定位 sibling——它回的是單筆的限定結構，不是本清單的列。）
 * 2.「驗收案例必須含目標記錄不在第一頁」——2026-08-28 dev 實測已涵蓋（pageSize=5 的第 2 頁
 *    取得與第 1 頁完全不同的 5 筆）。
 *
 * 另注意 pageSize 是裸 i32、不是 PageSizeEnum，後端 withPage()
 * （agrabah/src/common/database_helper.ts:13-19）直接把它插進 LIMIT，沒有 clamp 上界。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { deepFixLongs } from '../const.ts';

export function registerGetUserUnWageringDetailTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_wagering_platform_get_user_un_wagering_detail',
        {
            title: 'Get one member\'s outstanding (un-wagered) audit detail',
            description:
                '分頁查單一會員「還沒完成的稽核（打碼量）明細」，也就是客服／出款人工審核時要看的' +
                '「這位會員還差多少流水沒打完、每一筆各是什麼來源」' +
                '（rajah: WageringPlatform.GetUserUnWageringDetail，套用 service 級權限節點 Finance.Wagering）。' +
                '2026-08-28 讀 agrabah 原始碼查證（agrabah/src/servers/wagering_back_office/services/' +
                'wagering_platform.ts:375-445）並實打 dev 驗證，以下五點務必先看清楚：' +
                '**(1) 只回未完成的、且只回該會員自己幣別的**——SQL 寫死 `status = pending` 且 ' +
                '`currency_code = 該會員的 currencyCode`（同檔 396+398、418-421+425），已完成／已解除的稽核' +
                '不會出現在這裡。要看 autoRemove／manualRemove（已解除）的紀錄請改用 ' +
                'aladdin_platform_wagering_platform_list_user_wagerings；' +
                '但請注意 **status=completed（已完成）的稽核在本 MCP 的任何一支 tool 都拿不到**——' +
                'ListUserWagerings 後端無條件把 completed 從篩選條件剔除、且空條件時走 ' +
                '`status <> completed`（wagering_platform.ts:224、229-231），這是後端限制不是工具沒做。' +
                '**(2) userId 不存在時回錯誤，不是空清單**——後端先呼叫 AppUserInternal.GetAppUserInfo，' +
                '查無會員直接回 userNotExists（errorCode 204）。這點與 list_user_wagerings 相反' +
                '（那支查無會員是靜默回空清單），所以這支反而可以拿來確認一個 userId 到底存不存在。' +
                '**(3) totalPage 與 userWageringInfo.unWageringAmount 都只有 page=1 才是真值**——' +
                'agrabah 通用分頁 helper getPageData（agrabah/src/common/database_helper.ts:208-217）' +
                '只在 page===1 時執行 count function，而這支 method 的未稽核總額 totalUnWageringAmount ' +
                '正好是在那個 count function 裡用 SUM 一併算出來的（wagering_platform.ts:390-406），' +
                '所以 page>=2 時 totalPage 與 userWageringInfo.unWageringAmount **兩個都會是 0**。' +
                'dev 實測確認：同一位會員第 1 頁回 unWageringAmount=39554000、第 2 頁回 0。' +
                '要拿總額請只信第一頁的值，不要把第二頁的 0 當成「已經沒有未稽核金額」。' +
                '**(4) rows[].wageringScopes 已內含，不必再呼叫 get_wagering_scopes**——後端在同一句 SQL 用' +
                '子查詢把稽核限定聚合進來了（同檔 409-427）；沒有限定的列不會有這個欄位（等同不限定）。' +
                '**(5) 回傳含會員帳號**——userWageringInfo.identifier 是該會員的登入帳號（會員個資），' +
                '每一頁都會回傳；同結構的 userId／currencyCode 也是每頁都正確，' +
                '只有 unWageringAmount 會在 page>=2 退化成 0（見第 (3) 點）。' +
                '金額欄位（unWageringAmount）是 stored 整數，stored = 人類金額 × 10^(decimalPlaces+2)' +
                '（jafar/src/exchange.ts:32-36），本工具不換算；幣別精度查 ' +
                'aladdin_platform_currency_platform_get_currencies 的 decimalPlaces。' +
                '本工具純讀取。',
            inputSchema: {
                userId: z.number().int().min(1).describe(
                    '會員 id（不是會員帳號字串）。用帳號換 id 的方式：呼叫 ' +
                    'aladdin_platform_wagering_platform_list_user_wagerings 帶 identifier，' +
                    '從 rows[].userId 取得。查無此會員會回 errorCode 204 userNotExists',
                ),
                page: z.number().int().min(1).default(1).describe(
                    '頁碼，從 1 開始。注意 totalPage 與 userWageringInfo.unWageringAmount 只有第 1 頁是真值',
                ),
                pageSize: z.number().int().min(1).default(50).describe(
                    '每頁筆數。後端沒有 clamp 上界（裸 i32 直接進 LIMIT），請自行給合理值',
                ),
            },
        },
        async ({ userId, page, pageSize }) => {
            const r = await withAutoRelogin(() => remote.wageringBackOffice.wageringPlatform.GetUserUnWageringDetail(userId, page, pageSize));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                rows: deepFixLongs(r.data?.rows ?? []),
                userWageringInfo: deepFixLongs(r.data?.userWageringInfo ?? null),
                totalPage: r.data?.totalPage ?? 0,
                notes: page === 1
                    ? 'totalPage 與 userWageringInfo.unWageringAmount 在第 1 頁是真值。'
                        + 'rows 只含 status=pending 且為該會員自身幣別的稽核；rows[].wageringScopes 為空/不存在代表該筆不限定遊戲範圍'
                    : 'page>=2：totalPage 與 userWageringInfo.unWageringAmount 後端固定回 0，'
                        + '不代表沒有資料／沒有未稽核金額——這兩個值請改看第 1 頁。'
                        + 'rows 只含 status=pending 且為該會員自身幣別的稽核。'
                        + '從中途頁開始翻時的終止條件請用 rows.length < pageSize 判定為最後一頁',
            });
        },
    );
}
