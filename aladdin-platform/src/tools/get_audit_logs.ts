/**
 * tools/get_audit_logs.ts — aladdin_platform_audit_platform_get_audit_logs
 *
 * rajah: AuditPlatform.GetAuditLogs(search PlatformAuditLogSearch 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [PlatformAuditLogListItem] 1, totalPage i32 2)
 * （rajah/services/audit_back_office.rajah:92，service 定義於同檔 90-93 行，非 @NoPublic，
 * @Permission "AdminManagement.AuditLog"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah
 * 對應 Service（agrabah/src/servers/audit_back_office/services/audit_platform.ts，
 * methodGetAuditLogs）確認有真實實作（真查 audit_logs 表、真分頁），非 base class 的
 * notImplemented。分類：第 2 節「讀取清單」A 級（search 有 identifier/userId/operator 等
 * 可鎖定單一目標的欄位，非只有範圍鍵+分頁）。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（audit_platform.ts:methodGetAuditLogs）：
 * - `pageSize` 型別是 `PageSizeEnum`（非裸 i32），合法值 0/10/20/30/50/100/200
 *   （0=serverDefault，後端轉成 DefaultPageSize），伺服器端有強制上限，非 B 級高風險情境。
 * - **systemId 的「不篩選」語意特殊**：後端 `if (search.systemId >= 0)` 才加入篩選，代表
 *   呼叫端必須明確傳 **-1** 才是「不篩選」——0 是合法值（`SystemIdEnum.core`），不能拿 0
 *   當「不篩選」的預設值（那樣會誤篩成只查 core 系統的紀錄）。本工具的 systemId 參數省略時
 *   內部固定送 -1，選擇 "core" 時才會真的送 0。
 * - **actionId 的「不篩選」語意**：`if (search.actionId > 0)` 才加入篩選，0 = 不篩選；
 *   已核對 `PlatformActionIdEnum` 沒有定義任何 value=0 的成員，所以「省略=0=不篩選」不會誤篩掉
 *   任何真實業務值（不是 TransactionStatusEnum.pending=0 那種陷阱）。
 * - **actionId 有 723 個列舉值**，不比照 TRANSACTION_CATEGORY_KEYS 全部塞進 zod z.enum()
 *   （schema 會過度肥大），改用 z.string() + 呼叫前對真實 enum 物件做 key 存在性檢查，打錯字
 *   或不存在的 key 會在呼叫 RPC 前就被本工具擋下並回錯誤，不會靜默送出無效值或送出後才發現。
 * - `identifier` 篩選會觸發後端對 `SearchAppUserByIdentifier` 的分頁遍歷（找出所有匹配
 *   userId 再用 `target_id IN (...)`），會員基數大時可能較慢，屬後端既有實作，本工具不做
 *   額外處理。
 * - `operator` 篩選查無此帳號時，後端直接回傳空結果（`rows:[]`），不是錯誤。
 * - `before`/`after` 已由後端 `AuditFormatter` 格式化成人類可讀字串，本工具原樣透傳。
 * - `createdAtTimestamp` 為 i64，經 protobufjs decode 可能是 Long 物件，已用
 *   `toPlainNumber()` 轉換（同 list_user_transactions.ts 的陷阱）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳含真實會員帳號/操作者帳號等一般 PII
 * （非密碼/token 類），依 checklist 第 8 節屬一般 PII 範疇，但這是稽核日誌本來就該讓有權限的
 * 管理員查看的用途，不額外遮罩（跟既有 abu 後台「操作紀錄」頁面顯示的內容一致）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { PlatformAuditLogSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { PlatformActionIdEnum } from '/Users/user/aladdin/abu/platform/src/generated/remote.gen.ts';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { SYSTEM_ID_KEYS, systemIdKeyToNumber, systemIdNumberToKey, toPlainNumber } from '../const.ts';

const PAGE_SIZE_VALUES = [ 10, 20, 30, 50, 100, 200 ] as const;

export function registerGetAuditLogsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_audit_platform_get_audit_logs',
        {
            title: 'Query platform-level operation audit logs',
            description:
                '查詢本平台的操作紀錄（稽核日誌）（rajah: AuditPlatform.GetAuditLogs，需要權限節點 ' +
                'AdminManagement.AuditLog）。identifier/userId/operator 可用來精準鎖定特定會員或操作者，' +
                '只帶 systemId/actionId/時間區間這類範圍性條件時結果可能較多，請善用分頁。' +
                'systemId 省略代表不篩選（內部固定送 -1，因為 0 是合法值 "core"，不能拿 0 當不篩選）；' +
                '選 systemId="core" 才會真的篩選出 core 系統的紀錄。' +
                'actionId 是 PlatformActionIdEnum 的字串 key，共 723 個值，過多無法在此列舉；不確定拼字時' +
                '用 rajah-query skill 執行 `find-enum PlatformActionIdEnum` 查完整清單——本工具會在呼叫 RPC ' +
                '前先驗證 actionId 是否為合法 key，打錯字會直接回錯誤，不會靜默送出無效值。省略 actionId ' +
                '代表不篩選。' +
                'pageSize 只接受 10/20/30/50/100/200（後端型別是 PageSizeEnum，非任意數字），省略時後端' +
                '套用伺服器預設值。before/after 是後端已格式化好的人類可讀字串（變更前後內容）。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                systemId: z.enum(SYSTEM_ID_KEYS).optional().describe('依系統項目篩選；省略代表不篩選全部系統'),
                actionId: z.string().optional().describe(
                    'PlatformActionIdEnum 字串 key（如 "gameVendorEnable"）；省略代表不篩選。' +
                    '打錯字/不存在的 key 本工具會在呼叫前擋下並回錯誤',
                ),
                identifier: z.string().optional().describe('依會員帳號精準搜尋（操作目標）'),
                userId: z.number().int().optional().describe('依會員 id 精準搜尋（操作目標）'),
                operator: z.string().optional().describe('依操作人員帳號精準搜尋；查無此帳號時回傳空結果，非錯誤'),
                createdAtTimestampStart: z.number().int().optional().describe('紀錄時間區間開始（ms timestamp）'),
                createdAtTimestampEnd: z.number().int().optional().describe('紀錄時間區間結束（ms timestamp）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union(PAGE_SIZE_VALUES.map((v) => z.literal(v)) as [ z.ZodLiteral<number>, ...z.ZodLiteral<number>[] ]).optional()
                    .describe('每頁筆數，只接受 10/20/30/50/100/200，省略時後端套用伺服器預設值'),
            },
        },
        async (input) => {
            let actionId = 0;
            if (input.actionId !== undefined) {
                const resolved = (PlatformActionIdEnum as unknown as Record<string, number>)[ input.actionId ];
                if (resolved === undefined) {
                    return asTextResult({
                        success: false,
                        message: `actionId="${ input.actionId }" 不是 PlatformActionIdEnum 的合法 key，請用 rajah-query skill 的 find-enum PlatformActionIdEnum 確認正確拼字`,
                    });
                }
                actionId = resolved;
            }

            const search = PlatformAuditLogSearch.create({
                systemId: input.systemId !== undefined ? systemIdKeyToNumber(input.systemId) : -1,
                actionId,
                identifier: input.identifier ?? '',
                userId: input.userId ?? 0,
                operator: input.operator ?? '',
                createdAtTimestampStart: input.createdAtTimestampStart ?? 0,
                createdAtTimestampEnd: input.createdAtTimestampEnd ?? 0,
            });

            const r = await withAutoRelogin(() => remote.auditBackOffice.auditPlatform.GetAuditLogs(search, input.page ?? 1, input.pageSize ?? 0));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                systemId: row.systemId != null ? systemIdNumberToKey(row.systemId) : row.systemId,
                actionId: row.actionId != null ? ((PlatformActionIdEnum as unknown as Record<number, string>)[ row.actionId ] ?? row.actionId) : row.actionId,
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
