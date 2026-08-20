# Method 分類檢查要求

給「新增一個 tool 的公版流程」(見 `README.md` 第二節)第 1 步(查清楚目標 RPC method)與第 5 步(dev 驗證)引用。目標:公版流程原本只要求「打一次 dev 成功」,對 list 類方法這種要求太弱——2026-08-20 真實 bug(`aladdin_admin_edit_game` 內部用 `ListGames` 找特定遊戲,寫死只查第一頁 200 筆,PP電子-XO 有 518 款遊戲時查不到、更新失敗)就是在「打一次 dev 成功」的驗收標準下漏測出來的,因為驗收時剛好用了排在前 200 筆內的遊戲。

來源:對 `rajah/services/*.rajah` 全部 101 檔、3358 支 method 的分類調查 + 三輪獨立對抗驗證(每個結論都嘗試被獨立反證過,非單一視角)。

**用法**:挑到候選 method 後,先過第 0 節排除規則,再依回傳型別/參數形狀對照第 1-11 節找到對應分類,套用該分類的檢查要求。**方法名不可信,必須看實際簽名與回傳型別**——這個 codebase 有大量「叫 Get 其實是分頁清單」「叫 List 其實一次全撈」「叫 Toggle 其實要帶明確目標狀態」的命名與實際行為不一致案例。

---

## 0. 前置排除規則(選 method 前先過濾)

- **排除所有 `^method Placeholder[A-Z]` 開頭的 method**(大小寫精確比對,PascalCase)。依據:`rajah/CLAUDE.md` 官方定義——Placeholder 不是 API,jasmine 產生 `.gen.ts` 時直接跳過(`jasmine/src/index.ts:77` 用 `startsWith('Placeholder')`,大小寫敏感),前端 `api.remote.*` 不存在對應函式。即使名字帶動作字眼(如 `PlaceholderBCActDataReviewBatchApprove`)也要排除,前綴優先於語意猜測。
  - **反向陷阱**:大小寫比對是精確字串比對,不是語意判斷。曾發現 `external_stream_back_office.rajah:91` 有 `method placeholderRoomExternalStream()`(小寫 p)——jasmine **不會**跳過它,會生成真實可路由的 stub,但對應 Service 沒有 override,呼叫後端會落回 base class 預設值直接回 `notImplemented` 錯誤。這種「命名想當 Placeholder 但大小寫打錯」的殘留方法,規則 0 的字面比對抓不到,必須額外一條檢查。
- **新增檢查(不只看命名)**:選定候選 method 後,去 agrabah 對應 Service 子類確認是否**真的有 override 該方法**、回傳的不是 base class 預設的 `GenieResult.error(ErrorCode.notImplemented, ...)`。純權限節點佔位符(常見於 `Export*`,見第 10 節)與大小寫打錯的偽 Placeholder,都會通過命名檢查但呼叫必定失敗,只有實際核對後端實作才抓得到。
- 確認所屬 service 是否 `@NoPublic`(內部 server-to-server RPC,非設計給外部呼叫)。是的話先確認業務上是否真的要對外開放成 agent 可用工具。
- **同名 method 陷阱**:codebase 大量存在「同名 method 分散在不同 service、定位方式/語意不同」(如 admin 端 `ListGames`/`UpdateGameVendorGameStatus` 用內部 id 定位,platform 端同名 method 卻用業務鍵定位)。挑 method 時必須連 `service Xxx { ... }` 區塊一起確認,不能只 grep 方法名字。

## 1. 讀取單筆(Get by id / 複合 key,回傳單一 model)

- 實測「id 不存在」的實際行為(回錯誤碼 / 空值 struct / 拋例外)——.rajah 沒有 `@Optional` 標記回傳值,無法從 schema 判斷,必須實打。
- 跨租戶風險:id 沒搭配 platformId/agentId 一起驗證時,實測能否用別平台/別人的 id 撈到不該看到的資料。
- 複合 key(如 `GetGameVendorGameForEdit(gameVendorId, gameId)`)要驗證「兩個 key 都存在但不成對」的行為,不只驗證單一 key 不存在。
- `*ForEdit` 系列欄位通常比顯示版多,逐欄檢查回傳 model 有沒有不該給 agent 看到的內部欄位。
- **`Get` 前綴不保證唯讀**:實測發現 `GetRouletteRewardByRecordId(id)` 簽名完全符合「id → 單一 model」的樣子,實作卻是**領獎動作**(寫入 claim 狀態、第二次呼叫同一 id 直接報錯「already claimed」)。看到方法名或註解出現「領取/claim/consume」等字眼,一律比照第 6/9 節「假唯讀 / 不冪等」規則處理,tool description 要標明重複呼叫的後果。
- 若回傳/輸入涉及密鑰、密碼、token,額外套用第 8 節。

## 2. 讀取清單 / 集合查詢(List / Search / Query / 部分 Get / Batch 查詢)——今天真實出包的分類,要求最嚴格

判準:回傳陣列(`rows`),不論方法名是 Get/List/Search/Query。

依「有沒有能唯一鎖定目標的欄位」分險級:

- **A 級(相對安全)**:有 `search` struct 且其中有可鎖定單一目標的欄位(id/ids/code)。zod schema 必須對照 rajah `model XxxSearch` **全部欄位**列出,**包含 `@Hide` 欄位**(`@Hide` 只代表後台表單不顯示,API 仍支援,往往是 MCP tool 最需要的精準查找欄位)。
- **B 級(高風險,強制檢查)**:只有範圍鍵(`gameVendorId`/`platformId`/`appId` 等) + page/pageSize,**沒有**能鎖定單一目標的欄位。**這不是孤例**,實測至少 8 支同構案例,包含 `GameVendorAdmin.ListGames(gameVendorId, page, pageSize)`(今天出包那支)、`ListAppVersions(appId, page, pageSize)`、`GetFirstLevelList(pageId, page, pageSize)`、`GetSecondLevelList(parentId, page, pageSize)`、`GetBillItems(billId, page, pageSize)`、`GetMemberMissionRecords(activityId, page, pageSize)`、`ListUserWageringsByUser(userId, page, pageSize)`、`GetAgentHistoricalCommission(agentId, page, pageSize)`。可用 `grep -n "(.*Id i32 1, page i32 2, pageSize i32 3)" services/*.rajah` 之類 pattern 自行擴大稽核,不要只信賴這份清單。
  - **禁止**把這類 method 包成「用業務鍵查特定一筆」的內部查找工具,除非 tool 內部明確逐頁掃描到底。
  - 選 method 前先確認是否已有用業務鍵直接查詢的 sibling method(如 `GetXxxForEdit(業務鍵)`)——若有,禁止自己重新發明「List 全部 + 逐頁比對」邏輯。
  - **逐頁掃描到底的具體做法**(不能只寫「掃到底」三個字):
    1. 先確認 `pageSize` 參數型別。若為 `PageSizeEnum`,伺服器端有強制上限(目前 200,見 `common.rajah` `PageSizeEnum`);若為裸 `i32`(如今天出包的 `ListGames`,後端 `pageSize = pageSize || DefaultPageSize` 沒有 clamp 上界),**不要**賭一次塞極大 pageSize 取代翻頁,仍用該 service 慣用分頁大小逐頁掃描。
    2. 掃描上限:總掃描列數上限 = 20 頁 × min(pageSize, 200)(約 4000 筆),整體逾時 30 秒、單頁請求逾時 5 秒,超過任一項即中止,不無限重試。
    3. 觸頂時回傳結構化狀態,例如 `{ found: false, scannedPages, scannedRows, hitScanCap: true }`——不能只回「已掃描全部 N 頁」,那句話在「還沒掃到底就先觸頂」時語意矛盾。
    4. 若已知或預期某廠商/範圍規模會持續成長超過此上限,視為「此 method 不適合逐頁掃描做定位查找」,應優先要求後端補一支帶業務鍵的直接查詢 method,而非無限調高掃描上限。
  - **驗收測試案例必須包含「目標記錄不在第一頁」的情境**,不能只用第一頁有資料的情境驗收(今天的 bug 就是這樣被漏掉的)。
- 隱藏分頁陷阱:分頁欄位可能藏在 `params`/`search` model 內部,方法頂層簽名看不出來,必須展開巢狀 model 定義確認。
- 回傳沒有 `totalPage`/`totalRow` 的:不能用 `rows.length > 0` 當翻頁終止條件,用 `rows.length < pageSize` 視為最後一頁,tool 文件需註明「此 method 無 total 可判斷終點」。
- 完全不分頁的全撈:語意上是小型列舉表可放心用,但若底層是會持續成長的表(歷史/log 類),要向 owner 確認有無底層 LIMIT,不能無腦視為安全。
- Batch 開頭的查詢類(`BatchGetXxx(ids)`):不能假設回傳陣列與輸入 id 陣列同長度、同順序;查不到的 id 是否出現在結果裡,必須用回傳資料裡的 id 欄位重新比對,不能用 index 對應。
- 游標式掃描(`lastId`/`batchSize` 而非 page/pageSize):本質同 B 級的翻頁到底要求,終止條件換成「回傳空 / 回傳筆數 < batchSize」。

## 3. 寫入 — 新增(Create / Add)

- 完成後用回傳 id 呼叫對應 Get 做 round-trip 驗證,不能以 RPC 不報錯視為業務正確。
- 有天然業務鍵(如 code)的,建議/強制先查重再建立。
- `Add*` 不保證是「新增實體」,底層機制**必須逐一查證,不能只憑名字假設同一種模式**——實測發現至少三種不同行為:
  - 真累加(如 `AddUserWagering`:每次呼叫都新增一筆稽核紀錄、靠 SUM 聚合總額)——重試會重複累加,**不可對它自動重試**。
  - 絕對值 SET + 天然冪等保護(如 `AddAppUserWithdrawCount`:實際是 `cache.set` 覆寫,且用 exists 檢查做「每日只能改一次」,第二次呼叫直接報錯)——這種反而安全,重試會被後端擋下,不要誤判成危險的累加型。
  - 建立關聯/白名單(如 `AddRoomManager`):冪等性簽名看不出來,需要實測。

## 4. 寫入 — Upsert / CreateOrUpdate

判準:方法名含 `CreateOrUpdate`/`Upsert`,吃一個 `XxxEdit` model。

**結構性事實**:整個 rajah services 目錄找不到任何 `@Optional`/`@Partial` 欄位存在性標記。但**後端實際合併行為不可一概而論,逐 method 不同,已驗證至少三種真實存在的模式**:
1. 真正的後端局部合併(先 load 現有列,只手動改指定欄位,其餘不動)。
2. 通用 ORM `assignKey` 合併(靠 protobuf 稀疏編碼判斷欄位是否有被設定,未設欄位保留 DB 原值)——但**有地雷**:數字欄位若使用 prototype 預設值 `0`,`assignKey` 的判斷式會把它當「呼叫端明確要設成 0」的有效值硬覆蓋進 DB,等同強制歸零所有未帶到的數字欄位。
3. 真正整包覆蓋、完全沒有 pre-load,直接拿呼叫端傳入的物件建新 row 去 update。

因為後端行為完全不可預測、逐 method 不同,**「先讀現值、只覆蓋要改欄位」這條操作性要求必須無條件保留**(不是因為「backend 一律沒有合併邏輯」,而是因為你事先不知道這支落在哪一種模式,先讀現值合併是唯一在三種模式下都安全的做法):

1. 包這類 method 前必須先呼叫對應的 `GetXxxForEdit` 取得完整現值,只覆寫呼叫端明確要改的欄位,其餘原樣帶回。沒有先讀現值就直接建構 payload 呼叫,視為不合格實作。
2. 完成後 round-trip 再讀一次,逐欄比對「沒有要求變更的欄位」是否仍等於呼叫前的值,**尤其陣列/多語系欄位與數字欄位**(數字欄位為 0 時尤其容易被誤判成「有效值」而被覆蓋,見上方模式 2)。
3. `id=0/未帶` 走新增、`id>0` 走更新的分流慣例:MCP tool 必須明確判斷並告知呼叫端這次是新增還是更新。
4. **特殊陷阱(已驗證,範圍限定)**:`CreateOrUpdateRole` 對 `permissionIds` 陣列實際上是做**差異運算**(現有 vs 傳入 diff 出 added/deleted),不是覆蓋——若呼叫端沒把完整陣列傳全,會被當成「差異」誤刪權限。這種 method 不能套用「先讀現值、只覆蓋要改欄位」的通用假設,因為它連「你沒帶到的欄位」都會被當成「你要求刪除」;`roleName` 等其他欄位則是無條件覆蓋。
5. **另一特殊陷阱(批次陣列型 Upsert)**:如 `CreateOrUpdateActivityTabs(rows: ActivityTab[])` 這種吃一個陣列的 upsert,實測是**逐筆 upsert,DB 裡存在但沒出現在傳入陣列的舊資料既不刪除也不 diff、原樣保留**——這是第三種語意,既非整包覆蓋也非 diff 刪除。tool description 必須講清楚「省略某筆」的實際後果(既不會刪除它、也不會被當成要刪除的差異),避免呼叫端誤判。

## 5. 寫入 — 用業務鍵間接定位更新(今天真實出包的根因分類)

判準:method 不是直接吃內部 id,而是吃 `gameVendorId+gameId` 這類業務鍵組合,內部需要先查一次才能換到內部 id。

- 一律先確認是否已有用業務鍵直接查詢的 sibling method(`GetXxxForEdit(業務鍵)`);若有,直接用,禁止自己重新發明「List 全部 + 逐頁比對」邏輯。
- 若確實沒有直接查詢介面,只能靠分頁掃描比對業務鍵定位:比照第 2 節 B 級要求,逐頁掃到底、設上限與逾時保護、驗收案例含「目標不在第一頁」。
- 注意同名 method 在不同 service 可能一個用 id 定位、一個用業務鍵定位,不能假設同名行為一致。
- **實際範例**:`obsidian/mcps/aladdin-admin/src/tools/edit_game.ts` 今天的修法(先問 sibling method 是否存在、否則逐頁掃描到 `totalPage`、設定回報格式)可直接參考。

## 6. 寫入 — 狀態轉換(Enable / Disable / Toggle / Approve / Reject / Cancel / Reset / UpdateXxxStatus)

判準:名字符合前綴,**或**輸入參數清單裡出現 `status`/`newStatus`。**兩種常見偽陽性,套用規則前先排除**:
- `status` 只出現在**回傳值**、不在輸入參數裡的(如 `GetMyAgentStatus() (status StatusEnum 1)`)——純讀取,不是狀態轉換。
- `status` 是輸入參數,但用途是**查詢篩選條件**、不是要設定的目標狀態(如 `ListExportTasks(exportType, status ExportStatusEnum, page, pageSize)` 篩選任務生命週期)——這類本質是第 2 節的清單查詢,回傳型別會是 `rows`+分頁,用第 2 節「看回傳型別」的判準即可排除。

真正符合的:
- `Toggle*` 系列實際上都是「設定為指定狀態」(帶明確目標狀態參數),不是無參數 bit-flip——**不要**在 tool 包裝層自作聰明「先查現況再反轉」。
- 檢查同 service/模組附近是否有對應 `*StatusInvalid`/`already*` 錯誤碼,確認後端是否會拒絕非法轉換;若有,tool description 要提示「此操作不冪等,重複呼叫可能回傳業務錯誤而非 no-op」。
- 對回傳 `failed [T]`/`succeeded/failed` 的批量狀態轉換,tool 輸出必須把失敗清單原樣呈現。
- 對只回傳單一 `success bool` 或無回傳的批量狀態轉換(風險最高):**不能宣稱「全部成功/全部失敗」**——`success=false` 常見意涵是「至少一筆失敗」,tool 必須明確告知「無法得知哪幾筆失敗,需另外用查詢 method 覆核」。
- `Approve*`/`Reject*` 常伴生 `remark`/審核資料參數:建議把這類欄位設為建議必填(即使 schema 上非 required)。

## 7. 寫入 — 刪除(Delete / Remove)

- tool 描述必須標示是軟刪除還是硬刪除——這點無法只憑簽名判斷(9 支抽樣中約 78% 軟刪、22% 硬刪,**硬刪不是罕見孤例**,不能因為多數是軟刪就跳過查證),需另查後端實作(用 method-call-graph / db-schema-lookup)或詢問後端負責人。
- 冪等性(同一 id 刪兩次會不會噴錯)必須實測,不能假設。
- 批量刪除(`ids [i32]`)要驗證是全有全無還是部分成功;多數回傳值看不出批量部分失敗明細,需額外向實作確認。
- 建議刪除前先 round-trip 讀一次確認記錄仍存在,避免對已刪除/不存在 id 誤報成功。

## 8. 敏感資料 / 憑證 / PII 類(橫切分類,跨越所有命名前綴,任何分類的 method 都要額外檢查這節)

- **回傳值本身是密鑰的**(如 `GetMerchantSecret`):預設不自動包成 MCP tool;若業務上必須包,要求呼叫前二次確認、回傳值不寫入任何持久化 log。
- **輸入參數含明文密碼的**(如 `GetBalance(..., tradePassword)`):zod schema 要標記該欄位為 sensitive,避免 agent 把使用者密碼原樣塞進 tool call。
- **密碼重設/覆寫類 method**(`SetAppUserPassword`/`SetAgentPassword`/`ResetAgentPassword` 等):實測這類全部只掛 `@Permission`、**沒有掛 `@Totp`**。`@Totp` 是 gate 層(`management_gate_logic.ts`)在 `route.totp` 為 true 時才「有機會」被平台設定要求二次驗證;沒掛的話 gate 直接短路放行,**在任何平台設定下都不可能被要求二次驗證**,比對照組(金流異動、PII 解遮等場景普遍有掛 `@Totp`)風險明顯更高,是真實的防護缺口而非刻意分層設計。**MCP tool 層必須自行補上二次確認機制**(如強制先取得操作者明確同意、或加 confirm 參數)。
- 回傳裡帶 `loginToken`/`totpSecret`/`newPassword` 的,一律遮罩(只顯示前後幾碼)或改為「已取得憑證」的間接描述,不原樣印在 agent 對話輸出。
- **上傳/建立用 token 類**(`GetXxxToken`/`GetUploadXxxToken`):名字是 Get 但性質更接近寫入前置動作,需驗證有效期限、是否綁定呼叫者身份、多次呼叫是否使前一個失效,tool 說明要標註「有時效性,勿快取重複使用」。
- **一般 PII(真實姓名、銀行卡號/帳戶,非密碼/token 但仍是真實使用者個資)**:codebase 存在系統性明文直出——`realName` 出現在數十個 List/Get 回傳 model,真實銀行卡號與開戶姓名(`account`/`accountName`)出現在提款帳戶相關 model。比對本庫既有的欄位級遮罩機制 `SensitiveFieldEnum`(只涵蓋 `mobile`/`email`/`wechat`/`qq`,搭配 `@Totp` 保護的解遮 method)可發現:**`realName`、銀行卡號/帳號完全不在這套遮罩機制保護範圍內**,任何一般 List/Get method 都會明文吐出。
  - 包裝這類回傳 model 為 MCP tool 前,zod schema 要逐欄標記出 `realName`/`account`/`accountName`/`bankAccount` 等真實個資欄位,預設遮罩顯示(如只顯示姓氏或卡號後 4 碼),除非業務上明確需要完整值。
  - 不可將這類欄位原樣寫入任何持久化 log 或未加密的對話紀錄。
  - 多筆批量查詢(如批量核對提款單)要額外評估「聚合多筆真實使用者 PII 一次性暴露」是否超出單筆查詢的風險範圍。

## 9. 驗證類(Check / Verify / Test / Validate)—— 不能全信名字

- **不能單憑前綴斷定唯讀**:`VerifyRebateRecord`/`VerifyDepositSupportRecord` 帶 `status`/`remark` 參數,實際是核准/駁回動作、會寫入審核紀錄。只要參數含目標狀態/remark 類欄位,一律視同第 6 節「狀態轉換」處理,tool description 要明確標「此方法有副作用,非唯讀查詢」。
- **`Test*` 系列不能一概而論**:
  - `TestSendMarquee`/`TestSendOtpCode`/`TestSendMessage`(通知群組試送)**會對真實外部管道/真實使用者發送**,不是安全乾跑,需比照 Send* 處理;`TestSendMessage` 這類「試送到既有群組」沒有可指定的測試收件人參數,無法靠 tool 層塞假收件人降低風險,唯一可行的緩解是操作規範層面(僅在指定測試群組呼叫),tool description 需明確標註。
  - `TestBot` 相反——只呼叫 provider 的唯讀驗證端點(如 Telegram `getMe`/Discord `users/@me`)確認 token 有效,**不會發送任何訊息**,可視為安全,但仍是真實對外呼叫(消耗連線、可能觸發 rate limit),非完全無副作用。**不要**把它跟真的會發送的 `TestSendXxx` 混為一談、套用同一套「測試收件人」要求。
- 只有無 status/remark 類參數的 Check/Validate 才能標記為「可安全重複呼叫」。

## 10. Send / Export / Import / Login / Register(小類,各自獨立注意事項)

- **Send***:對真實使用者/房間/平台廣播,沒有安全沙盒可用假收件人。測試階段優先用對應的 `Test*`(先確認是第 9 節裡真的會送的那種),不要直接呼叫 `Send*` 測試。涉簡訊/郵件的要注意真實成本與頻率限制。
- **Export***,三種模式,包裝前必須先判斷是哪一種(不是只有前兩種):
  1. 同步直出:回傳 `rows`+`totalPage`,實作真的查 DB 回傳,可直接包裝(套用第 2 節清單查詢規則)。
  2. 非同步 Job 模式:靠 `ExportTypeEnum` 參數化的通用 `CreateExportTask`(回傳 taskId)→ 輪詢 `GetExportTask`/`ListExportTasks` → 完成後下載。**這類 method 名字不一定帶 `Export` 前綴**,不能只用方法名前綴掃描去找。必須包成「建立任務」+「輪詢查詢」至少兩支 tool,description 標注「非同步,需輪詢直到完成」。
  3. **純權限節點佔位符(容易誤判成模式 1)**:方法名以 `Export` 開頭、簽名多為 `() ()`,rajah 註解常寫「單純權限節點」,但 agrabah 對應 Service **沒有任何覆寫**、落回 base class 預設值,呼叫必定回 `notImplemented`。包裝前**先按第 0 節新增的檢查(核對後端是否真的 override)**,不能只看簽名回傳型別就當作「回傳空陣列的同步直出」。
- **Import***:多為兩段式(先 `GetUploadXxxToken` 拿 token、上傳檔案、再引用 token 呼叫 Import),不接受檔案 binary。tool 包裝必須涵蓋完整兩段。回傳常有 `failedRows`,同第 6 節部分成功處理要求。
- **Login/Register**:輸入輸出常見明文密碼/`loginToken`/`totpSecret`,同第 8 節敏感資料規則處理。

## 11. 其他必須逐案處理、不能套模板的特殊個案

- **回傳陣列內每筆各自帶 `errorCode`/`success` 欄位**(如 `ReWithdrawPayWithdrawOrder`):RPC 外層不報錯不代表業務成功,必須解析陣列內容逐筆回報。
- **涉及不可逆金流/派彩結算的方法**(如 `CancelBetRecords`/`CancelRound`):即使命名符合某個分類,也要額外標記為「需二次確認/限制自動化連續呼叫」。
- **同名 method 分散在多個 service**(至少 11 個 service、22 處的 `EnableConfig`/`DisableConfig` 就是一例):包裝 tool 時要以「service + method」而非單純 method 名稱做唯一識別。
- 命名前綴分類規則要注意偽陽性,例如 `Setup*` 會被 `^Set` 規則誤抓,`SearchAgentMemberIdCursor` 這類游標掃描會被誤判成一般 Search。**分類判斷最終必須讀簽名+讀鄰近註解,不能只靠字串前綴自動化分類**。
