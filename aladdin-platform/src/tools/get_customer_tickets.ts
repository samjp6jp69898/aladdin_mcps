/**
 * tools/get_customer_tickets.ts — aladdin_platform_customer_platform_get_customer_tickets
 *
 * rajah: CustomerPlatform.GetCustomerTickets（customer_back_office.rajah:57，
 * @Permission "DailyOperation.IsHandle.CsTicket"），對應「問題處理」→「客服工單」列表頁。
 *
 * 分類註記（method-category-checklist.md 第 2 節）：屬 A 級——search struct 有 workId/
 * identifier/orderId 等可鎖定單一目標的欄位，zod schema 已對照 rajah CustomerTicketsSearch
 * 全部欄位列出（exportRoleId 除外，見下）。
 *
 * 「不篩選」陷阱（2026-08-25 讀前端查證）：status/issueType/fromType/receiver 底層型別是
 * 裸 number，rajah 列舉最小值多數是 0（receiver 例外，CustomerDepartmentEnum 從 1 起跳），
 * 後端判斷式 `if (search.status >= 0)` 之類（receiver 是 `> 0`）永遠成立——前端
 * CustomerTicket.vue（issue_handling/CustomerTicket.vue:50-53、153-159）在「全部」時
 * 實際送出的是 `-1`，不是省略欄位或送 0。本 tool 比照：呼叫端不指定該欄位時一律送 -1，
 * 不能省略成 0（0 是合法列舉值，會被誤判成「只查 status=pending」之類的實質篩選）。
 *
 * receiver 欄位額外語意：後端會再疊加「AI客服 + 呼叫者所屬部門」的 IN 條件（getDepartment），
 * 這是操作者身分決定的可視範圍，不是本 tool 能控制的參數，如實在 description 說明。
 *
 * exportRoleId 未收錄進 inputSchema：這是後端內部「CSV 匯出時借用另一個角色的部門可視範圍」
 * 的機制（context.roleId<=0 時才生效），跟一般查詢用途無關，本 tool 不提供這個切換角色的
 * 能力，一律不帶（等同 0，不觸發該分支）。
 *
 * 個資揭露：回傳的 CustomerTicket 含會員真實姓名（name）與帳號（identifier）——這是客服工單
 * 處理的必要資訊（要處理工單必須知道是哪個會員提交的），不做遮罩；但呼叫端不應把這些欄位
 * 轉貼到工單處理以外的場景。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { CustomerTicketsSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { CUSTOMER_TICKET_STATUS_MAP, CUSTOMER_ISSUE_MAP, CUSTOMER_FROM_TYPE_MAP, CUSTOMER_DEPARTMENT_MAP, toPlainNumber } from '../const.ts';

/** 數字 → 對照表 key 的字串；查不到已知 key 時原樣回傳數字，不讓未知值消失。 */
function describeEnum<T extends Record<string, number>>(map: T, value: number | null | undefined): string | number {
    if (value === null || value === undefined) return value as never;
    const hit = Object.entries(map).find(([ , v ]) => v === value);
    return hit ? hit[ 0 ] : value;
}

const STATUS_KEYS = [ 'pending', 'enabled', 'disabled', 'inReview', 'processing' ] as const;
const ISSUE_KEYS = [ 'player', 'deposit', 'withdraw', 'other' ] as const;
const FROM_TYPE_KEYS = [ 'aladdin', 'komi' ] as const;
const DEPARTMENT_KEYS = [ 'ai', 'risk', 'finance', 'manual' ] as const;

export function registerGetCustomerTicketsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_customer_platform_get_customer_tickets',
        {
            title: 'List customer service tickets',
            description:
                '查詢本平台「問題處理」→「客服工單」列表（rajah: CustomerPlatform.GetCustomerTickets）。' +
                '回傳受限於目前登入角色所屬部門（含 AI客服，一律可見），不是全平台工單一定都看得到。' +
                '未指定 status/issueType/fromType/receiver 時視為「全部」，不會誤篩成該欄位的 0 值。' +
                'createdAt*/updatedAt* 是毫秒級 Unix timestamp。' +
                'amount 是 { code, value }，value 是十進位字串（i64，避免精度遺失，不是數字）。' +
                '回傳含會員真實姓名與帳號，屬客服工單處理必要資訊，請勿轉用於工單處理以外的場景。',
            inputSchema: {
                workId: z.string().optional().describe('工單號，模糊比對'),
                identifier: z.string().optional().describe('會員帳號，模糊比對'),
                orderId: z.string().optional().describe('訂單號，模糊比對'),
                title: z.string().optional().describe('工單標題，模糊比對'),
                status: z.enum(STATUS_KEYS).optional().describe('工單狀態，不指定為全部'),
                issueType: z.enum(ISSUE_KEYS).optional().describe('工單問題類型，不指定為全部'),
                fromType: z.enum(FROM_TYPE_KEYS).optional().describe('工單來源，不指定為全部'),
                receiver: z.enum(DEPARTMENT_KEYS).optional().describe('工單處理部門，不指定為全部（仍受登入角色可視部門範圍限制）'),
                createdAtTimestampStart: z.number().int().optional().describe('提交時間區間起（毫秒 Unix timestamp）'),
                createdAtTimestampEnd: z.number().int().optional().describe('提交時間區間迄（毫秒 Unix timestamp）'),
                updatedAtTimestampStart: z.number().int().optional().describe('操作時間區間起（毫秒 Unix timestamp）'),
                updatedAtTimestampEnd: z.number().int().optional().describe('操作時間區間迄（毫秒 Unix timestamp）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union([ z.literal(10), z.literal(20), z.literal(30), z.literal(50), z.literal(100), z.literal(200) ])
                    .optional().describe('每頁筆數，只接受 10/20/30/50/100/200（PageSizeEnum），省略時用後端 DefaultPageSize'),
            },
        },
        async (input) => {
            const search = CustomerTicketsSearch.create({
                workId: input.workId ?? '',
                identifier: input.identifier ?? '',
                orderId: input.orderId ?? '',
                title: input.title ?? '',
                status: input.status ? CUSTOMER_TICKET_STATUS_MAP[ input.status ] : -1,
                issueType: input.issueType ? CUSTOMER_ISSUE_MAP[ input.issueType ] : -1,
                fromType: input.fromType ? CUSTOMER_FROM_TYPE_MAP[ input.fromType ] : -1,
                receiver: input.receiver ? CUSTOMER_DEPARTMENT_MAP[ input.receiver ] : -1,
                createdAtTimestampStart: input.createdAtTimestampStart ?? 0,
                createdAtTimestampEnd: input.createdAtTimestampEnd ?? 0,
                updatedAtTimestampStart: input.updatedAtTimestampStart ?? 0,
                updatedAtTimestampEnd: input.updatedAtTimestampEnd ?? 0,
                exportRoleId: 0,
            });

            const r = await withAutoRelogin(() => remote.customerBackOffice.customerPlatform.GetCustomerTickets(search, input.page ?? 1, input.pageSize ?? 0));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map(row => ({
                id: row.id,
                status: describeEnum(CUSTOMER_TICKET_STATUS_MAP, row.status as number),
                workId: row.workId,
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
                updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
                identifier: row.identifier,
                name: row.name,
                receiver: describeEnum(CUSTOMER_DEPARTMENT_MAP, row.receiver as number),
                issueType: describeEnum(CUSTOMER_ISSUE_MAP, row.issueType as number),
                title: row.title,
                progress: row.progress,
                amount: row.amount,
                currencyCode: row.currencyCode,
                orderId: row.orderId,
                fromType: describeEnum(CUSTOMER_FROM_TYPE_MAP, row.fromType as number),
                applicantName: row.applicantName,
                operatorName: row.operatorName,
                description: row.description,
                remark: row.remark,
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage, totalRow: r.data?.totalRow });
        },
    );
}
