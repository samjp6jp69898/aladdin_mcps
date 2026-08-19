# agrabah-platform MCP

讓 Claude Code 直接呼叫 agrabah **platform** 後台的 RPC method。架構、Stateless/Stateful 說明、新增 tool 的公版流程、安裝與連線方式，一律看 `../README.md`（不要在這裡重複維護）。

## 已支援 tool

| Tool | rajah method | 說明 |
|---|---|---|
| `agrabah_platform_login` | `Auth.Login` | 登入，token 存 process 記憶體 |
| `agrabah_platform_list_game_vendors` | `GameVendorPlatform.ListGameVendors` / `ListAllGameVendors` | 查本平台的廠商清單；不帶篩選條件時自動改用一次拿全部的版本 |
| `agrabah_platform_list_vendor_games` | `GameVendorPlatform.ListGames` | 查某廠商在本平台**已上架**的遊戲清單 |
| `agrabah_platform_onboard_vendor_game` | `GameVendorPlatform.GetGameVendorGameForEdit` + `UpdateGameVendorGame` | 把廠商遊戲母表已存在、但本平台還沒設定過的遊戲上架到本平台（或更新既有設定），**含方形圖/直方圖/橫幅圖上傳、`localizedNames` 多語系名稱**——不是建立全新遊戲 |

## 一個重要的架構限制：platform 沒有「建立全新遊戲」的能力

`UpdateGameVendorGame` 背後依賴 agrabah 的 `ensurePlatformGameVendorGame()`：會先查全平台共用的「廠商遊戲母表」（`game_vendor_games`）有沒有這個 `gameVendorId + gameId`，**沒有就直接回錯**（`errorCode=303 gameVendorGameNotExists`），不會憑空建立。母表資料正常是由廠商同步 job 自動帶入。真正能建立全新遊戲、寫進母表的是 **admin** 後台的 `GameVendorAdmin.CreateOrUpdateGameVendorGame`（見 `agrabah-admin` MCP 的 `agrabah_admin_create_game`）。

所以完整流程是：
1. 若廠商遊戲母表已有這款遊戲（廠商同步 job 帶入的，或 admin 手動建過）→ 直接用這裡的 `agrabah_platform_onboard_vendor_game` 上架到本平台。
2. 若母表也沒有（真正的全新遊戲）→ 先用 `agrabah-admin` 的 `agrabah_admin_create_game` 建立，再回來用這裡的 tool 上架到各平台。

`agrabah_platform_onboard_vendor_game` 呼叫失敗且 `errorCode=303` 時，回傳會帶 `hint` 明確告訴 agent 該去用哪支 tool，不會讓 agent 自己瞎猜重試。

**另一個容易誤踩的點（2026-08-18 實測發現）**：`agrabah-admin` 剛建立的場館（`agrabah_admin_create_game_vendor`）**不會自動出現**在 `agrabah_platform_list_game_vendors` 裡——場館要先被 admin 端呼叫 `GameVendorAdmin.UpdatePlatformGameVendorStatus(platformId, gameVendorId, enabled)` 啟用給特定 platform 才查得到（本 MCP 與 `agrabah-admin` 目前都沒有提供這支啟用 tool）。

## src/ 結構

```
src/
  stdio.ts          — MCP entry point
  session.ts         — 登入態管理（含 uploadFile），所有 tool 共用（結構同 agrabah-admin，各自獨立一份，未共用套件）
  const.ts            — 所有 tool 共用的 rajah enum 對照表與錯誤碼（ACTIVE_STATUS_MAP、IMAGE_SHAPE_MAP...），集中管理避免各 tool 各自重複一份
  mcp_result.ts       — MCP tool 回傳值包裝
  tools/
    index.ts           — 聚合所有 register*Tool
    login.ts
    list_game_vendors.ts
    list_vendor_games.ts
    onboard_vendor_game.ts  — 含圖片上傳邏輯（uploadLocalizedImages）
```

帳號/URL 只走 `.mcp.json` 的 `env`（`process.env.*`），`session.ts`/`const.ts` 都不寫死任何 fallback 值。

## 環境變數（根目錄 `.mcp.json` 的 `env`）

| 變數 | 說明 |
|---|---|
| `AGRABAH_PLATFORM_API_URL` | platform 後台 dev 站台，例如 `https://pk-platform.alddev.com` |
| `AGRABAH_PLATFORM_USER` | 預設測試帳號 |
| `AGRABAH_PLATFORM_PASSWORD` | 預設測試密碼 |

## 已知限制

- `agrabah_platform_list_vendor_games` 只開放 `gameVendorId`/`name`/`status` 三個篩選欄位；`displayTag`/`frontendGroupTag`/`rebateTag`/`badgeId` 這些下拉篩選需要另外查對應清單（`ListAllGameDisplayTags`/`ListAllGameRebateTags`/`GetBadgeList` 等），尚未實作。
- `agrabah_platform_onboard_vendor_game` 的圖片欄位是「每個語言各自一張圖」，沒有「一張圖套用全部語言」的機制；呼叫端要明確帶每個語言各自的本機檔案路徑。每次上傳都要重新拿 token（單次使用、1 小時過期）。
- **`localizedName`（多語系名稱）只能覆蓋、不能清空**：proto3 對「空陣列」與「欄位沒帶」無法區分，後端的部分更新邏輯會把明確傳入的空陣列當成「沒帶這個欄位」直接忽略，不會拿它去清掉既有值（在 admin 端用真實遊戲資料實測驗證過，platform 端邏輯相同，推論同樣適用）。language code 一旦設定過，之後只能用 `localizedNames` 覆蓋成別的值，沒辦法清空回未設定狀態。

## launchd 常駐骨架（H13；尚未上線）

`launchd/` 內含 `run-server.sh`（啟動 `src/http.ts`，port 8790）與
`com.aladdin.agrabah-platform-server.plist`，結構比照已上線的
`telegram-dispatcher/launchd/`（同一套 run-server.sh + plist 手法），與
`agrabah-admin/launchd/` 完全對稱。

**本機手動跑**（開發、除錯用，不透過 launchd；會一直佔用這個 terminal，
Ctrl-C 停止）：

```bash
zsh /Users/user/aladdin/obsidian/mcps/agrabah-platform/launchd/run-server.sh
curl http://localhost:8790/health
```

環境變數來源是根目錄 `.mcp.json` 的 `agrabah-platform` server `env`（用
`jq` 現讀，見 `run-server.sh` 檔頭註解），**不是** `/Users/user/aladdin/.env`。
`run-server.sh` 刻意不匯出帳密（`AGRABAH_PLATFORM_USER`/
`AGRABAH_PLATFORM_PASSWORD`），理由見腳本內註解。

**部署到 launchd 常駐（尚未執行，記錄步驟供之後的高風險 task 參考）**：
plist 正本放在 repo（`ProgramArguments` 用 repo 絕對路徑），但 launchd
只認 `~/Library/LaunchAgents/` 底下的檔案，不會直接讀 repo 裡的路徑
（比照 `telegram-dispatcher/README.md:34-40` 的既有慣例），部署時要：

```bash
cp /Users/user/aladdin/obsidian/mcps/agrabah-platform/launchd/com.aladdin.agrabah-platform-server.plist \
   ~/Library/LaunchAgents/
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.aladdin.agrabah-platform-server.plist
# 停止：launchctl bootout gui/$(id -u)/com.aladdin.agrabah-platform-server
```

H13 只驗證手動執行 `run-server.sh` 能起能停，**未執行**上面的 `cp` 與
`launchctl bootstrap/bootout`——正式常駐與對外曝露是後續高風險 task（proxy-exposure
模組）的範圍，動手前需與使用者確認。log 檔位置：
`mcps/agrabah-platform/logs/launchd-server.{out,err}.log`（已加入 `.gitignore`）。
