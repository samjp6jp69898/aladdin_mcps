/**
 * tools/get_roulette_record_list.ts — aladdin_platform_roulette_platform_get_roulette_record_list
 *
 * rajah: RoulettePlatform.GetRouletteRecordList(page i32 1, pageSize i32 2, option GetRouletteRecordOption 3)
 * (rows [RouletteRecord] 1, totalPage i32 2, totalRow i32 3)
 * （rajah/services/roulette_back_office.rajah:330，@Permission "BonusCenter.Lottery.LotteryRecord"，非 @NoPublic）
 *
 * method-category-checklist.md 第 0 節排除規則已過：agrabah 對應 Service
 * （agrabah/src/servers/roulette_back_office/services/roulette_platform.ts:773-890，
 * methodGetRouletteRecordList）確認有真實 override、真的查 DB，非 notImplemented。
 *
 * 分類：第 2 節「讀取清單」**A 級**——`option.account`（玩家登入帳號）可鎖定單一玩家的全部紀錄，
 * 不是「只有範圍鍵 + 分頁」。A 級要求 zod schema 對照 rajah `model GetRouletteRecordOption` 全部欄位
 * **包含 @Hide 欄位**：該 model 有 name / code(@Hide) / claimStatuses / account /
 * beginTimestamp / endTimestamp 六個欄位，六個都已列出（`code` 雖是 @Hide、後台表單不顯示，
 * 但 name 模糊搜尋沒有它就一定查不到，是本工具最需要暴露的欄位之一）。
 * 同時套用第 8 節（PII 橫切分類），見下方「PII 處理」。
 *
 * 2026-08-28 讀 agrabah 後端原始碼查證（roulette_platform.ts:773-890）：
 * - `option.name` 跟 GetRouletteConfigList 同款：先去 `id_localizations` 比對
 *   `value LIKE %name% AND service_id = rouletteConfigName AND code = ?`，**必須搭配 code**
 *   （語言代碼），只給 name 會用 `code=''` 查不到任何 target_id、後端硬塞 `config_id in (0)`
 *   → 無聲回空清單。本工具在參數層擋下這個組合。
 * - `option.account` 走跨服務 RPC `appUser.appUserInternal.GetAppUserUserIdByIdentifiers`
 *   換成 userId；**查無此帳號時回 `ErrorCode.idNotExists`（11）錯誤，不是回空清單**——
 *   跟大部分「查無資料回空清單」的 list method 語意相反，description 已標明。
 * - `option.beginTimestamp` / `endTimestamp` 後端是 `new Date(option.beginTimestamp)`，
 *   JS Date 的數字建構子吃的是**毫秒**，所以這兩個參數是**毫秒級 timestamp，不是秒級**。
 *   傳秒級數值會被解讀成 1970 年附近的時間、篩不到任何資料。2026-08-28 dev 實測驗證。
 * - `option.claimStatuses` 不是單純的 `claim_status IN (?)`：`expired` 在 DB 沒有獨立值，
 *   後端翻譯成 `(claim_status = unclaim AND expired_at <= NOW())`，`unclaim` 則翻譯成
 *   `(claim_status = unclaim AND expired_at > NOW())`，多選時以 OR 串接。
 *   回傳時也會就地改標：`claimStatus === unclaim && expiredAtTimestamp <= now` 的列會被改成
 *   `expired` 再回給呼叫端。所以「未領取」與「已過期」在 DB 是同一個值、只差過期時間比較。
 * - `account` 欄位在 DB 裡不存在，是回傳前用 `GetAppUserIdentifierByIds` 反查填上的；
 *   反查不到的 userId 會填 `'-'`。userId=0 在本表語意是「全服」而非某位玩家。
 * - 回傳有 `totalRow`（跟同 domain 另外兩支 list method 不同），但**totalPage 與 totalRow 都只有
 *   page=1 時是真值**——共用 helper `getPageData`（agrabah/src/common/database_helper.ts:204-217）
 *   只在 `page === 1` 時才跑 count。本工具在非第一頁把兩者都回傳 null，不透傳那個誤導性的 0。
 * - `pageSize` 是裸 i32（非 PageSizeEnum），後端只有 `pageSize === 0 ? DefaultPageSize(100) : pageSize`，
 *   沒有上界 clamp；依 checklist 第 2 節本工具自行把上限收在 200。
 *
 * **PII 處理（checklist 第 8 節）**：本 method 回傳的 `account` 是**真實玩家的登入帳號**。
 * 它同時是本 method 唯一的精準查詢鍵、也是後台紀錄頁的主要辨識欄位，遮罩會讓這支 tool 失去用途，
 * 因此不遮罩、原樣回傳；但 description 明確標示這是真實使用者識別資料，不應寫入任何持久化 log
 * 或未加密的對話紀錄，批量查詢（大 pageSize）等同一次性聚合大量玩家帳號，需自行評估必要性。
 * 回傳中**沒有** realName / 手機 / email / 銀行帳號 / token 類欄位（逐欄對照 rajah model 確認）。
 *
 * 2026-08-28 dev 實測（pk-platform.alddev.com，帳號 landon001）：
 * - 不帶篩選 pageSize=3：page=1 回 totalPage=197 / totalRow=589；page=50 仍有 3 筆且
 *   totalPage/totalRow 皆回 null（覆蓋 checklist 第 2 節「目標不在第一頁」的驗收要求）。
 * - account="tttest001" 精準命中 totalRow=15；account="no_such_user_zzz" 回 errorCode=11 +
 *   message="account not exists"（證實查無帳號是錯誤而非空清單）。
 * - claimStatuses=[expired] 回 25 筆且每列 claimStatus 皆為 expired；[unclaim] 回 19 筆皆 unclaim
 *   （證實後端就地換算的兩態確實可分開篩選）。
 * - name="紅包"+code="zh-CN" 回 161 筆；只給 name 被本工具參數層擋下。
 * - **毫秒 vs 秒級實證**：beginTimestamp=1782921600000/endTimestamp=1785513600000（毫秒）回 106 筆；
 *   同一組值改成秒級（1782921600/1785513600）回 totalRow=0——證實這兩個參數確實吃毫秒。
 * - 回傳 JSON 中沒有 protobufjs Long 物件殘留；各 timestamp 皆為毫秒級數字
 *   （如 createdAtTimestamp=1784878994000），amount/wageringAmount 為 stored 值（如 28800）。
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { GetRouletteRecordOption } from '/Users/user/aladdin/abu/platform/src/generated/types.gen.js';
import { remote, withAutoRelogin } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';
import {
    ROULETTE_REWARD_CLAIM_TYPE_MAP, ROULETTE_REWARD_TYPE_MAP,
    deepFixLongs, numberToMapKey,
} from '../const.ts';

const CLAIM_STATUS_KEYS = Object.keys(ROULETTE_REWARD_CLAIM_TYPE_MAP) as [ keyof typeof ROULETTE_REWARD_CLAIM_TYPE_MAP, ...(keyof typeof ROULETTE_REWARD_CLAIM_TYPE_MAP)[] ];

export function registerGetRouletteRecordListTool(server: McpServer): void {
    server.registerTool(
        'aladdin_platform_roulette_platform_get_roulette_record_list',
        {
            title: "List the current platform's roulette (lottery) draw records",
            description:
                '分頁查詢本平台的轉盤抽獎紀錄（rajah: RoulettePlatform.GetRouletteRecordList，需要權限節點 ' +
                'BonusCenter.Lottery.LotteryRecord；後台「優惠中心／抽獎機制／抽獎紀錄」頁）。' +
                '**回傳含真實玩家登入帳號（account）**：這是真實使用者識別資料，請勿寫入持久化紀錄；' +
                '用大 pageSize 批量拉取等同一次聚合大量玩家帳號，請確認確有必要。' +
                '**account 查無此帳號時後端回 idNotExists 錯誤（不是空清單）**，跟一般 list method 相反。' +
                '**name 必須搭配 code**（後端拿 code 去 id_localizations 比對語系，只給 name 會無聲回空清單），' +
                '本工具會在參數層擋下只給 name 的呼叫。' +
                '**beginTimestamp / endTimestamp 是毫秒級 timestamp**（後端直接 new Date(數字)），' +
                '傳秒級會被當成 1970 年附近、篩不到資料。' +
                '**claimStatus 語意**：unclaim(未領取) 與 expired(已過期) 在 DB 是同一個值，差別只在過期時間' +
                '比較；篩選與回傳都由後端就地換算，回傳的 claimStatus 已是換算後的結果。' +
                'totalPage / totalRow **只有 page=1 時是真值**（後端共用分頁 helper 只在第一頁跑 count），' +
                '非第一頁本工具回 null，請用「rows 筆數 < pageSize 即最後一頁」判斷終點。' +
                'amount / wageringAmount / 各 timestamp 皆為 stored 原始值（金額非人類可讀，需依幣別精度換算），' +
                '本工具不換算。userId=0 代表「全服」而非某位玩家。這是純讀取查詢，可安全重複呼叫。',
            inputSchema: {
                page: z.number().int().min(1).optional().describe('頁碼，從 1 開始，預設 1'),
                pageSize: z.number().int().min(1).max(200).optional()
                    .describe('每頁筆數，1~200，省略時送 0 由後端套用預設值 100。上限 200 是本工具加的保護（後端對這個裸 i32 參數沒有上界檢查）；含玩家帳號，建議只取所需筆數'),
                name: z.string().optional().describe('轉盤設定名稱模糊搜尋（多語名稱）。**必須同時提供 code**，否則後端一定回空清單'),
                code: z.string().optional().describe('language code（如 zh-CN / en-US），name 模糊搜尋時比對哪個語系的翻譯值；不搭配 name 時無作用'),
                account: z.string().optional().describe('玩家登入帳號（精確比對）。**查無此帳號後端回 idNotExists 錯誤，不是空清單**'),
                claimStatuses: z.array(z.enum(CLAIM_STATUS_KEYS)).optional().describe(
                    '領取狀態篩選：unclaim(未領取且未過期)/claimed(已領取)/expired(未領取且已過期)，可多選；省略或空陣列 = 不篩選',
                ),
                beginTimestamp: z.number().int().min(0).optional().describe('抽獎時間區間開始，**毫秒級** timestamp（不是秒級）'),
                endTimestamp: z.number().int().min(0).optional().describe('抽獎時間區間結束，**毫秒級** timestamp（不是秒級）'),
            },
        },
        async (input) => {
            if (input.name && !input.code) {
                return asTextResult({
                    success: false,
                    message: '帶了 name 就必須同時帶 code（語言代碼，如 zh-CN）：後端用 code 去 id_localizations 比對語系，'
                        + 'code 為空時查不到任何 config id，會無聲回傳空清單而不是報錯。'
                        + '可先呼叫 aladdin_platform_roulette_platform_get_config_name_list 看現有設定的 showName 用哪些語言代碼。',
                });
            }

            const option = GetRouletteRecordOption.create({
                name: input.name ?? '',
                code: input.code ?? '',
                claimStatuses: (input.claimStatuses ?? []).map((s) => ROULETTE_REWARD_CLAIM_TYPE_MAP[ s ]),
                account: input.account ?? '',
                beginTimestamp: input.beginTimestamp ?? 0,
                endTimestamp: input.endTimestamp ?? 0,
            });

            const r = await withAutoRelogin(() => remote.rouletteBackOffice.roulettePlatform.GetRouletteRecordList(
                input.page ?? 1,
                input.pageSize ?? 0,
                option,
            ));
            if (r.failed) {
                return asErrorResult(r, { hint: 'errorCode=11 是 idNotExists——本 method 最常見成因是 account 這個帳號在本平台不存在（不是「查無紀錄」）' });
            }

            // 各 timestamp、amount、wageringAmount 都是 i64，protobufjs decode 後可能是 Long 物件。
            const rows = (deepFixLongs(r.data?.rows ?? []) as Record<string, unknown>[]).map((row) => ({
                ...row,
                rewardType: numberToMapKey(ROULETTE_REWARD_TYPE_MAP, (row.rewardType as number) ?? 0),
                claimStatus: numberToMapKey(ROULETTE_REWARD_CLAIM_TYPE_MAP, (row.claimStatus as number) ?? 0),
            }));

            const page = input.page ?? 1;
            // F12（2026-08-28 最終覆核）：pagingNote 叫呼叫端用「rows 筆數 < pageSize」判斷終點，
            // 但省略 pageSize 時它並不知道實際頁大小（後端把 0 當 serverDefault 套用 DefaultPageSize=100，
            // agrabah/src/common/database_helper.ts:11）。這裡明確回報本次真正生效的頁大小。
            const effectivePageSize = input.pageSize ?? 100;
            return asTextResult({
                success: true,
                page,
                effectivePageSize,
                totalPage: page === 1 ? (r.data?.totalPage ?? 0) : null,
                totalRow: page === 1 ? (r.data?.totalRow ?? 0) : null,
                pagingNote: page === 1
                    ? 'totalPage / totalRow 在 page=1 是真值；其他頁一律為 null（後端只在第一頁跑 count），屆時請用「rows 筆數 < effectivePageSize」判斷是否最後一頁'
                    : 'totalPage / totalRow 只有 page=1 時才是真值（後端只在第一頁跑 count），故此處為 null。判斷是否最後一頁請用「rows 筆數 < effectivePageSize」',
                piiNote: 'account 是真實玩家登入帳號，請勿寫入持久化紀錄；userId=0 代表全服而非個別玩家',
                rows,
            });
        },
    );
}
