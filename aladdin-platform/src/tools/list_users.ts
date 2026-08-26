/**
 * tools/list_users.ts — aladdin_platform_platform_list_users
 *
 * rajah: Platform.ListUsers(page i32 1, pageSize PageSizeEnum 2, account string 3, statuses [StatusEnum] 4)
 * (rows [PlatformUserEssential] 1, totalPage i32 2)
 * （rajah/services/platform.rajah:85-86，@Permission "AdminManagement.Permission.Users"）。
 *
 * 這支查的是「platform 後台管理員帳號」清單（後台登入用的管理帳號，非 app 一般會員），
 * 不要跟 app 會員清單搞混。
 *
 * method-category-checklist.md 第 0 節排除規則已過：非 Placeholder、非 @NoPublic。agrabah 對應實作
 * agrabah/src/servers/platform/services/platform.ts:94-165（methodListUsers）確認有真實實作，非
 * base class 的 notImplemented。
 *
 * 2026-08-26 讀 agrabah 後端原始碼查證（platform.ts:94-165）：
 * - `account` 不是精確比對，是 LIKE `%account%` 模糊比對（比對 login_provider_users.identifier，
 *   platform.ts:120-121），可用它有效縮小到接近單一目標。嚴格來說本 method 不吃 Search struct，
 *   不完全符合 method-category-checklist.md 第 2 節「A 級」定義的字面條件，但本工具把 page/pageSize
 *   直接暴露給呼叫端、如實回傳 totalPage，不在工具內部藏一份「只查第一頁」的翻頁邏輯，因此不落入
 *   第 2 節真正要防的 B 級危險模式（把清單查詢包裝成內部業務鍵查找、翻頁邏輯對呼叫端不透明）。
 * - `statuses` 是陣列，空陣列代表不篩選（platform.ts:125）。
 * - `pageSize` 是固定選項的 PageSizeEnum，`serverDefault`(0) 由後端轉成 DefaultPageSize（platform.ts:97）。
 * - 呼叫端看不看得到哪些列，取決於呼叫者角色：super 角色看全部，非 super 角色只看得到自己子角色
 *   （`GetChildRoles`）底下建立的帳號（platform.ts:95-118）——不是呼叫端能控制的篩選條件，是後端依
 *   登入身分自動套用的範圍限制，工具本身無法繞過或關閉。
 * - 回傳的 `PlatformUserEssential.roleId` 帶 `@Type "Select:Role"`（platform.rajah:6），代表這是
 *   後端既有角色清單裡的值，本工具原樣透出數字 id，不在此另建角色名稱對照（角色清單依平台自訂，
 *   非固定 enum，無法內建一份 map）。
 * - `lastIp` 是實際登入 IP、`account` 是登入帳號，皆屬第 8 節「一般 PII」灰色地帶（帳號非密碼，
 *   IP 非銀行卡號等強 PII，但仍是可識別個人的操作紀錄）；本工具原樣透出（同 service 其餘欄位
 *   如 status/roleId/otpStatus 為狀態列舉，無隱私疑慮），不做額外遮罩——後台管理員帳號本身即是
 *   本後台操作者才看得到的內部管理資訊，風險層級遠低於第 8 節針對 app 一般會員 PII 的規範對象。
 *
 * ⚠️ 2026-08-26 dev 實測發現真實 bug：`loggedInAtTimestamp`/`updatedAtTimestamp` 是 i64，
 * protobufjs decode 後可能是 Long 物件（`{low, high, unsigned}`），直接透傳會讓 JSON.stringify
 * 序列化出這個內部結構而不是數字，已改用 const.ts 既有的 `toPlainNumber()` 轉換
 * （同 get_audit_logs.ts 已知的同類陷阱）。
 *
 * 純讀取查詢，不修改任何資料，可安全重複呼叫。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_KEYS, STATUS_MAP, PAGE_SIZE_KEYS, PAGE_SIZE_MAP, toPlainNumber } from '../const.ts';

function describeStatus(value: number | null | undefined): string | number {
    const found = (Object.keys(STATUS_MAP) as (keyof typeof STATUS_MAP)[]).find(key => STATUS_MAP[ key ] === value);
    return found ?? value ?? 'unknown';
}

const OTP_STATUS_MAP = { unbind: 0, bind: 1, reset: 2 } as const;
function describeOtpStatus(value: number | null | undefined): string | number {
    const found = (Object.keys(OTP_STATUS_MAP) as (keyof typeof OTP_STATUS_MAP)[]).find(key => OTP_STATUS_MAP[ key ] === value);
    return found ?? value ?? 'unbind';
}

export function registerListUsersTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_platform_list_users',
        {
            title: 'List platform back-office admin users',
            description:
                '分頁查詢本平台「後台管理員帳號」清單（後台登入用的帳號，不是 app 一般會員；' +
                'rajah: Platform.ListUsers，需要 @Permission "AdminManagement.Permission.Users"）。' +
                'account 是 LIKE 模糊比對（比對登入帳號），可用來縮小到接近單一目標；statuses 不帶或空陣列' +
                '代表不篩選狀態。⚠️ 呼叫端能看到哪些帳號取決於登入者角色：super 角色看得到全部，' +
                '非 super 角色只看得到自己子角色底下建立的帳號，這是後端依登入身分自動套用的範圍限制，' +
                '不是本工具能控制或關閉的篩選條件——查不到某帳號不代表它不存在，可能只是超出目前登入' +
                '身分的可見範圍。roleId 原樣回傳數字 id（後端既有角色清單裡的值，非固定 enum，本工具' +
                '未內建角色名稱對照）。純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('size50').describe('每頁筆數，只能是固定選項之一'),
                account: z.string().optional().describe('依登入帳號篩選，LIKE 模糊比對，省略則不篩選'),
                statuses: z.array(z.enum(STATUS_KEYS)).optional().describe('依狀態篩選（可多選），省略或空陣列代表不篩選'),
            },
        },
        async ({ page, pageSize, account, statuses }) => {
            const statusValues = (statuses ?? []).map(s => STATUS_MAP[ s ]);
            const r = await withAutoRelogin(() => remote.platform.main.ListUsers(page, PAGE_SIZE_MAP[ pageSize ], account ?? '', statusValues));
            if (r.failed) return asErrorResult(r);

            return asTextResult({
                success: true,
                totalPage: r.data?.totalPage,
                rows: (r.data?.rows ?? []).map(row => ({
                    id: row.id,
                    account: row.account,
                    status: describeStatus(row.status as number),
                    roleId: row.roleId,
                    lastIp: row.lastIp,
                    loggedInAtTimestamp: toPlainNumber(row.loggedInAtTimestamp),
                    updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
                    otpStatus: describeOtpStatus(row.otpStatus as number),
                })),
            });
        },
    );
}
