/**
 * tools/get_rebate_record_list.ts — aladdin_platform_rebate_platform_get_rebate_record_list
 *
 * rajah: RebatePlatform.GetRebateRecordList(options RebateRecordOptions 1, page i32 2,
 * pageSize PageSizeEnum 3) (rows [RebateRecord] 1, totalPage i32 2, totalRow i32 3)
 * （rebate_back_office.rajah:300；**method 本身沒有掛 @Permission**——權限是由同 service 的
 * Placeholder 節點 PlaceholderRebateRecordList（rajah:303，"BonusCenter.Rebate.RebateRecordList"）
 * 與 PlaceholderRebateRecord（rajah:312，"BonusCenter.Rebate.RebateRecord"）在前端 gate，
 * agrabah 方法 docblock 也明講這件事；service RebatePlatform 定義於同檔 268 行、
 * @Module "Rebate"（267）；非 @NoPublic、非 Placeholder）——後台「優惠中心 > 返水紀錄／返水審核」。
 *
 * agrabah 對應實作：rebate_platform.ts:1016-1185 methodGetRebateRecordList，確認有真實 override
 * （真的組 SQL 查 rebate_records + 兩支跨服務 RPC 補帳號與上級代理），不是 notImplemented stub。
 *
 * 分類：method-category-checklist.md 第 2 節「讀取清單」的 **A 級**——有 search struct
 * （RebateRecordOptions，rajah:559-591），且其中 `orderId`（返水單號）與 `userId` 都能唯一鎖定
 * 目標，不是只有範圍鍵+分頁的 B 級。依 A 級要求，zod schema 對照 rajah model **全部 13 個欄位
 * 逐一列出**（RebateRecordOptions 本身沒有任何 @Hide 欄位，所以沒有「@Hide 但 API 支援」的隱藏
 * 篩選鍵要補——注意這說的是 options，回傳的 model RebateRecord 反而有 @Hide 的 id 與 userId，
 * 那兩欄 API 照樣回傳、本 tool 也照樣透傳）。
 *
 * agrabah 實作細節（讀源碼查證，這些都不是從簽名看得出來的）：
 * - **只回「一般返水」**：SQL 固定加 `stepped_settlement_id = 0`（rebate_platform.ts:1034）。
 *   階梯式返水紀錄要用 aladdin_platform_rebate_platform_get_rebate_stepped_record_list
 *   （同一個 options model，但條件是 `stepped_settlement_id > 0`）。
 * - **account 篩選是先換 id 再查**：後端拿 account 去呼叫
 *   `appUser.appUserInternal.GetAppUserUserIdByIdentifiers`，查不到就直接回
 *   `ErrorCode.idNotExists`（11）+ message "account not exists"（rebate_platform.ts:1037-1049），
 *   不是回空清單。所以「帳號打錯」與「這個帳號沒有返水紀錄」是兩種不同回應。
 * - **account 與 userId 同時帶會 AND 兩個條件**（:1047 與 :1067 各自 push `user_id = ?`），
 *   兩者指向不同人時必定回 0 筆。本 tool 的 description 已提醒二擇一。
 * - **statuses 的 verified / expired 是查詢期改寫**（:1071-1083）：
 *   `verified` → `status = 1 AND claim_limit_at > NOW()`；
 *   `expired` → `status = 1 AND claim_limit_at <= NOW()`（DB 裡沒有 status=5 這種資料）；
 *   其餘狀態才是直接比對。多選時彼此 OR。
 * - **回傳的 status 也會被就地改寫**（:1138-1141）：status=verified 且 claimLimitAtTimestamp
 *   小於「現在」就改成 expired。⚠️ 這裡的「現在」用的是 `Date.now()`（server UTC 時鐘）——
 *   agrabah docblock 宣稱 2026-05-19 起改成 `Date.now() + context.timezone * 1000`（平台時區），
 *   但那一行在現行程式碼裡是**被註解掉的**（:1122-1123），實際跑的仍是純 UTC。這是文件與程式
 *   不一致，本檔如實記錄，不採信 docblock。
 * - nullable 時間欄位：claim_at / verify_at / claim_limit_at 在 DB 可為 null，後端用 `?.getTime()
 *   || 0` 轉（:1135-1137），所以「未領取／未審核／無領取期限」在回傳裡是 **timestamp 0**，
 *   不是 null，也不是缺欄位。
 * - ⚠️ **`status=verified` 且 `claim_limit_at IS NULL` 的紀錄有雙重異常**（把上面兩條接起來
 *   才看得出來，agrabah 自己的 docblock :1010 也漏了這個組合）。`claim_limit_at` 確實是
 *   nullable，而且真的存在這種資料——migration
 *   `migrations/rebate/202605110908_alter_rebate_records.sql:14` 把它改成
 *   `TIMESTAMP NULL DEFAULT NULL`，同檔 :3 還主動把舊資料的異常值 UPDATE 成 NULL。後果：
 *   (a) **回傳端誤標**：NULL → claimLimitAtTimestamp = 0（:1137）→ `0 < Date.now()` 成立 →
 *       status 被改寫成 expired（:1138-1141）。「無領取期限」被顯示成「已過期」。
 *   (b) **查詢端隱形**：`claim_limit_at > NOW()`（:1075）與 `claim_limit_at <= NOW()`（:1077）
 *       對 NULL 都不成立，所以這種紀錄用 statuses=["verified"] 查不到、用 ["expired"] 也查不到，
 *       只有**完全不帶 statuses** 時才看得見（而且顯示成 expired）。
 *   呼叫端要盤點「已審核但沒有領取期限」的紀錄時，必須不帶 statuses 全撈再自行判斷。
 * - configName 查不到對應返水配置時回退成字面字串 `{id: 123}`（:1133），不是空字串。
 * - `account` 與 `parentAgent` 是最後才用兩支跨服務 RPC 補上的（:1147-1183），查不到時填 `-`。
 * - **分頁有 ORDER BY id desc**（:1124），跨頁順序穩定（與同 service 的 GetRebateConfigs 不同，
 *   那支沒有排序）。回傳同時有 totalPage 與 totalRow，但一樣受 getPageData 的
 *   「只有 page=1 才計算」限制（database_helper.ts:204-230）。
 *
 * 第 8 節（敏感資料/PII）：回傳含 `account`（會員登入帳號）與 `parentAgent`（上級代理帳號），
 * 屬於帳號識別碼，**不是** checklist 第 8 節列管的 realName／銀行卡號／開戶姓名——本 model
 * （rajah:477-511）逐欄檢查後確認沒有這三類欄位，也沒有 token/密碼。金額欄位是純數字。
 * 因此不套用遮罩；但這仍是可識別到個別會員的資料，呼叫端不應把大量筆數的結果外流或持久化。
 *
 * 這是純讀取查詢，不修改任何資料，可安全重複呼叫。
 *
 * --- dev 驗證（2026-08-28，pk-platform.alddev.com，帳號 landon001；獨立 spike script 用
 *     @modelcontextprotocol/sdk 的 Client + StdioClientTransport spawn 本 worktree 的
 *     src/stdio.ts，呼叫真正註冊起來的 tool）---
 * 1. page=1, pageSize=size10（無篩選）：success，rowCount=10、totalPage=29、totalRow=290。
 *    ids = [1465, 1462, 1459, 1452, 1445, 1441, 1439, 1437, 1435, 1432]，確認 id desc 排序。
 *    單筆欄位 union（10 筆合併）= id, orderId, account, configName, rebateAmount, wageringAmount,
 *    parentAgent, claimAmount, createdAtTimestamp, claimAtTimestamp, verifyAtTimestamp,
 *    claimLimitAtTimestamp, status, rebatePeriod, userId, currencyCode——與 rajah model
 *    RebateRecord 的 16 個欄位完全對應，i64 皆已是一般數字（deepFixLongs 生效）。
 *    首筆 claimAtTimestamp / verifyAtTimestamp / claimLimitAtTimestamp 皆為 0，
 *    實證了「nullable 時間欄位回 0 而非 null」。
 * 2. **A 級「有可鎖定單一目標的欄位」實證**：orderId="cpXPf6qjMVRxm1zMVwLEDA" → rowCount=1、
 *    totalRow=1、命中 id=1465。
 * 3. **「目標記錄不在第一頁」情境**：page=2, pageSize=size10 → 10 筆，
 *    ids 開頭 [1428, 1427, 1426, 1425, 1424]，與第 1 頁完全不重疊；同時 totalRow 回 0
 *    （page≠1 不計算的既有陷阱，rows 仍正確），與 database_helper.ts:204-230 一致。
 * 4. account 篩選（account="tttest001"）：totalRow=19，回傳 status 混合 0/2/6。
 * 5. **account 不存在**（account="no_such_user_zzz"）：success=false、errorCode=11
 *    （idNotExists）、message="account not exists"——證實後端是報錯而不是回空清單。
 * 6. **statuses 的查詢期改寫實證**：statuses=["verified"] → totalRow=2，回傳 status 全為 1；
 *    statuses=["expired"] → totalRow=60，回傳 status **全部是 5**。DB 不存在 status=5 的資料，
 *    5 是後端依 claim_limit_at 是否已過即時改寫出來的，兩項實測與源碼判讀完全吻合。
 * 7. **account 與 userId 同時帶**（account="tttest001" + userId=1）：rowCount=0——證實兩個條件
 *    被 AND 起來、指向不同人時必回 0 筆，description 的提醒屬實。
 * 全程唯讀查詢，未寫入/修改任何 dev 資料，無需清理。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { RebateRecordOptions } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import { PAGE_SIZE_KEYS, PAGE_SIZE_MAP, REBATE_RECORD_STATUS_KEYS, REBATE_RECORD_STATUS_MAP, deepFixLongs } from '../const.ts';

export function registerGetRebateRecordListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_rebate_platform_get_rebate_record_list',
        {
            title: 'Search this platform\'s (non-tiered) rebate records',
            description:
                '分頁查詢本平台的**一般返水**紀錄（rajah: RebatePlatform.GetRebateRecordList），' +
                '對應後台「優惠中心 > 返水紀錄／返水審核」。' +
                '⚠️ 只回一般返水：後端固定加上 `stepped_settlement_id = 0` 條件，' +
                '階梯式（階層）返水紀錄請改用 ' +
                'aladdin_platform_rebate_platform_get_rebate_stepped_record_list。' +
                '篩選條件（全部選填，帶了才生效，彼此 AND）：orderId 返水單號（精確比對，' +
                '最快鎖定單筆的方式）、account 會員帳號、userId 會員 id、' +
                'rebateConfigIds 返水層級 id 陣列（值來自 ' +
                'aladdin_platform_rebate_platform_get_rebate_config_name_list）、statuses 狀態多選、' +
                '以及四組時間區間（生成 begin/end、領取 claimBegin/claimEnd、審核 verifyBegin/' +
                'verifyEnd、過期 claimLimitBegin/claimLimitEnd，皆為毫秒 timestamp，' +
                '區間語意是 >= 起始、< 結束）。' +
                '⚠️ account 與 userId 不要同時帶：後端會把兩個條件 AND 起來，指向不同人時必回 0 筆。' +
                '⚠️ account 打錯時後端回 errorCode=11（idNotExists）+ "account not exists"，' +
                '不是回空清單——這代表帳號不存在，不代表這個人沒有返水紀錄。' +
                '⚠️ 狀態語意：verified（已審核）在查詢時會被後端翻譯成「status=已審核 且 尚未過期」，' +
                'expired（已過期）則是「status=已審核 且 已過領取期限」——DB 裡沒有「已過期」這個' +
                '實際狀態值。回傳的 status 也會照同一規則就地改寫。判斷過期用的「現在」是 server ' +
                'UTC 時鐘，不是平台時區。' +
                '回傳的 status 是數字：0=未審核 1=已審核 2=已領取 3=已拒絕 4=已扣除 5=已過期 ' +
                '6=已撤銷；rebatePeriod：0=每日領取 1=時時領取。' +
                '⚠️ 「已審核 且 領取期限為 NULL（無期限）」的紀錄有雙重異常：回傳時會被誤標成 ' +
                'expired(5)，而且用 statuses=["verified"] 或 ["expired"] **都查不到**，' +
                '只有完全不帶 statuses 時才看得見。要盤點這類紀錄請不要帶 statuses。' +
                '⚠️ 未領取/未審核/無領取期限的紀錄，對應的 claimAtTimestamp / verifyAtTimestamp / ' +
                'claimLimitAtTimestamp 是 **0**（不是 null、也不是缺欄位）。' +
                'configName 查不到對應配置時會回退成字面字串「{id: 數字}」；' +
                'account / parentAgent（上級代理）查不到時填「-」。' +
                '排序固定 id 由大到小（新的在前），跨頁順序穩定；' +
                'totalPage/totalRow 只有 page=1 時後端才會真的計算，第 2 頁起一律回 0。' +
                '金額欄位（rebateAmount 返水金額、wageringAmount 稽核金額、claimAmount 已領金額）' +
                '是 i64 stored value，已轉成一般數字。' +
                '⚠️ 回傳含 account（會員登入帳號）與 parentAgent（上級代理帳號），一次最多 200 筆——' +
                '這是可識別到個別會員的資料，不要大量外流或寫進持久化紀錄。' +
                '純讀取查詢，不修改任何資料，可安全重複呼叫。',
            inputSchema: {
                orderId: z.string().optional().describe('返水單號（訂單編號），精確比對'),
                account: z.string().optional().describe('會員帳號；後端會先換成 userId，帳號不存在直接回 idNotExists。不要與 userId 同時帶'),
                userId: z.number().int().min(1).optional().describe('會員 id。不要與 account 同時帶'),
                rebateConfigIds: z.array(z.number().int()).optional().describe('返水層級（返水配置）id 陣列，符合其一即可；id 來自 get_rebate_config_name_list'),
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

            const r = await withAutoRelogin(() => remote.rebateBackOffice.rebatePlatform.GetRebateRecordList(options, input.page, PAGE_SIZE_MAP[ input.pageSize ]));
            if (r.failed) {
                return asErrorResult(r, {
                    hint: 'errorCode=11（idNotExists）+ message "account not exists" 代表帶的 account 在本平台查無此會員，'
                        + '不代表這個人沒有返水紀錄。（errorName 會顯示「(未知錯誤碼)」是正常的：11 是 genie 框架層代碼，'
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
