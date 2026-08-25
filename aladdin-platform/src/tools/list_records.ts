/**
 * tools/list_records.ts — aladdin_platform_room_gift_platform_list_records
 *
 * rajah: RoomGiftPlatform.ListRecords(params RoomGiftGetRecordParams 1)
 * (rows [RoomGiftRecordItem] 1, totalPage i32 2, totalRow i32 3)
 * （rajah/services/room_gift_back_office.rajah:250，@Permission "Room.Record.RoomGift"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （room_gift_platform.ts:methodListRecords）確認有真實實作，非 notImplemented。分類：
 * 第 2 節「讀取清單」A 級——search 有 senderUid/senderIdentifier/anchorUid/productIds
 * 等可鎖定單一目標的欄位，非只有範圍鍵+分頁。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（room_gift_platform.ts:methodListRecords，65-134 行）：
 * - **status 篩選有真實陷阱，已修正**：後端判斷式是
 *   `if (params.status != null && params.status !== RoomGiftRecordStatusEnum.all)`。
 *   `RoomGiftRecordStatusEnum.all = 99` 才是後端定義的「不篩選」語意；`pending = 0`。
 *   protobuf 的 i32/enum 欄位沒有欄位存在性追蹤，呼叫端「省略 status」與「明確傳 0」在
 *   wire 上無法區分，兩者到後端看起來都是 `status = 0`，會被判斷式當成「篩選 pending」，
 *   **不是**「不篩選」（跟 method-category-checklist.md 第 6 節談的 pending=0 陷阱是同一種
 *   結構性成因，但這裡不是查詢過濾器讀不到 0，而是「省略」與「pending」在 wire 上完全等價）。
 *   本工具的 status 參數**省略時內部固定送 "all"（99）**，不會讓呼叫端意外只查到 pending 紀錄。
 *   服務檔頭註解寫「預設只顯示 completed 狀態」與程式碼實際行為不符（程式碼行為以此為準，
 *   註解疑似過時或指的是前端 UI 表單預設值，不是這支 RPC 本身的預設語意）。
 * - `page`/`pageSize` 是裸 i32（非 PageSizeEnum），但因為有 senderUid/senderIdentifier/
 *   anchorUid/productIds 等可鎖定欄位，屬 A 級而非 B 級，不套用強制逐頁掃描規則；
 *   pageSize 省略時後端預設 20。
 * - `startDate`/`endDate` 為 ms timestamp，後端轉換 `Math.floor(ms/1000)` 塞進
 *   `FROM_UNIXTIME`，本工具原樣傳入 ms，不需呼叫端自己轉秒。
 * - `productPrice`/`totalPrice`/`anchorIncome`/`platformIncome` 是 CurrencyLink[]
 *   （多幣別，`{code, value}[]`），直接來自 DB JSON 欄位，本工具原樣透傳，不做額外換算。
 * - `createdAt` 為 i64，經 protobufjs decode 可能是 Long 物件，已用 `toPlainNumber()` 轉換。
 * - `orderId`/`productId`/`senderCurrencyCode` 在 rajah model 標 `@Hide`（後台表單不顯示），
 *   仍原樣回傳（`@Hide` 不影響 API 是否回傳這個欄位）。
 *
 * **2026-08-25 dev 實測的誠實限制**：pk-platform.alddev.com 這個 dev 站台目前沒有任何送禮紀錄
 * 資料（`list_room_gifts`/`get_room_gift_statistic_summary` 也都回空），省略 status 與明確帶
 * status="pending" 兩種呼叫實測皆回 totalRow=0，**無法用現有資料經驗證「省略=all」與
 * 「pending」回傳內容確實不同**——上方陷阱說明完全基於讀 agrabah 後端原始碼（非猜測），但
 * 這一項的行為差異本身未能用真實資料 round-trip 佐證，如實記錄此限制。已驗證項目：
 * RPC 正常呼叫不出錯、senderUid/productIds 等篩選欄位不出錯、非法月份格式正確回
 * errorCode=7（requestNotValid）、"YYYY-MM"/"YYYY/MM" 兩種日期格式皆可解析。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RoomGiftGetRecordParams } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { toPlainNumber } from '../const.ts';

const ROOM_GIFT_STATUS_MAP = { pending: 0, deductItemsFailed: 1, completed: 2, deductItemsRetryFailed: 3, refunded: 4, all: 99 } as const;
const ROOM_GIFT_STATUS_KEYS = Object.keys(ROOM_GIFT_STATUS_MAP) as [ keyof typeof ROOM_GIFT_STATUS_MAP, ...(keyof typeof ROOM_GIFT_STATUS_MAP)[] ];
function roomGiftStatusNumberToKey(value: number): string | number {
    return (Object.entries(ROOM_GIFT_STATUS_MAP).find(([ , v ]) => v === value)?.[ 0 ]) ?? value;
}

export function registerListRecordsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_room_gift_platform_list_records',
        {
            title: 'List live-streaming room gift send records',
            description:
                '查詢本平台直播間送禮紀錄（rajah: RoomGiftPlatform.ListRecords，需要權限節點 ' +
                'Room.Record.RoomGift）。senderUid/senderIdentifier/anchorUid/productIds 可用來精準鎖定，' +
                '只帶時間區間這類範圍性條件時結果可能較多，請善用分頁（pageSize 省略時預設 20）。' +
                '**status 省略時內部固定送 "all"，不會只查到 pending**：後端把「省略」與「明確傳 pending」' +
                '在協定層視為同一件事（都是 0），若省略時直接不處理，會被後端誤判成「只篩 pending（待處理）」' +
                '而非「不篩選」——本工具已處理這個陷阱，呼叫端不需要自己記得帶 status="all"。' +
                'productPrice/totalPrice/anchorIncome/platformIncome 是 CurrencyLink[] 多幣別陣列' +
                '（value 是後端已算好的顯示值，非 stored 整數，不需額外換算）。' +
                '這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).optional().describe('每頁筆數，預設 20'),
                senderUid: z.number().int().optional().describe('送禮者 uid，精準搜尋'),
                senderIdentifier: z.string().optional().describe('送禮者帳號，精準搜尋'),
                anchorUid: z.number().int().optional().describe('主播 uid，精準搜尋'),
                anchorName: z.string().optional().describe('主播暱稱，精準搜尋'),
                productIds: z.array(z.number().int()).optional().describe('禮物商品 id（複數），來自 list_room_gifts 的 id 欄位'),
                startDate: z.number().int().optional().describe('紀錄時間區間開始（ms timestamp）'),
                endDate: z.number().int().optional().describe('紀錄時間區間結束（ms timestamp）'),
                status: z.enum(ROOM_GIFT_STATUS_KEYS).optional().describe(
                    '紀錄狀態篩選：pending(待處理)/deductItemsFailed(扣道具失敗)/completed(完成)/' +
                    'deductItemsRetryFailed(扣道具重試失敗準備退款)/refunded(已退款)/all(全部)。' +
                    '省略時本工具內部固定送 "all"（後端把「省略」跟「pending」視為同一回事，見說明）',
                ),
            },
        },
        async (input) => {
            const params = RoomGiftGetRecordParams.create({
                page: input.page ?? 1,
                pageSize: input.pageSize ?? 20,
                senderUid: input.senderUid ?? 0,
                senderIdentifier: input.senderIdentifier ?? '',
                anchorUid: input.anchorUid ?? 0,
                anchorName: input.anchorName ?? '',
                productIds: input.productIds ?? [],
                startDate: input.startDate ?? 0,
                endDate: input.endDate ?? 0,
                status: ROOM_GIFT_STATUS_MAP[ input.status ?? 'all' ],
            });

            const r = await withAutoRelogin(() => remote.roomBackOffice.roomGiftPlatform.ListRecords(params));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                status: row.status != null ? roomGiftStatusNumberToKey(row.status) : row.status,
                createdAt: toPlainNumber(row.createdAt),
            }));

            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage, totalRow: r.data?.totalRow });
        },
    );
}
