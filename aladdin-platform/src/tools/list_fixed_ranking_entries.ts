/**
 * tools/list_fixed_ranking_entries.ts — aladdin_platform_fixed_ranking_platform_list_fixed_ranking_entries
 *
 * rajah: FixedRankingPlatform.ListFixedRankingEntries(req FixedRankingEntrySearchReq 1, page i32 2, pageSize i32 3)
 * （ranking_back_office.rajah:247，需要 @Permission "PlatCapCfg.FixedRanking.Data"）——查詢固定
 * 榜單（流水榜/盈利榜/等級榜）在指定週期的排行榜資料（後台「排行榜數據」頁面）。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證
 * （agrabah/src/servers/ranking_back_office/services/fixed_ranking_platform.ts:247-330，
 * methodListFixedRankingEntries）：真的跨服務呼叫 statistic（GetFixedRankingEntries）取真實
 * 排行榜資料，非 placeholder。
 * - `userId`/`identifier` 是精確搜尋，identifier 有帶但查不到對應玩家、或 kind 找不到設定，
 *   都是 invalidData 或直接回空清單（見下）——不是逐頁掃描找特定一筆的情境，本身就是分頁清單。
 * - `page`/`pageSize` 皆是裸 `i32`（非 PageSizeEnum），`<= 0` 會被拒絕（invalidData）。
 * - identifier 查不到對應玩家：回傳空清單 + totalPage=0（成功，非錯誤）。
 * - kind 找不到對應固定榜單設定（如非法列舉值）：回 invalidData。
 * - period 若無法換算出合法時間區間（`resolvePeriodToBucket` 拋例外，例如週期與 kind 語意不合）：
 *   同樣回空清單 + totalPage=0（成功，非錯誤），不會讓呼叫端誤以為是系統錯誤。
 * - `contributionValue`/`betAmount`/`winLoseAmount`/`registeredAtTimestamp` 皆是 i64，實測回傳
 *   十進位字串（同 list_fixed_ranking_settings.ts 的 updatedAtTimestamp 陷阱），逐筆用 Number() 轉換。
 *
 * **2026-08-26 已通過 dev 實測**（對 pk-platform.alddev.com 直接呼叫底層 rajah method，
 * 涵蓋：page=0 → errorCode=9 invalidData；不存在的 identifier → 空清單成功；kind=contribution +
 * period=allTime → 真實回傳 10 筆排行資料，totalPage=10，i64 欄位皆為十進位字串已確認需轉換）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { FixedRankingEntrySearchReq } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { FIXED_RANKING_KIND_MAP, FIXED_RANKING_KIND_KEYS, FIXED_RANKING_PERIOD_MAP, FIXED_RANKING_PERIOD_KEYS } from '../const.ts';

export function registerListFixedRankingEntriesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_fixed_ranking_platform_list_fixed_ranking_entries',
        {
            title: 'List entries of a fixed ranking board for a given period',
            description:
                '查詢固定榜單（流水榜/盈利榜/等級榜）在指定週期的排行榜資料（rajah: ' +
                'FixedRankingPlatform.ListFixedRankingEntries，需要權限節點 PlatCapCfg.FixedRanking.Data；' +
                '後台「排行榜數據」頁面）。turnover/profit（流水榜/盈利榜）只接受 thisWeek/lastWeek/' +
                'thisMonth/lastMonth；contribution（等級榜）只接受 allTime——帶不合語意的 kind+period 組合' +
                '不會報錯，而是靜默回空清單（2026-08-26 dev 實測確認的行為，非本工具限制）。' +
                'userId/identifier 是精確篩選（互斥擇一，identifier 查不到對應玩家會回空清單而非錯誤）；' +
                'currencyCode 留空時使用平台預設幣別。page/pageSize 是裸整數（非 PageSizeEnum），' +
                '<=0 會被拒絕。回傳的 contributionValue/betAmount/winLoseAmount/registeredAtTimestamp ' +
                '皆為一般數字（原始 RPC 是十進位字串，本工具已轉換）。',
            inputSchema: {
                kind: z.enum(FIXED_RANKING_KIND_KEYS).describe('固定榜單種類：turnover 流水榜 / profit 盈利榜 / contribution 等級榜'),
                period: z.enum(FIXED_RANKING_PERIOD_KEYS).describe(
                    '查詢週期：thisWeek/lastWeek/thisMonth/lastMonth 供 turnover/profit 使用，allTime 供 contribution 使用',
                ),
                userId: z.number().int().optional().describe('依會員 id 精確篩選，與 identifier 擇一'),
                identifier: z.string().optional().describe('依會員帳號精確篩選，與 userId 擇一；查不到對應玩家會回空清單'),
                currencyCode: z.string().optional().describe('金額統計幣別，留空使用平台預設幣別'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.number().int().min(1).default(50).describe('每頁筆數'),
            },
        },
        async ({ kind, period, userId, identifier, currencyCode, page, pageSize }) => {
            const req = FixedRankingEntrySearchReq.create({
                userId: userId ?? 0,
                identifier: identifier ?? '',
                kind: FIXED_RANKING_KIND_MAP[ kind ],
                period: FIXED_RANKING_PERIOD_MAP[ period ],
                currencyCode: currencyCode ?? '',
            });
            const r = await withAutoRelogin(() => remote.rankingBackOffice.fixedRankingPlatform.ListFixedRankingEntries(req, page, pageSize));
            if (r.failed) return asErrorResult(r);
            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                contributionValue: Number(row.contributionValue),
                betAmount: Number(row.betAmount),
                winLoseAmount: Number(row.winLoseAmount),
                registeredAtTimestamp: Number(row.registeredAtTimestamp),
            }));
            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
