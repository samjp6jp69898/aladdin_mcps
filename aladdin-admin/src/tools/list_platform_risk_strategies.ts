/**
 * tools/list_platform_risk_strategies.ts — aladdin_admin_risk_admin_list_platform_risk_strategies
 *
 * rajah: RiskAdmin.ListPlatformRiskStrategies（risk.rajah:42）
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerListPlatformRiskStrategiesTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_risk_admin_list_platform_risk_strategies',
        {
            title: 'List a platform’s risk strategies (super-admin view)',
            description:
                '超管視角依 platformId 分頁查詢該平台所有風控策略（rajah: RiskAdmin.ListPlatformRiskStrategies，risk.rajah:42；' +
                '不分狀態篩選，啟用與停用的策略都會列出）。platformId 用 aladdin_admin_platform_management_list_platform_details 查。' +
                '每頁固定 100 筆（後端寫死，無 pageSize 參數可調）。' +
                '⚠️ 回傳的 PlatformRiskStrategyEssentialForAdmin 沒有 status/riskLevel 欄位（risk.rajah:79-86），' +
                '無法從這支的回傳結果本身判斷單筆策略是啟用還是停用，如需確認單筆狀態需另外查證。' +
                '⚠️ 分頁陷阱：totalPage 只有 page=1 時後端才會真的計算，page>1 時 totalPage 固定回 0' +
                '（agrabah getPageData 實作如此，見 agrabah/src/common/database_helper.ts）——翻頁時請先用 page=1 拿到正確的 ' +
                'totalPage 再決定要不要翻頁，不要用「page>1 時 totalPage=0」誤判成已無更多資料；沒有 totalPage 可用時改以 ' +
                '「rows.length < 100 視為最後一頁」判斷終點。' +
                '回傳的 riskStrategyCode 是 rajah RiskStrategyCodeEnum 數值（withdrawQuickly=1000 快進快出 / reviseWithdrawInfo=1001 ' +
                '修改取款信息 / walletMinus=1003 錢包負數 / auditAmountBelow=1004 流水未達標 / newActivityFirst=1005 新會員活動後首提 / ' +
                'countAmountAbove=1006 註冊後前N次提款 / gameHighProfit=1007 遊戲高倍盈利 / sportsHighProfit=1008 體育高盈利 / ' +
                'liveHighProfit=1009 真人高盈利 / chessHighProfit=1010 棋牌高盈利 / electronHighProfit=1011 電子高盈利 / ' +
                'lotteryHighProfit=1012 彩票高盈利 / esportsHighProfit=1013 電競高盈利 / betDepositBelow=1014 打碼量低 / ' +
                'continueAutoWithdraw=1015 連續自動取款 / withdrawAccountDuplicate=1017 出款帳號重複 / withdrawDeviceDuplicate=1018 ' +
                '提款裝置重複 / sameLoginIpCountTooHigh=1019 相同登入IP過多 / longTermInactivity=1020 長期未登錄提款 / ' +
                'firstDepositFrequently=3000 新會員首充前高頻建單，完整定義見 rajah/services/risk.rajah 的 RiskStrategyCodeEnum）；' +
                'category 是 RiskStrategyCategoryEnum 數值：capital=1 資金類 / behavior=2 行為類 / identityRisk=3 風險身份類 / ' +
                'promotion=4 優惠類 / systemAbnormal=5 系統異常類。' +
                '注意：rajah 另有同名 method RiskPlatform.ListPlatformRiskStrategies（risk.rajah:58，平台後台視角、僅鎖定當前 platformId、' +
                '不支援跨平台查詢），但該 service 屬於 abu/platform 閘道（見 abu/platform/rajah/project.json），aladdin_admin 端無法呼叫，' +
                '目前也還沒有任何 MCP tool 包裝它——避免把兩者搞混，本工具是超管跨平台版本。' +
                '回傳的 PlatformRiskStrategyEssentialForAdmin（risk.rajah:79-86）與平台版 PlatformRiskStrategyEssential（risk.rajah:104-113）' +
                '欄位不是超集關係：admin 版多帶 riskStrategyCode，但少了 status 與 riskLevel。',
            inputSchema: {
                platformId: z.number().int().describe('平台 id，用 aladdin_admin_platform_management_list_platform_details 查'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始；每頁固定 100 筆'),
            },
        },
        async ({ platformId, page }) => {
            const r = await withAutoRelogin(() => remote.risk.riskAdmin.ListPlatformRiskStrategies(platformId, page));
            if (r.failed) return asErrorResult(r);
            return asTextResult({
                success: true,
                rows: r.data?.rows ?? [],
                totalPage: r.data?.totalPage,
            });
        },
    );
}
