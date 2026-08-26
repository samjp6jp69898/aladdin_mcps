/**
 * tools/list_information_configs.ts — aladdin_platform_common_info_platform_get_configs
 *
 * rajah: CommonInfoPlatform.GetConfigs（information_back_office.rajah:81）。GetConfigs 自身沒有
 * @Permission、service 標頭也沒有 @Permission，屬於 rajah/CLAUDE.md「完全不綁 @Permission」的合法
 * 狀況（狀況一：service 無 @Permission，各 method 各自的 @Permission 各自獨立生效，沒有掛的就不會
 * 出現在權限樹）。同 service 內的 PlaceholderInformation（information_back_office.rajah:91）與
 * GetReadCount（同檔:94）各自有自己的 @Permission（分別是 "DailyOperation.Information"、
 * "DailyOperation.Information.Ops.View"），但這兩個節點各自承接的是自己，不會回頭綁到 GetConfigs——
 * GetConfigs 就是單純沒有掛權限節點的方法。
 *
 * 2026-08-25 讀 agrabah 後端原始碼查證（agrabah/src/servers/information_back_office/services/
 * common.ts:84-140，methodGetConfigs 真實實作，非 notImplemented 空殼）：
 * - 後台信息通用查詢服務，跨全部信息類型（公告/緊急通知/最新消息/必讀/系統通知……）共用同一支查詢，
 *   用 InformationSearch.type 篩選類型，不篩選時回傳全部類型。
 * - 依 InformationSearch 建構 SQL WHERE：ids（@Hide，精準查找）/ type / status（@Hide）/
 *   title（LIKE 模糊）/ content（LIKE 模糊）/ noExpired（@Hide，end_at 為空或 > 現在）/
 *   startAtFromTimestamp~startAtToTimestamp（生效開始時間範圍）。這是 method-category-checklist.md
 *   第 2 節「讀取清單」A 級（有 ids 可鎖定單一目標的欄位），zod schema 已對照 InformationSearch
 *   全部欄位列出，包含 @Hide 欄位。
 * - **status 篩選有一個非直覺的地雷，2026-08-25 獨立審查抓到、已修正**：`InformationSearch.create()`
 *   （protobufjs `Message` 建構子只在屬性值 `!= null` 時才賦值，`undefined` 會被跳過）配合後端
 *   `InformationSearch.prototype.status = 0` 這個 protobufjs 生成碼的 prototype 預設值，代表
 *   「不帶 status」等於
 *   「status=0（unknown）」，不是「完全沒有這個欄位」。common.ts:98 的判斷式
 *   `search.status != null && StatusEnum[search.status] !== undefined` 對 status=0 一樣成立
 *   （`StatusEnum[0] = 'unknown'`），因此「不帶 status」實際會精準比對 `status = 0`，**不會**落到
 *   101-104 行「排除 deleted」那個 else 分支——那個分支只有送一個**不在 StatusEnum 列舉範圍內**的值
 *   才會走到。前端 `abu/platform/src/pages/operation/MessageList.vue:157` 正是用這招：送
 *   `IGNORE_STATUS = -1`（`pages/operation/model/InformationModel.ts:1`，StatusEnum 沒有 -1 這個
 *   成員）達成「不篩選 status、只排除 deleted」的效果。本工具比照這個前端既有慣例，不帶 status 時
 *   同樣送 `-1`，不送 `undefined`。
 * - **pageSize 同樣有地雷，已修正**：`PageSizeEnum.serverDefault = 0` 只是名義上的列舉值，
 *   `agrabah/src/common/database_helper.ts` 的 `withPage(page, pageSize = DefaultPageSize)` 是
 *   JS 預設參數，只在傳入 `undefined` 時生效，傳入 `0` 不會觸發、會直接變成 `LIMIT 0, 0`（0 筆）。
 *   本工具不帶 pageSize 時改送 50（比照同 server `list_vendor_games.ts` 的既有慣例），不送 0。
 * - 固定帶 `platform_id = ?`（本平台範圍內查詢，非全平台共用母表），因此掛在 aladdin-platform
 *   server（service 名稱 CommonInfoPlatform 亦以 Platform 結尾），不是 aladdin-admin。
 * - 回傳的 CommonInfoConfig 含 gifts（該筆信息的贈品清單，另表 JOIN）與 roleConfig（角色可見範圍，
 *   透過 RoleConfigManager 查詢），皆為後端已合併好的完整資料，非另外呼叫其他 method 取得。
 * - startAtTimestamp/endAtTimestamp/createdAtTimestamp/updatedAtTimestamp 是 i64，實測與其他
 *   i64 欄位同款 protobufjs Long 物件 gotcha（見 const.ts toPlainNumber 說明），本工具已代為轉換。
 *   gifts 陣列內每筆 InfoGift 的 expireTime（information_back_office.rajah:15）同樣是 i64，
 *   本工具在組裝 rows 時一併轉換，不只轉頂層四個欄位。
 *
 * 2026-08-25 dev 實測（stdio 直打本工具，dev 帳密，對 pk-platform.alddev.com）：
 * 第一輪實測時 status/pageSize 尚未修正上述兩個地雷，不帶篩選條件、明確帶 status=deleted、
 * 帶 ids 精準查找、type 篩選、title 模糊搜尋等全部組合都回傳空清單——起初誤判為「這個 dev
 * 平台的信息系統資料表本來就是空的」，實際上是因為每次呼叫都在不知情的狀況下精準比對
 * `status = 0（unknown）`，這個 dev 平台的信息資料恰好沒有 unknown 狀態的紀錄，才會全部回傳
 * 空清單、掩蓋了這個 bug（獨立審查 B 讀原始碼揪出，未實測到有資料的情境即完成判定）。
 * 修正 status 送 -1、pageSize 送 50 之後重新實測，這次真的打到資料（該平台不含 deleted 的信息
 * 共 156 筆）：
 * - 不帶任何篩選條件：回傳非 deleted 的信息，totalPage=16（pageSize=10），確認排除 deleted 生效。
 * - 明確帶 status=deleted：回傳另一組不同 id 的紀錄，totalPage=4，確認精準比對 status 生效。
 * - **A 級「目標記錄不在第一頁」情境**：用 pageSize=200 一次取得全部 156 筆，取最後一筆 id=7；
 *   確認 id=7 不在 pageSize=10 的第一頁（ids 為 1294,1291,...,1272，不含 7），但用
 *   `ids: [7]` 精準查找能正確找到（totalPage=1, rows=[{id:7}]），驗證 A 級鎖定目標欄位不受
 *   分頁影響。
 * - type=announcement / title 模糊搜尋「公告」：皆回傳對應篩選結果，非空清單。
 * - 讀回的 startAtTimestamp/endAtTimestamp/createdAtTimestamp/updatedAtTimestamp 皆為一般數字
 *   （非 Long 物件），確認 toPlainNumber 轉換生效；本輪實測資料的 gifts 皆為空陣列，未實際
 *   驗證到 gifts[].expireTime 有值時的轉換，僅程式碼邏輯與頂層四欄位轉換路徑相同，風險低但
 *   如實記錄此驗證缺口。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { InformationSearch } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { STATUS_KEYS, STATUS_MAP, INFORMATION_TYPE_MAP, toPlainNumber } from '../const.ts';

// INFORMATION_TYPE_MAP 現在也被 create_urgent_info_config.ts（及後續其他 type 專屬 service 的
// tool）共用，已上移至 const.ts，這裡不再各自宣告一份。
const INFORMATION_TYPE_KEYS = Object.keys(INFORMATION_TYPE_MAP) as [ keyof typeof INFORMATION_TYPE_MAP, ...(keyof typeof INFORMATION_TYPE_MAP)[] ];

const PAGE_SIZE_VALUES = [ 10, 20, 30, 50, 100, 200 ] as const;

// 比照 abu/platform/src/pages/operation/model/InformationModel.ts 的 IGNORE_STATUS：StatusEnum
// 沒有 -1 這個成員，送 -1 才能真正落到後端「排除 deleted」的分支（見檔頭說明）。不能送 undefined——
// protobufjs InformationSearch.create() 對 undefined 屬性不賦值，會落回 prototype 預設值 0
// （StatusEnum.unknown），變成精準比對 status=0，不是「不篩選」。
const IGNORE_STATUS = -1;

// database_helper.ts 的 withPage(page, pageSize = DefaultPageSize) 只在 undefined 時套用預設值，
// 傳 0（PageSizeEnum.serverDefault 的名義值）會變成 LIMIT 0, 0（永遠 0 筆），比照同 server
// list_vendor_games.ts 的既有慣例改用固定預設值。
const DEFAULT_PAGE_SIZE = 50;

export function registerListInformationConfigsTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_common_info_platform_get_configs',
        {
            title: 'List back-office information configs',
            description:
                '分頁查詢本平台後台信息系統的設定清單（rajah: CommonInfoPlatform.GetConfigs），跨全部信息' +
                '類型（公告/緊急通知/最新消息/必讀/系統通知/站內信/循環贈獎/直播通知/一般通知/跑馬燈/代理商公告）' +
                '共用同一支查詢，用 type 篩選特定類型，不帶則回傳全部類型。無需權限節點（rajah 未綁 @Permission）。' +
                '不帶 status 時排除已刪除（deleted）的紀錄（本工具內部改送 -1，比照 abu/platform 前端' +
                'IGNORE_STATUS 慣例，不能直接不帶這個欄位，見檔頭說明的 prototype 預設值地雷）；明確帶' +
                'status（含 unknown/deleted）時精準比對該值。' +
                '回傳的 gifts/roleConfig 為後端已合併好的完整資料（贈品清單、角色可見範圍），不需要另外查詢。' +
                'startAtTimestamp/endAtTimestamp/createdAtTimestamp/updatedAtTimestamp（含 gifts[].expireTime）' +
                '皆為毫秒 epoch（已轉換為一般數字，不是後端原始的 protobufjs Long 物件）。',
            inputSchema: {
                ids: z.array(z.number().int()).optional().describe(
                    '依信息 id 精準查找（可多筆），對應 InformationSearch.ids（rajah @Hide 欄位，後台表單' +
                    '不顯示但 API 支援，是本工具唯一能鎖定單筆目標的篩選欄位）',
                ),
                type: z.enum(INFORMATION_TYPE_KEYS).optional().describe('依信息類型篩選，不帶則回傳全部類型'),
                title: z.string().optional().describe('依標題模糊搜尋（LIKE %title%）'),
                content: z.string().optional().describe('依內容模糊搜尋（LIKE %content%）'),
                status: z.enum(STATUS_KEYS).optional().describe(
                    '依狀態篩選：unknown/enabled/disabled/frozen/deleted。不帶此欄位時排除 deleted' +
                    '（其餘狀態皆會出現，含 unknown）；明確帶任一值（含 unknown/deleted）則只回傳該狀態',
                ),
                noExpired: z.boolean().optional().describe('true 時只回傳尚未過期的信息（end_at 為空或 > 現在）'),
                startAtFromTimestamp: z.number().int().optional().describe('生效開始時間下限，毫秒 epoch（非秒）'),
                startAtToTimestamp: z.number().int().optional().describe('生效開始時間上限，毫秒 epoch（非秒）'),
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.union(PAGE_SIZE_VALUES.map((v) => z.literal(v)) as [ z.ZodLiteral<number>, ...z.ZodLiteral<number>[] ])
                    .optional()
                    .describe('每頁筆數，須為 PageSizeEnum 合法值之一（10/20/30/50/100/200），未提供時預設 50'),
            },
        },
        async ({ ids, type, title, content, status, noExpired, startAtFromTimestamp, startAtToTimestamp, page, pageSize }) => {
            const search = InformationSearch.create({
                ids: ids ?? [],
                type: type ? INFORMATION_TYPE_MAP[ type ] : undefined,
                title: title ?? '',
                content: content ?? '',
                status: status ? STATUS_MAP[ status ] : IGNORE_STATUS,
                noExpired: noExpired ?? false,
                startAtFromTimestamp: startAtFromTimestamp ?? 0,
                startAtToTimestamp: startAtToTimestamp ?? 0,
            });
            const r = await withAutoRelogin(() => remote.informationBackOffice.commonInfoPlatform.GetConfigs(search, page ?? 1, pageSize ?? DEFAULT_PAGE_SIZE));
            if (r.failed) return asErrorResult(r);

            const rows = (r.data?.rows ?? []).map((row) => ({
                ...row,
                startAtTimestamp: toPlainNumber(row.startAtTimestamp),
                endAtTimestamp: toPlainNumber(row.endAtTimestamp),
                createdAtTimestamp: toPlainNumber(row.createdAtTimestamp),
                updatedAtTimestamp: toPlainNumber(row.updatedAtTimestamp),
                gifts: (row.gifts ?? []).map((gift) => ({
                    ...gift,
                    expireTime: toPlainNumber(gift.expireTime),
                })),
            }));
            return asTextResult({ success: true, rows, totalPage: r.data?.totalPage });
        },
    );
}
