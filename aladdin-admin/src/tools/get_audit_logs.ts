/**
 * tools/get_audit_logs.ts — aladdin_admin_audit_admin_get_audit_logs
 *
 * rajah: AuditAdmin.GetAuditLogs(search AdminAuditLogSearch 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [AdminAuditLogListItem] 1, totalPage i32 2)
 * （rajah/services/audit_back_office.rajah:98，service 定義於同檔 96-99 行，非 @NoPublic，
 * @Permission "AdminManagement.AuditLog"）
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic；agrabah
 * 對應 Service（agrabah/src/servers/audit_back_office/services/audit_admin.ts，
 * methodGetAuditLogs）確認有真實實作（真查 audit_logs 表、真分頁），非 base class 的
 * notImplemented。分類：第 2 節「讀取清單」A 級（search 有 targetId/operator 可鎖定單一
 * 目標的欄位，非只有範圍鍵+分頁）。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（audit_admin.ts:methodGetAuditLogs）：
 * - 與 aladdin-platform 的 aladdin_platform_audit_platform_get_audit_logs 是同一張
 *   `audit_logs` 表、幾乎相同的實作骨架，差異：這支不查會員帳號（identifier）、
 *   不支援 identifier 搜尋，改用 `targetId` 直接篩內部 id；查詢的是「Admin 端」操作
 *   （跨平台的系統管理操作），操作人帳號透過 `admin.main.GetUsersByIds` 取得（非平台使用者；後端
 *   docstring 與另一段註解誤寫成 admin.admin，實際呼叫見 audit_admin.ts:48 為 admin.main）。
 * - `pageSize` 型別是 `PageSizeEnum`（非裸 i32），合法值 0/10/20/30/50/100/200
 *   （0=serverDefault），伺服器端有強制上限，非 B 級高風險情境。
 * - **systemId 的「不篩選」語意特殊**：後端 `if (search.systemId >= 0)` 才加入篩選，
 *   呼叫端必須明確傳 -1 才是「不篩選」——0 是合法值（`SystemIdEnum.core`）。本工具 systemId
 *   省略時內部固定送 -1，選 "core" 才會真的送 0。
 * - **actionId 的「不篩選」語意**：`if (search.actionId > 0)` 才加入篩選，0=不篩選；已核對
 *   `AdminActionIdEnum`（122 個值）沒有定義任何 value=0 的成員，省略=0=不篩選不會誤篩掉任何
 *   真實業務值。122 個值數量可控，直接完整列舉成 z.enum（不像 platform 端 723 個值那麼誇張，
 *   那邊改用字串+呼叫前驗證）。
 * - `targetId` 篩選查無資料時單純回空結果，不是錯誤；`operator` 篩選查無此帳號時後端直接
 *   回傳空結果（`rows:[]`），不是錯誤。
 * - `before`/`after` 已由後端 `AuditFormatter` 格式化成人類可讀字串，本工具原樣透傳。
 * - `createdAtTimestamp` 為 i64，經 protobufjs decode 可能是 Long 物件，已用
 *   `toPlainNumber()` 轉換。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。回傳含管理員操作者帳號，屬內部帳號而非會員
 * PII，稽核日誌本來就該讓有權限的管理員查看，不額外遮罩。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { AdminAuditLogSearch } from '/Users/user/aladdin/abu/admin/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { SYSTEM_ID_KEYS, systemIdKeyToNumber, systemIdNumberToKey, ADMIN_ACTION_ID_KEYS, adminActionIdKeyToNumber, adminActionIdNumberToKey, toPlainNumber } from '../const.ts';

const PAGE_SIZE_VALUES = [ 10, 20, 30, 50, 100, 200 ] as const;

export function registerGetAuditLogsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_audit_admin_get_audit_logs',
        {
            title: 'Query system-level (admin) operation audit logs',
            description:
                '查詢系統管理後台（跨平台）的操作紀錄（稽核日誌）（rajah: AuditAdmin.GetAuditLogs，' +
                '需要權限節點 AdminManagement.AuditLog）。與 aladdin-platform 的 ' +
                'aladdin_platform_audit_platform_get_audit_logs 查同一張表，差異是這支不支援依會員帳號' +
                '搜尋、改用 targetId（操作目標內部 id）篩選，且是查 Admin 端（系統管理）操作，不是特定平台。' +
                'targetId/operator 可用來精準鎖定，只帶 systemId/actionId/時間區間這類範圍性條件時結果可能' +
                '較多，請善用分頁。' +
                'systemId 省略代表不篩選（內部固定送 -1，因為 0 是合法值 "core"，不能拿 0 當不篩選）；' +
                '選 systemId="core" 才會真的篩選出 core 系統的紀錄。' +
                'actionId 是 AdminActionIdEnum 的字串 key，省略代表不篩選。' +
                'pageSize 只接受 10/20/30/50/100/200（後端型別是 PageSizeEnum，非任意數字），省略時後端' +
                '套用伺服器預設值。before/after 是後端已格式化好的人類可讀字串（變更前後內容）；若被稽核的操作' +
                '本身涉及會員資料（如編輯會員真實姓名、提款帳戶），before/after 內可能包含這類真實個資（本 codebase' +
                'realName/銀行卡號未在既有 SensitiveFieldEnum 遮罩範圍內，格式化字串屬不透明內容，本工具無法逐欄' +
                '遮罩），請留意勿把回傳內容原樣寫入任何持久化 log。' +
                '純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                systemId: z.enum(SYSTEM_ID_KEYS).optional().describe('依系統項目篩選；省略代表不篩選全部系統'),
                actionId: z.enum(ADMIN_ACTION_ID_KEYS).optional().describe('依項目類型篩選；省略代表不篩選'),
                targetId: z.number().int().optional().describe('操作目標的內部 id；省略代表不篩選'),
                operator: z.string().optional().describe('依操作人員帳號精準搜尋；查無此帳號時回傳空結果，非錯誤'),
                createdAtTimestampStart: z.number().int().optional().describe('紀錄時間區間開始（ms timestamp）'),
                createdAtTimestampEnd: z.number().int().optional().describe('紀錄時間區間結束（ms timestamp）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union(PAGE_SIZE_VALUES.map((v) => z.literal(v)) as [ z.ZodLiteral<number>, ...z.ZodLiteral<number>[] ]).optional()
                    .describe('每頁筆數，只接受 10/20/30/50/100/200，省略時後端套用伺服器預設值'),
            },
        },
        async (input) => {
            const search = AdminAuditLogSearch.create({
                systemId: input.systemId !== undefined ? systemIdKeyToNumber(input.systemId) : -1,
                actionId: input.actionId !== undefined ? adminActionIdKeyToNumber(input.actionId) : 0,
                targetId: input.targetId ?? 0,
                operator: input.operator ?? '',
                createdAtTimestampStart: input.createdAtTimestampStart ?? 0,
                createdAtTimestampEnd: input.createdAtTimestampEnd ?? 0,
            });

            const r = await withAutoRelogin(() => remote.auditBackOffice.auditAdmin.GetAuditLogs(search, input.page ?? 1, input.pageSize ?? 0));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                systemId: row.systemId != null ? systemIdNumberToKey(row.systemId) : row.systemId,
                actionId: row.actionId != null ? adminActionIdNumberToKey(row.actionId) : row.actionId,
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
