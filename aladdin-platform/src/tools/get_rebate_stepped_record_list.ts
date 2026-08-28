/**
 * tools/get_rebate_stepped_record_list.ts —
 * aladdin_platform_rebate_platform_get_rebate_stepped_record_list
 *
 * rajah: RebatePlatform.GetRebateSteppedRecordList(options RebateRecordOptions 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [RebateSteppedRecord] 1, totalPage i32 2, totalRow i32 3)
 * （rebate_back_office.rajah:321；**method 本身沒有掛 @Permission**——權限由同 service 的
 * Placeholder 節點 PlaceholderBonusCenterTieredRebateRecord（rajah:346，@Permission 在 345，
 * "BonusCenter.TieredRebate.Record"）與 PlaceholderBonusCenterTieredRebateReview（rajah:352，@Permission 在 351，
 * "BonusCenter.TieredRebate.Review"）在前端 gate；service RebatePlatform 定義於同檔 268 行、
 * @Module "Rebate"（267）；非 @NoPublic、非 Placeholder）——後台「優惠中心 > 階梯式返水 >
 * 返水紀錄／返水審核」。
 *
 * agrabah 對應實作：rebate_platform.ts:1187-1360 methodGetRebateSteppedRecordList，確認有真實
 * override，不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」的 **A 級**——與
 * aladdin_platform_rebate_platform_get_rebate_record_list 共用同一個 search struct
 * （RebateRecordOptions，rajah:559-591），`orderId`/`userId` 可唯一鎖定目標。zod schema 對照
 * 該 model 全部 13 個欄位逐一列出（RebateRecordOptions 本身沒有 @Hide 欄位；回傳的
 * RebateSteppedRecord 反而有 @Hide 的 id/userId/validBet/profit，API 照樣回傳、本 tool 也照樣透傳）。
 *
 * ⚠️ **同一個 options model、同名欄位，在這支的語意不同**（第 0 節「同名 method 陷阱」的同構情況，
 * 讀源碼才看得出來，簽名完全看不出來）：
 * - 一般返水版：`rebateConfigIds` → SQL `rebate_config_id IN (?)`，值是**返水配置 id**
 *   （rebate_platform.ts:1085-1088，SQL 在 :1086）。
 * - 本 method：`rebateConfigIds` → SQL `rr.stepped_settlement_id IN (?)`（:1245-1247），
 *   值其實是**階梯配置 id**，也就是
 *   aladdin_platform_rebate_platform_get_rebate_global_setting 回傳的 steppedConfigList[].id。
 *   帶返水配置 id 進來不會報錯，只會查不到東西。
 * 其餘欄位（orderId/account/userId/statuses/四組時間區間）兩支語意相同。
 *
 * agrabah 實作細節（讀源碼查證）：
 * - **只回階梯式返水**：SQL 固定 `rr.stepped_settlement_id > 0`（:1194），與一般返水版的
 *   `= 0` 互斥；兩支合起來才是全部返水紀錄。
 * - 查詢是 `rebate_records AS rr LEFT JOIN rebate_stepped_configs AS sc ON sc.id =
 *   rr.stepped_settlement_id`（:1284-1285），排序 `ORDER BY rr.id DESC`（:1292），跨頁順序穩定。
 * - `steppedConfigName` 是後端組出來的顯示字串：`${sc.config_name}(${模式中文})`（:1308），
 *   模式中文取自寫死的簡體陣列 `['亏损返水', '流水返水']`（:1189）依 `rr.rebate_mode` 索引。
 *   ⚠️ 這代表：(a) 括號內是**簡體中文**、不是 enum 值；(b) LEFT JOIN 落空時 `sc.config_name` 是 SQL NULL，
 *   `queryObject.query()` 直接回 mysql2 原始 row、不做任何轉換
 *   （engines/relational_database/mysql/mysql_relational_database_engine.ts:56-64），
 *   所以樣板字串會產生字面的 **`null`**（不是 `undefined`）；(c) 只有 rebate_mode 落在 0/1
 *   之外、陣列索引未命中時，括號內才會是 `undefined`。呼叫端要判斷模式請看
 *   自己帶的篩選條件或另外查 global setting，不要 parse 這個字串。
 * - `betStatus` 與 `profitStatuis`（rajah 欄位名就是這樣拼，多一個 i）**不是 enum、是格式化過的
 *   金額字串**：`betStatus = "有效投注 / 中獎金額"`、`profitStatuis = "-profit / -(profit - 返水金額)"`
 *   （:1354-1355），用該筆幣別的 amountFormatter 轉出來，含千分位等格式。要做數值運算請改用
 *   同筆的 `validBet`／`profit`（rajah:551-555 上標 @Hide，但 API 照樣回傳的原始 i64）。
 *   ⚠️ **`profit` 的語意是「負營利」**（rajah:553 的註解就是這樣寫），後端顯示用的盈虧是
 *   `amountFormatter(-profit)`（:1355）——也就是說 profit 的**符號與直覺相反**，
 *   dev 實測 profit=55800 對應到的 profitStatuis 首段是 "-5.58"。拿它做運算前先確認符號方向。
 * - ⚠️ `account`／`betStatus`／`profitStatuis` 三個欄位都只在 `if (userIds.length > 0)` 區塊內
 *   才被填入（:1344-1357）——也就是說**只有查到資料時才有**，空結果自然沒有；但這也意味著這三個
 *   欄位不是 SQL 直接查出來的，而是事後補的。account 查不到時填 `-`。
 * - 本 method **沒有 parentAgent**（上級代理）——model RebateSteppedRecord（rajah:514-556）
 *   本身就沒這個欄位，與一般返水版不同，不要以為是後端漏填。
 * - ⚠️ **`status=verified` 且 `claim_limit_at IS NULL` 的雙重異常在這支同樣成立**（與一般返水版
 *   共用同一份邏輯）：`claim_limit_at` 是 nullable（migrations/rebate/
 *   202605110908_alter_rebate_records.sql:14 改成 `TIMESTAMP NULL DEFAULT NULL`，同檔 :3 還主動
 *   把舊資料設成 NULL），NULL → claimLimitAtTimestamp = 0（:1307）→ `0 < Date.now()` 成立 →
 *   status 被改寫成 expired（:1310-1311）；同時查詢端 `rr.claim_limit_at > NOW()`（:1235）與
 *   `<= NOW()`（:1237）對 NULL 皆不成立，所以這種紀錄用 statuses=["verified"] 或 ["expired"]
 *   **都查不到**，只有完全不帶 statuses 時才看得見（而且顯示成 expired）。
 * - statuses 的 verified／expired 改寫規則、回傳 status 就地改寫、nullable 時間欄位回 0、
 *   account 打錯回 idNotExists、account 與 userId 會 AND——全部與一般返水版**完全相同**
 *   （:1197-1209、:1231-1243、:1305-1312），因為兩支是同一份邏輯複製出來的。
 * - 判斷過期用的「現在」同樣是 `Date.now()`（server UTC）；帶時區的那行同樣被註解掉（:1282-1283）。
 * - totalPage/totalRow 一樣只有 page=1 才計算（database_helper.ts:204-230）。
 *
 * 第 8 節（敏感資料/PII）：回傳含 `account`（會員登入帳號），屬帳號識別碼；逐欄檢查 model
 * RebateSteppedRecord 後確認沒有 realName／銀行卡號／開戶姓名／token／密碼。不套用遮罩，
 * 但仍是可識別到個別會員的資料，呼叫端不應大量外流或持久化。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 1. page=1, pageSize=size10（無篩選）：success，rowCount=10、totalRow=69。
 *    ids = [1467, 1466, 1464, 1463, 1461, ...]（id desc）。欄位 union（10 筆合併）=
 *    id, orderId, account, steppedConfigName, rebateAmount, wageringAmount, claimAmount,
 *    createdAtTimestamp, claimAtTimestamp, verifyAtTimestamp, claimLimitAtTimestamp, status,
 *    userId, currencyCode, betStatus, profitStatuis, ratio, validBet, profit——
 *    **確認沒有 parentAgent**（與一般返水版的差異屬實），@Hide 的 validBet/profit 照樣回傳。
 * 2. `betStatus`／`profitStatuis` 是格式化字串實證：首筆 betStatus="8.8 / 3.22"、
 *    profitStatuis="-5.58 / -5.404"，而同筆的原始值 validBet=88000、profit=55800、
 *    rebateAmount=1760（stored value）——證實這兩欄已經過 amountFormatter 除以幣別倍率，
 *    不能拿來運算。
 * 3. `steppedConfigName` 組字串實證：實際值如 "測試非28(流水返水)"、"1.8(亏损返水)"、
 *    "综合返水(流水返水)"——括號內確實是寫死的簡體中文，且同一個配置名稱在不同紀錄上會出現
 *    不同模式（1.8 同時出現「流水返水」與「亏损返水」兩種），證實模式取自每筆紀錄自己的
 *    rebate_mode、不是配置當下的設定。
 * 4. **rebateConfigIds 語意實證（本檔最重要的一條）**：
 *    rebateConfigIds=[19]（取自 get_rebate_global_setting 的 steppedConfigList[0].id）
 *    → 2 筆，steppedConfigName 全是 "综合返水(...)"，正是 id=19 那筆階梯配置；
 *    rebateConfigIds=[15]（取自 get_rebate_configs 的返水配置 id）→ **0 筆、不報錯**。
 *    兩者合起來證實這個欄位比對的是 stepped_settlement_id 而非 rebate_config_id，
 *    且帶錯型別的 id 只會靜默查不到。
 * 5. **「目標記錄不在第一頁」情境**：page=2, pageSize=size10 → 10 筆，
 *    ids 開頭 [1454, 1453, 1451, 1450, 1449]，與第 1 頁不重疊；totalRow 回 0（page≠1 的既有陷阱）。
 * 6. **狀態改寫實證**：statuses=["expired"] → totalRow=3，回傳 status **全部是 5**，
 *    與一般返水版行為一致。
 * 7. **account 不存在**（account="no_such_user_zzz"）：success=false、errorCode=11、
 *    message="account not exists"，與一般返水版一致。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RebateRecordOptions } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, REBATE_RECORD_STATUS_KEYS, REBATE_RECORD_STATUS_MAP, deepFixLongs } from '../const.ts';

export function registerGetRebateSteppedRecordListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_get_rebate_stepped_record_list',
        {
            title: 'Search this platform\'s tiered (stepped) rebate records',
            description:
                '分頁查詢本平台的**階梯式（階層）返水**紀錄（rajah: ' +
                'RebatePlatform.GetRebateSteppedRecordList），對應後台「優惠中心 > 階梯式返水 > ' +
                '返水紀錄／返水審核」。' +
                '⚠️ 與 aladdin_platform_rebate_platform_get_rebate_record_list **互斥**：本 tool 只回 ' +
                '`stepped_settlement_id > 0` 的紀錄，那支只回 = 0 的一般返水，兩支合起來才是全部。' +
                '篩選條件（全部選填，彼此 AND）：orderId 返水單號（精確比對，最快鎖定單筆）、' +
                'account 會員帳號、userId 會員 id、statuses 狀態多選、' +
                '以及四組時間區間（生成／領取／審核／過期，皆為毫秒 timestamp，>= 起始、< 結束）。' +
                '⚠️ **rebateConfigIds 在這支的語意不是返水配置 id**，後端拿它去比對 ' +
                '`stepped_settlement_id`，也就是**階梯配置 id**——值要取自 ' +
                'aladdin_platform_rebate_platform_get_rebate_global_setting 回傳的 ' +
                'steppedConfigList[].id，不是 get_rebate_config_name_list 的 id。帶錯不會報錯，' +
                '只會查不到資料。' +
                '⚠️ account 與 userId 不要同時帶（會 AND，指向不同人必回 0 筆）；' +
                'account 打錯時後端回 errorCode=11（idNotExists）+ "account not exists"，不是空清單。' +
                '⚠️ 狀態語意同一般返水版：verified 查詢時被翻成「已審核 且 未過期」、expired 是' +
                '「已審核 且 已過領取期限」（DB 沒有 status=5），回傳的 status 也會照同規則就地改寫；' +
                '判斷用的「現在」是 server UTC 時鐘，不是平台時區。' +
                '⚠️ 未領取/未審核/無領取期限的時間欄位是 **0**，不是 null。' +
                '回傳的 status 是數字：0=未審核 1=已審核 2=已領取 3=已拒絕 4=已扣除 5=已過期 6=已撤銷。' +
                '⚠️ 「已審核 且 領取期限為 NULL（無期限）」的紀錄有雙重異常：回傳時會被誤標成 ' +
                'expired(5)，而且用 statuses=["verified"] 或 ["expired"] **都查不到**，' +
                '只有完全不帶 statuses 時才看得見。' +
                '回傳欄位注意：steppedConfigName 是後端組出來的顯示字串「配置名稱(模式簡體中文)」，' +
                'JOIN 不到階梯配置時前半會是字面的 null（SQL NULL 轉出來的），rebate_mode 超出 0/1 時' +
                '括號內才是 undefined——總之**不要 parse 它**；' +
                'betStatus 與 profitStatuis（欄位名就是多一個 i）是**格式化過的金額字串**' +
                '（「有效投注 / 中獎金額」「盈虧 / 實際盈虧」），要做數值運算請改用同筆的 ' +
                'validBet 與 profit（原始數值）——⚠️ 但 profit 的語意是「**負營利**」，' +
                '後端顯示的盈虧等於 -profit，符號與直覺相反，用之前先確認方向。' +
                '本 model **沒有 parentAgent**（上級代理），' +
                '那是一般返水版才有的欄位。' +
                '排序固定 rr.id 由大到小，跨頁順序穩定；' +
                'totalPage/totalRow 只有 page=1 時後端才會真的計算，第 2 頁起一律回 0。' +
                '金額欄位是 i64 stored value，已轉成一般數字。' +
                '⚠️ 回傳含 account（會員登入帳號），一次最多 200 筆——這是可識別到個別會員的資料，' +
                '不要大量外流或寫進持久化紀錄。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                orderId: z.string().optional().describe('返水單號（訂單編號），精確比對'),
                account: z.string().optional().describe('會員帳號；後端會先換成 userId，帳號不存在直接回 idNotExists。不要與 userId 同時帶'),
                userId: z.number().int().min(1).optional().describe('會員 id。不要與 account 同時帶'),
                rebateConfigIds: z.array(z.number().int()).optional().describe('⚠️ 在這支 method 是「階梯配置 id」陣列（後端比對 stepped_settlement_id），值來自 get_rebate_global_setting 的 steppedConfigList[].id，不是返水配置 id'),
                statuses: z.array(z.enum(REBATE_RECORD_STATUS_KEYS)).optional().describe('領取狀態多選（彼此 OR）；verified/expired 是後端依領取期限即時判定的，不是 DB 儲存值'),
                beginTimestamp: z.number().int().min(0).optional().describe('返水生成時間起（毫秒 timestamp，>=）'),
                endTimestamp: z.number().int().min(0).optional().describe('返水生成時間迄（毫秒 timestamp，<）'),
                claimBeginTimestamp: z.number().int().min(0).optional().describe('領取時間起（毫秒 timestamp，>=）'),
                claimEndTimestamp: z.number().int().min(0).optional().describe('領取時間迄（毫秒 timestamp，<）'),
                verifyBeginTimestamp: z.number().int().min(0).optional().describe('審核時間起（毫秒 timestamp，>=）'),
                verifyEndTimestamp: z.number().int().min(0).optional().describe('審核時間迄（毫秒 timestamp，<）'),
                claimLimitBeginTimestamp: z.number().int().min(0).optional().describe('過期時間起（毫秒 timestamp，>=）'),
                claimLimitEndTimestamp: z.number().int().min(0).optional().describe('過期時間迄（毫秒 timestamp，<）'),
                page: z.number().int().min(1).default(1).describe('頁碼，從 1 開始'),
                pageSize: z.enum(PAGE_SIZE_KEYS).default('serverDefault').describe('每頁筆數，只能是固定選項之一；serverDefault 由後端轉成 100'),
            },
        },
        async (input) => {
            const options = RebateRecordOptions.create({
                orderId: input.orderId ?? '',
                account: input.account ?? '',
                userId: input.userId ?? 0,
                rebateConfigIds: input.rebateConfigIds ?? [],
                statuses: (input.statuses ?? []).map((s) => REBATE_RECORD_STATUS_MAP[ s ]),
                beginTimestamp: input.beginTimestamp ?? 0,
                endTimestamp: input.endTimestamp ?? 0,
                claimBeginTimestamp: input.claimBeginTimestamp ?? 0,
                claimEndTimestamp: input.claimEndTimestamp ?? 0,
                verifyBeginTimestamp: input.verifyBeginTimestamp ?? 0,
                verifyEndTimestamp: input.verifyEndTimestamp ?? 0,
                claimLimitBeginTimestamp: input.claimLimitBeginTimestamp ?? 0,
                claimLimitEndTimestamp: input.claimLimitEndTimestamp ?? 0,
            });

            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateSteppedRecordList(options, input.page, PAGE_SIZE_MAP[ input.pageSize ]));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'errorCode=11（idNotExists）+ message "account not exists" 代表帶的 account 在本平台查無此會員，'
                        + '不代表這個人沒有階梯式返水紀錄。（errorName 會顯示「(未知錯誤碼)」是正常的：11 是 genie 框架層代碼，'
                        + '而反查用的 AgrabahErrorCodeEnum 從 101 起、不涵蓋框架層代碼。）'
                        + '其餘錯誤碼請照原樣回報，不要自行改條件重試。',
                });
            }

            const rows = deepFixLongs(r.data?.rows ?? []);
            return asTextResult({
                success: true,
                page: input.page,
                rowCount: rows.length,
                totalPage: r.data?.totalPage,
                totalRow: r.data?.totalRow,
                totalsOnlyValidOnFirstPage: true,
                rows,
            });
        },
    );
}
