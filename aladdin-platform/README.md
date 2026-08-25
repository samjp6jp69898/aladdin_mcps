# aladdin-platform MCP

讓 Claude Code 直接呼叫 agrabah **platform** 後台的 RPC method。架構、Stateless/Stateful 說明、新增 tool 的公版流程、安裝與連線方式，一律看 `../README.md`（不要在這裡重複維護）。

## 已支援 tool

Tool 命名規則：`<server>_<service>_<method>`（server/service/method 各自轉 snake_case），命名規則全文見 `../tool-naming-convention.md`。

| Tool | rajah method | 說明 |
|---|---|---|
| `aladdin_platform_auth_login` | `Auth.Login` | 登入，token 存 process 記憶體 |
| `aladdin_platform_game_vendor_platform_list_game_vendors` | `GameVendorPlatform.ListGameVendors` / `ListAllGameVendors` | 查本平台的廠商清單；不帶篩選條件時自動改用一次拿全部的版本 |
| `aladdin_platform_game_vendor_platform_list_games` | `GameVendorPlatform.ListGames` | 查某廠商在本平台**已上架**的遊戲清單 |
| `aladdin_platform_game_vendor_platform_update_game_vendor_game` | `GameVendorPlatform.GetGameVendorGameForEdit` + `UpdateGameVendorGame` | 把廠商遊戲母表已存在、但本平台還沒設定過的遊戲上架到本平台（或更新既有設定），**含方形圖/直方圖/橫幅圖上傳、`localizedNames` 多語系名稱**——不是建立全新遊戲 |
| `aladdin_platform_message_board_platform_get_message_board_post_setting` | `MessageBoardPlatform.GetMessageBoardPostSetting` | 讀取「大舞台中心」→「大舞台設定」頁籤「基本設置」分頁目前的設定內容（單例設定，無參數，不吃 platformId） |
| `aladdin_platform_message_board_platform_set_message_board_post_setting` | `MessageBoardPlatform.GetMessageBoardPostSetting` + `SetMessageBoardPostSetting` | 修改「大舞台中心」→「大舞台設定」頁籤「基本設置」分頁的設定並儲存，所有欄位皆 optional，只覆蓋有帶到的欄位，其餘先讀現值原樣帶回 |
| `aladdin_platform_game_vendor_platform_get_localizations` | `GameVendorPlatform.GetLocalizations` | 批次取得遊戲/廠商/品牌的多語名稱（不分頁全撈，即使已停用仍查得到，用於解析歷史紀錄；gameName 實測近 5000 筆，5 分鐘快取） |
| `aladdin_platform_game_vendor_platform_list_all_two_eight_games` | 列出本平台可用的「二八遊戲」全部清單（in_house adapter、vendor_category=TwoEight），無參數、不分頁，2026-08-24 dev 實測回傳 20 筆 |
| `aladdin_platform_game_vendor_platform_list_all_in_house_vendors` | 列出 adapter=InHouse 的三方廠商 id 全集，無參數、不分頁，2026-08-24 dev 實測回傳 4 筆；注意回傳是全平台共用母表全集，不保證都已上架給目前平台（實測發現其中 1 筆不在本平台 ListAllGameVendors 結果內） |
| `aladdin_platform_game_vendor_platform_get_game_vendor_for_edit` | `GameVendorPlatform.GetGameVendorForEdit` | 讀單一廠商的可編輯詳情（`UpdateGameVendor` 的讀現值搭配方法），2026-08-24 dev 實測含存在/不存在 id 邊界案例 |
| `aladdin_platform_game_vendor_platform_update_game_vendor` | `GameVendorPlatform.GetGameVendorForEdit` + `UpdateGameVendor` | 更新單一廠商可編輯欄位（`localizedNames`/`sortOrder`/廠商方形圖），先讀現值、只覆寫有帶到的欄位、寫入後 round-trip 驗證；2026-08-24 dev 實測發現後端不會擋下超出宣告範圍的 `sortOrder`、對不存在 id 也會靜默回成功（不會真的寫入），description 已如實揭露此限制 |
| `aladdin_platform_game_vendor_platform_get_game_ids_by_in_house_play_group_ids` | `GameVendorPlatform.GetGameIdsByInHousePlayGroupIds` | 把 in-house 遊戲的 playGroupId 批次回推成 game_vendor_games.id（gameVendorGameId）與 brandId；查不到的 id 列在回傳的 `unresolvedPlayGroupIds`，2026-08-25 dev 實測涵蓋存在/不存在/混合/重複輸入四種情境 |
| `aladdin_platform_game_vendor_platform_update_game_vendor_status` | `GameVendorPlatform.ListAllGameVendors` + `UpdateGameVendorStatus` | 切換單一廠商狀態（enabled/disabled/frozen/deleted），先讀現值、同值短路不呼叫後端，寫入後 round-trip 驗證；2026-08-25 dev 實測含不存在 id（errorCode=14）、非法列舉值（errorCode=9）、同值呼叫（實測結果 errorCode=0 成功，非原先擔心的失敗）三種邊界情境 |
| `aladdin_platform_otp_code_setting_platform_get_sms_settings` | `OtpCodeSettingPlatform.GetSmsSettings` | 讀取本平台簡訊驗證碼（OTP SMS）發送限制設定（單例，無參數）；設定不存在時後端自動建立預設值，不會回空值 |

## 一個重要的架構限制：platform 沒有「建立全新遊戲」的能力

`UpdateGameVendorGame` 背後依賴 agrabah 的 `ensurePlatformGameVendorGame()`：會先查全平台共用的「廠商遊戲母表」（`game_vendor_games`）有沒有這個 `gameVendorId + gameId`，**沒有就直接回錯**（`errorCode=303 gameVendorGameNotExists`），不會憑空建立。母表資料正常是由廠商同步 job 自動帶入。真正能建立全新遊戲、寫進母表的是 **admin** 後台的 `GameVendorAdmin.CreateOrUpdateGameVendorGame`（見 `aladdin-admin` MCP 的 `aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game`）。

所以完整流程是：
1. 若廠商遊戲母表已有這款遊戲（廠商同步 job 帶入的，或 admin 手動建過）→ 直接用這裡的 `aladdin_platform_game_vendor_platform_update_game_vendor_game` 上架到本平台。
2. 若母表也沒有（真正的全新遊戲）→ 先用 `aladdin-admin` 的 `aladdin_admin_game_vendor_admin_create_or_update_game_vendor_game` 建立，再回來用這裡的 tool 上架到各平台。

`aladdin_platform_game_vendor_platform_update_game_vendor_game` 呼叫失敗且 `errorCode=303` 時，回傳會帶 `hint` 明確告訴 agent 該去用哪支 tool，不會讓 agent 自己瞎猜重試。

**另一個容易誤踩的點（2026-08-18 實測發現，2026-08-19 H34 更新）**：`aladdin-admin` 剛建立的場館（`aladdin_admin_game_vendor_admin_create_or_update_game_vendor`）**不會自動出現**在 `aladdin_platform_game_vendor_platform_list_game_vendors` 裡——場館要先被 admin 端呼叫 `GameVendorAdmin.UpdatePlatformGameVendorStatus(platformId, gameVendorId, enabled)` 啟用給特定 platform 才查得到；`aladdin-admin` 現在已提供這支啟用 tool（`aladdin_admin_game_vendor_admin_update_platform_game_vendor_status`，H34，見 `../aladdin-admin/README.md` 的「已支援 tool」），直接呼叫即可，不需要離開 MCP 手動處理。本 MCP（`aladdin-platform`）本身沒有對應的啟用 tool。

## src/ 結構

```
src/
  stdio.ts          — MCP entry point（stdio transport）
  http.ts            — MCP entry point（hosted，Streamable HTTP；Bearer 認證、/login、/files、/health、/mcp，見 ../README.md「Hosted 模式」；結構同 aladdin-admin，各自獨立一份，未共用套件）
  auth.ts             — Bearer token 名冊載入與認證 middleware（hosted 專用）
  session.ts         — 登入態管理（含 uploadFile，per-identity 容器），所有 tool 共用（結構同 aladdin-admin，各自獨立一份，未共用套件；H38 已補上與 admin 對稱的 IS_PROD/confirm 閘門，見下方環境變數表）
  const.ts            — 所有 tool 共用的 rajah enum 對照表與錯誤碼（ACTIVE_STATUS_MAP、IMAGE_SHAPE_MAP...），集中管理避免各 tool 各自重複一份
  files.ts            — POST /files 暫存目錄管理（型別白名單、身分綁定、配額、週期清理），hosted 專用
  instructions.ts     — hosted `/mcp` 的 McpServer instructions
  login_throttle.ts   — /login 帳號層節流（冷卻期），hosted 專用
  audit_log.ts        — 稽核 log（H32；每個通過認證的 request 寫一行）
  mcp_result.ts       — MCP tool 回傳值包裝
  tools/
    index.ts           — 聚合所有 register*Tool
    login.ts
    list_game_vendors.ts
    list_vendor_games.ts
    onboard_vendor_game.ts  — 含圖片上傳邏輯（uploadLocalizedImages）
    get_message_board_setting.ts     — 另外 export formatMessageBoardSetting()，update 工具的回傳共用同一支格式化函式
    update_message_board_setting.ts  — 讀現值 + 只覆蓋有帶到的欄位 + round-trip 讀回，比照 onboard_vendor_game.ts 的模式
    get_otp_sms_settings.ts          — 另外 export formatOtpSmsSettings()，update 工具的回傳共用同一支格式化函式
```

帳號/URL 只走 `.mcp.json` 的 `env`（`process.env.*`），`session.ts`/`const.ts` 都不寫死任何 fallback 值。

## 環境變數（stdio 模式：根目錄 `.mcp.json` 的 `env`）

> hosted（launchd 常駐）模式**不讀 `.mcp.json`**：`ALADDIN_PLATFORM_API_URL` 由
> `com.aladdin.mcp-platform-server.plist` 的 `EnvironmentVariables` 提供，帳密則完全不給
> 常駐行程。詳見下方「launchd 常駐骨架」。

| 變數 | 說明 |
|---|---|
| `ALADDIN_PLATFORM_API_URL` | platform 後台 dev 站台，例如 `https://pk-platform.alddev.com` |
| `ALADDIN_PLATFORM_USER` | 預設測試帳號 |
| `ALADDIN_PLATFORM_PASSWORD` | 預設測試密碼 |
| `ALADDIN_PLATFORM_IS_PROD` | H38：這個實例是否是正式環境，設計與 admin 端的 `ALADDIN_ADMIN_IS_PROD` 完全同構（見 `../aladdin-admin/README.md` 同一節）。prod 實例**必須**設為 `true`，其餘環境不設定或設 `false`——設為 `true` 時，所有寫入型 tool（`aladdin_platform_game_vendor_platform_update_game_vendor_game`、`aladdin_platform_message_board_platform_set_message_board_post_setting`）都會強制要求呼叫端帶上精確字串 `confirm="CONFIRM_PROD_WRITE"` 才會執行；未設定或非 `true`/`false` 的值會讓行程啟動時直接失敗。`session.ts` 同時會交叉檢查 `ALADDIN_PLATFORM_API_URL` 是否符合已知非 prod 網域特徵，URL 看起來像 prod 卻沒設這個旗標一樣會啟動失敗，不會靜默放行。詳見 `src/session.ts` 的 `assertProdConfirmed`。 |

## 已知限制

- `aladdin_platform_game_vendor_platform_list_games` 只開放 `gameVendorId`/`name`/`status` 三個篩選欄位；`displayTag`/`frontendGroupTag`/`rebateTag`/`badgeId` 這些下拉篩選需要另外查對應清單（`ListAllGameDisplayTags`/`ListAllGameRebateTags`/`GetBadgeList` 等），尚未實作。
- `aladdin_platform_game_vendor_platform_update_game_vendor_game` 的圖片欄位是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制；呼叫端要明確帶每個語言各自的本機檔案路徑（stdio 模式）或 fileId（hosted 模式，先呼叫 `POST /files` 上傳取得，見 `../README.md`「Hosted 模式」）。每次上傳都要重新拿 token（單次使用、1 小時過期）。
- **H9：`onboard_vendor_game.ts` 的圖片參數 `{code, filePath}` / `{code, fileId}` 二選一**，設計與實測方式與 `aladdin-admin` 的 `upsert_game.ts` 逐字相同，完整說明見 `../aladdin-admin/README.md` 同一段（D5/§4.3；`fileId → 本機路徑` 的三層防護：regex 格式白名單 + registry `Map` 精確比對 + realpath 二次確認）。
- **`localizedName`（多語系名稱）只能覆蓋、不能清空**：proto3 對「空陣列」與「欄位沒帶」無法區分，後端的部分更新邏輯會把明確傳入的空陣列當成「沒帶這個欄位」直接忽略，不會拿它去清掉既有值（在 admin 端用真實遊戲資料實測驗證過，platform 端邏輯相同，推論同樣適用）。language code 一旦設定過，之後只能用 `localizedNames` 覆蓋成別的值，沒辦法清空回未設定狀態。
- **i64 欄位經 protobufjs decode 後是 Long 物件，不是一般數字**（2026-08-20 實測發現）：`MessageBoardPostSetting` 的 `postsChangeUserDetailMinChargeTotal`/`postsGiftReceiveTotalAmount` 是 rajah `i64`，直接把 decode 出來的物件塞進 `JSON.stringify` 會印出 `{low, high, unsigned}`（且依呼叫路徑不同，有時反而印成十進位字串，形狀不一致）。`genie/src/common/index.ts` 其實有 `fixObjectInteger()` 專門處理這個問題，但 `genie/client` 目前沒有自動套用（呼叫處被註解掉）。`get_message_board_setting.ts`/`update_message_board_setting.ts` 已用 `const.ts` 的 `toPlainNumber()` 手動轉成一般數字再回傳；**未來任何新 tool 若回傳的 rajah model 含 `i64` 欄位，都要留意同樣的問題**，不能假設 decode 出來就是可以直接塞進 JSON 的數字。
- `aladdin_platform_message_board_platform_set_message_board_post_setting` 的 `postsGiftWageringMultiplier` 是後端實際儲存值（顯示倍率 × 10000 的整數），比照 admin 端 `exchangeRate` 的既有慣例（見 `../aladdin-admin/README.md`），工具本身不做單位換算，由呼叫端自行乘/除 10000。

## launchd 常駐骨架（H13；H15 已常駐上線）

`launchd/` 內含 `run-server.sh`（啟動 `src/http.ts`，port 8790）與
`com.aladdin.mcp-platform-server.plist`，結構比照已上線的
`telegram-dispatcher/launchd/`（同一套 run-server.sh + plist 手法），與
`aladdin-admin/launchd/` 完全對稱。**現況（H15 實測確認）**：已
`launchctl bootstrap` 常駐並對外開放（經 ngrok → telegram-dispatcher
proxy(8787) 前綴分流）。

**本機手動跑**（開發、除錯用，不透過 launchd；會一直佔用這個 terminal，
Ctrl-C 停止）：

```bash
zsh /Users/user/aladdin/obsidian/mcps/aladdin-platform/launchd/run-server.sh
curl http://localhost:8790/health
```

上面的手動跑法要**自己帶 `ALADDIN_PLATFORM_API_URL`**（例如
`ALADDIN_PLATFORM_API_URL=https://pk-platform.alddev.com zsh .../run-server.sh`）。

**`ALADDIN_PLATFORM_API_URL` 由 plist 的 `EnvironmentVariables` 提供**
（`com.aladdin.mcp-platform-server.plist`，現值 `https://pk-platform.alddev.com`），
`run-server.sh` **不讀任何設定檔**：不讀根目錄 `.mcp.json`（那是 stdio 模式的設定
來源，見本檔上面「環境變數」一節）、也不讀 `/Users/user/aladdin/.env`。原本是用
`jq` 從 `.mcp.json` 現讀，已改掉——常駐服務的存活不該綁在「給 stdio 用的」設定區塊
上，且部署到新機器時不必為了起服務而先備妥一份含帳密的 `.mcp.json`。換站台＝改
plist，改完要重新 `cp` 到 `~/Library/LaunchAgents/` 然後 bootout + bootstrap（只用 kickstart 不會重讀 plist，實測踩過）。`run-server.sh`
刻意不匯出帳密（`ALADDIN_PLATFORM_USER`/`ALADDIN_PLATFORM_PASSWORD`），理由見腳本
內註解。

**部署到 launchd 常駐（已於 H15 執行並常駐中；步驟保留供換機器/重新部署參考）**：
plist 正本放在 repo（`ProgramArguments` 用 repo 絕對路徑），但 launchd
只認 `~/Library/LaunchAgents/` 底下的檔案，不會直接讀 repo 裡的路徑
（比照 `telegram-dispatcher/README.md:34-40` 的既有慣例），部署時要：

```bash
cp /Users/user/aladdin/obsidian/mcps/aladdin-platform/launchd/com.aladdin.mcp-platform-server.plist \
   ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.mcp-platform-server.plist
# 停止：launchctl bootout gui/$(id -u)/com.aladdin.mcp-platform-server
```

H13 只驗證手動執行 `run-server.sh` 能起能停；H15 已完成上面的 `cp` 與
`launchctl bootstrap`，現在是 launchd 常駐服務，且已透過 telegram-dispatcher
proxy 對外開放（見 `_hosted-rollout/` H15 記錄）。log 檔位置：
`mcps/aladdin-platform/logs/launchd-server.{out,err}.log`（已加入 `.gitignore`）。

**維運者必讀（H15）**：

- **改完程式碼要 kickstart，不要手動跑 `bun run src/http.ts`**：常駐行程佔用
  port 8790，手動再跑一次會撞 `EADDRINUSE`；就算改用別的 port 起來測，launchd
  底下那個行程仍是舊碼在跑，容易讓人誤判「怎麼改了沒生效」。正確做法是改完
  程式碼後執行：
  ```bash
  launchctl kickstart -k gui/$(id -u)/com.aladdin.mcp-platform-server
  ```
- **重開機後不會自動啟動**：這是 LaunchAgent（`gui/` domain），只有使用者登入
  桌面 session 後才會被拉起（本機未開 FileVault、未設自動登入），純重開機、
  未登入桌面前服務是下線的。`telegram-dispatcher` 既有的常駐 job 是同一種結構，
  屬同級行為、不是本次退步。
- **緊急止血（撤銷存取）**：
  - 只下線這一個環境：`launchctl bootout gui/$(id -u)/com.aladdin.mcp-platform-server`
  - **整體對外下線最快路徑**（連 admin 一起斷公網入口）：
    `launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel`（停 ngrok，
    公網入口立即消失，本機常駐服務不受影響）
  - 撤銷單一 token：編輯 `tokens.json` 移除條目存檔即生效、不需重啟——但**務必
    用「暫存檔 + `mv`」，不要就地覆寫**，理由與正確/錯誤做法見下方「名冊維護
    操作規範」。

**名冊維護操作規範（M3：`auth.ts` 拿掉 mtime 快取，改成每個 request 都重讀
`tokens.json`）**：

- **一律用「暫存檔 + `mv`」修改名冊，不要就地覆寫**。既然每個 request 都重讀
  檔案，任何就地覆寫的寫法（`vim` 預設 `:w`、`jq '...' tokens.json > tokens.json`
  這類先 truncate 再寫的重導向）都會在「檔案為空或只寫了一半」的那幾毫秒到數十
  毫秒空窗內，讓某個 request 讀到殘缺內容而 fail-closed——**該 server 的所有使
  用者一起收到 401**（自癒：寫完後下一個 request 就恢復，但沒必要承擔這個代價）。
  - 正確（`mv` 在同一個檔案系統上是原子操作，讀取端永遠看到完整的舊檔或完整的
    新檔，空窗為 0）：
    ```bash
    python3 -c "..." > tokens.json.tmp && mv tokens.json.tmp tokens.json
    ```
  - 錯誤（就地覆寫，會製造空窗期）：
    ```bash
    vim tokens.json                      # 預設 backupcopy 行為是就地存檔
    jq '...' tokens.json > tokens.json   # shell 先把目標檔 truncate 成空才執行 jq
    ```
- **改完務必驗證**：`python3 -m json.tool tokens.json > /dev/null` 確認 JSON
  合法；並實打一次確認行為符合預期（撤銷的 token 回 401、保留的仍可用）。
- **fail-closed 語意要講清楚**（見 `src/auth.ts` 檔頭與 `loadRegistry`）：名冊
  只要有任何一點問題——檔案不存在、JSON 解析失敗、`tokens` 不是陣列、任一條目
  缺 `id` 或 `token`、`id` 或 `token` 重複——**該 server 的所有 token 一起失
  效**，不是只有壞掉那一筆。這是刻意設計（撤銷必須在所有誤操作下都生效），會
  自癒（改好後下一個 request 即恢復、不必重啟、`session.ts` 的 per-token 登入
  態容器不受影響、沒有人需要重新登入），但維運者要知道會發生什麼。
- **緊急止血的正確順序**：要立刻斷掉對外存取，用上面的
  `launchctl bootout gui/$(id -u)/com.aladdin.tg-dispatch-tunnel`（停 ngrok，
  公網入口立即消失）比編輯名冊更快更確定；撤銷單一 token 才用編輯名冊（暫存檔
  + `mv`）的方式。
- **fail-closed 發生時去哪裡看**：stderr 會印
  `[auth] 名冊載入失敗，已進入拒絕所有請求狀態（所有 token 一律 401，直到名冊
  修好）：<原因>（<名冊路徑>）`，`<原因>` 只帶固定字串/條目 index/id，刻意不含
  token 值；修好後下一次成功載入會印
  `[auth] 名冊已重新載入成功（N 筆條目），恢復正常認證`。落在
  `logs/launchd-server.err.log`。
