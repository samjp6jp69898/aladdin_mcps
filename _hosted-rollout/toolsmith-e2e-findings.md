# H24：agrabah-toolsmith 端到端小範圍測試 findings

測試時間：2026-08-19 15:40–15:46（CST）。工作分支 `feature/agrabah-hosted-mcp`。測試方式：真的起 `agrabah-toolsmith` HTTP server（port 8788），用 `@modelcontextprotocol/sdk` 的 `Client` + `StreamableHTTPClientTransport` 做真實 MCP handshake，呼叫一次 `agrabah_toolsmith_generate_tool`。

- `requestId`：`4584c9af-fc11-4061-98e3-f0e85f76f65d`
- `target`：`admin`
- `request`：「查詢目前已知的 game vendor adapter 清單，新增一支唯讀 tool 呼叫 `GameVendorAdmin.ListAdapters` 這支 rajah method 回傳結果」
- 結果：`success: true`，`durationSeconds: 173`（約 2 分 53 秒）
- Sub-agent Claude session transcript：`/Users/user/.claude/projects/-Users-user-aladdin-obsidian-mcps-agrabah-toolsmith-scratch-4584c9af-fc11-4061-98e3-f0e85f76f65d/3462eb8f-a49d-42b9-8042-db3fd2772ab0.jsonl`（146 行，用於交叉檢查自報可信度，見 AC4）

## AC1：真實透過 MCP 呼叫一次，timeout 內拿到 success:true

**通過。** Server 手動起在 `127.0.0.1:8788`（`lsof` 確認 bind 位址非 wildcard），`bun /Users/user/aladdin/obsidian/mcps/agrabah-toolsmith/src/http.ts`，token 從根目錄 `.env` 的 `TOOLSMITH_API_TOKEN` 讀取。用真實 SDK client 做 `initialize` → `tools/list`（回傳 1 支 tool，符合現況只有 `agrabah_toolsmith_generate_tool`）→ `tools/call`，173 秒後 resolve，回傳 `success: true`，遠低於 600 秒的 `AGENT_TIMEOUT_SECONDS` 上限。測完手動 `kill` server pid，`lsof :8788` 確認 port 已釋放。

## AC2：files[] 語法正確、符合 README 骨架

**通過。** 回傳 3 個檔案：

- `src/tools/list_adapters.ts`（新增）：對照 `mcps/README.md`「套用這個骨架」段落逐項核對——檔頭註解含 `rajah: GameVendorAdmin.ListAdapters（game_back_office.rajah:299）` 來源標注、`import session.ts`/`mcp_result.ts` 既有慣例、tool 命名 `agrabah_admin_list_adapters` 符合 `agrabah_<admin|platform>_<動詞>_<名詞>` 慣例、`title` 是簡短英文片語（符合 H22 review 修正後的既有慣例，未退化）、`inputSchema: {}` 正確（`ListAdapters` 本身無參數，故沒有欄位可加 `.describe()`，不算違規）。人工讀過語法正確，是合法 TypeScript。
- `src/tools/index.ts`（修改）：正確 import 並掛進 `registerAdminTools`，diff 對照 verify-workspace 內容與既有 5 支 tool 並列，未動其他既有 tool 的註冊。
- `README.md`（修改）：補了新 tool 到清單表、更新已知限制段落（含一則新發現「`adapter` 也可查即時清單」的可用提示），內容與既有段落風格一致。

`bunx tsc --noEmit` 在 verify-workspace 上實測跑過：`list_adapters.ts` 本身零錯誤；repo 既有其他檔案（`login.ts`/`list_vendor_games.ts`/`edit_game.ts`）有一批既有的 zod 版本型別錯誤，sub-agent 正確判斷「與本次改動無關、不在任務範圍」而未動手修復，屬合理判斷（真的是既有問題，不是這次新增程式碼引入的）。

## AC3：realDirsTouched 為 false，且獨立 git status 驗證

**未通過（但根本原因不是 sub-agent，而是併發測試環境下的已知設計限制）。**

回傳值裡 `realDirsTouched: true`。獨立驗證過程：

1. 測試開始前先拍了 `git status --short -- mcps/agrabah-admin mcps/agrabah-platform` 快照：只有 `M mcps/agrabah-admin/src/const.ts` 一筆（判斷是同 session 內並行的其他 task，如 H33 multi-env-admin 相關工作留下的未 commit 改動）。
2. sub-agent 完成後，同一 pathspec 再跑一次：多出 9 筆——`mcps/agrabah-admin/{http,session,stdio,tools/index}.ts`、`mcps/agrabah-platform/{const,http,session,stdio,tools/index}.ts` 皆為 `M`，另外兩個新增的 `?? mcps/{agrabah-admin,agrabah-platform}/h7-verify-clean.ts`。
3. 交叉比對 sub-agent 自己的 session transcript：它的 **所有** `Edit`/`Write` tool 呼叫（4 次 Edit + 3 次 Write）路徑全部落在 `scratch/4584c9af.../verify-workspace/` 或 `scratch/4584c9af.../manifest.json` 底下，**沒有一次**寫入 `mcps/agrabah-admin` 或 `mcps/agrabah-platform` 正式目錄本身。
4. sub-agent 自己也做了同樣的獨立驗證（它在 prompt 要求下主動執行 `git status --porcelain -- mcps/agrabah-admin mcps/agrabah-platform` 與 `git diff --stat`），得到的 diff 內容（`http.ts`/`session.ts`/`stdio.ts`/`tools/index.ts` 兩邊各自新增 `mode`/`hosted` 相關邏輯，commit 訊息脈絡對得上 D9/D12 的 hosted 交付機制、`registerAdminTools` 新增 `ServerMode` 參數等）明顯是**另一個同時在跑的 task（很可能是 H7，diff 註解裡寫著「H7」字樣）的真實工程進度**，不是這次請求造成的雜訊。
5. 針對我測試前就已存在的那筆 `mcps/agrabah-admin/src/const.ts` 改動，額外用 `diff` 逐 byte 比對測試前後的 `git diff` 內容——完全相同，證明這個檔案在整個測試視窗內沒有被任何人（含 sub-agent）進一步改動。

**結論**：`realDirsTouched: true` 是**真實訊號但屬於 false positive**——`collect-output.ts` 的 diff-based 設計（比較 spawn 前後的 `git status --short`）在**這兩個目錄同時有其他背景 task 在真實開發**的環境下，沒有辦法區分「這次 sub-agent 造成的變更」跟「同時間別人真的在改這兩個目錄」，只要視窗內任何人動了這兩個目錄，就會誤報。`snapshotRealDirs()` 的既有註解已經承認這類風險（「避免同時並行的其他 task 改動 obsidian **其他目錄**時被誤判」），但護欄只做到「縮小 pathspec 到 admin/platform 這兩個目錄本身」，沒有進一步做到「只認這次 sub-agent 造成的變更」（例如用 sub-agent 專屬的 git worktree、或改成比對檔案 mtime 是否早於 spawn 時間點）。**本次測試獨立確認 sub-agent 本身完全沒有碰正式目錄**，`realDirsTouched` 的旗標本身不可靠，不能直接當作「sub-agent 是否守規矩」的證據——這是一個需要提報給 H25 的真實設計落差，不是我這次測試操作失誤。

## AC4：交叉檢查 sub-agent log，驗證 verification.notes 宣稱的 dev 驗證是否真的發生

**通過，且有完整可追溯證據——這是本次測試最重要的產出。**

`verification.notes` 宣稱：在 verify-workspace 用 SDK `Client` + `StdioClientTransport` 起了真正的 stdio server（帶 `AGRABAH_ADMIN_API_URL=https://admin.alddev.com` 等環境變數）、`tools/list` 有看到新 tool、實際呼叫拿到 37 個 adapter 字串、與 `const.ts` 既有 `KNOWN_ADAPTERS` 常數吻合。

交叉檢查（讀完整 session transcript，不只信自報）：

- transcript 內 `Bash` tool 呼叫共 18 次，其中一筆命令就是 `bun spike_verify_list_adapters.ts 2>&1`，對應的 tool_result **完整印出**：`[agrabah-admin MCP] stdio server ready` → `tools/list` 印出 6 支 tool 名稱（含新的 `agrabah_admin_list_adapters`）→ 呼叫該 tool 拿到的原始 JSON 回應，裡面 37 個 adapter 字串**逐字**列出（`encanto, jili, in_house, ks, ameba, ..., Allbet, JJFish`）。
- 獨立比對 `mcps/agrabah-admin/src/const.ts` 現有的 `KNOWN_ADAPTERS` 常數（我自己用 python 解析陣列，不是憑印象）：**正好 37 個字串，順序與內容完全一致**。這代表 spike script 真的打中了會回傳這批資料的東西——理論上如果沒真的連上 dev、只是編造，很難剛好編出跟既有常數一字不差、順序也一樣的 37 個字串。
- 該 Bash 呼叫之後緊接著一次 `rm .../spike_verify_list_adapters.ts`，對應 `verification.notes` 講的「驗證完的 spike script 已從 verify-workspace 刪除」——這句自報也對得上實際行為。
- 全程 `Edit`/`Write` 只有 7 次，皆已在 AC3 列出路徑，沒有任何一次是在寫 dev 的測試資料或改動正式碼——與「這是唯讀 method，無需清理 dev 資料」的自報一致。
- `preExistingIssue`（zod 型別錯誤）的自報也有對應的 Bash 呼叫（`bunx tsc --noEmit`）與其輸出可查證，不是憑空聲稱。

**可信度判定**：這次自報**完全屬實**，且細節（37 個字串逐一比對得上、刪除 spike script 的動作確實發生）比 manifest.json 裡簡短的一句話描述更難偽造。這對 H25 是正面訊號：至少在「單一唯讀 method、範圍很小」的任務下，sub-agent 的自報與其真實行為高度一致；但**樣本數只有 1 次**，且刻意選了一個「有既有資料可對照」的簡單題目——這正是本次任務設計的目的，不能直接外推到複雜的寫入型任務（例如需要清理 dev 測試資料的情境）自報同樣可信。

## AC5：scratch/{requestId}/ 目錄結構符合設計

**通過。** 實際結構：

```
scratch/4584c9af-fc11-4061-98e3-f0e85f76f65d/
├── manifest.json                          （只有 success/summary/files索引/verification/warnings，沒有內嵌檔案內容，符合設計）
├── verify-workspace/agrabah-admin/        （cp -R 完整副本，含 node_modules、bun.lock、tokens.json 等）
└── output/agrabah-admin/
    ├── README.md
    └── src/tools/{list_adapters.ts, index.ts}
```

`manifest.json` 的 `files[]`（只有 `path`+`action`）與 `output/` 底下實際檔案一一對應，`collect-output.ts` 讀取後正確組回帶完整 `content` 的回傳值。權限檢查：`scratch/` 頂層、`scratch/{requestId}/`、`verify-workspace/`、`output/` 全部 `drwx------`（700），符合 H23 修正過的頂層目錄 chmod 規則。

## 對 H25 的建議

1. **`realDirsTouched` 的 diff-based 設計需要在部署到 hosted server 前修正**——目前的 pathspec 只縮小到「哪兩個目錄」，沒有解決「誰改的」。這個服務設計上假設「多企劃共用同一台工程師本機」，而這台機器上同時有工程師自己在對 `mcps/agrabah-admin`/`agrabah-platform` 做真實開發（本次測試親眼撞見），未來只要背景有其他工作在動這兩個目錄，`realDirsTouched` 就會持續誤報 true。若 H25 打算用這個欄位做任何自動化判斷（例如「true 就不自動部署」），現在的訊號不可靠，建議至少改成比對檔案 mtime 是否落在 spawn 時間窗內，或比對 diff 的實際內容雜湊而非單純「是否不同」。
2. **sub-agent 自報可信度本次測試是正面結果**，但只驗證了「單一唯讀 method、範圍小」這一種情境。H25 決定部署機制（自動 vs 人工觸發）時，這個正面結果只能支持「小範圍唯讀需求可以考慮較寬鬆的信任」，不足以支持「所有需求都可信任自報」的結論——尤其是涉及寫入型 method、需要清理 dev 資料的情境，自報可信度未經測試。
3. 本次測試沒有觸發任何 timeout 或 fallback manifest 路徑（H23 已測過），也沒有測到「業務不合理需求」或「prompt injection」情境（原設計已知風險，本次不在範圍內）。
4. 整個流程（server 啟動 → 真實 MCP handshake → 173 秒 sub-agent 執行 → 結果讀取 → server 關閉）順暢，沒有遇到 H23 提到的併發卡死、fallback manifest 誤觸發等問題。

## 附註：測試環境副作用

測試全程使用真實 dev 後端（`https://admin.alddev.com`，唯讀呼叫），未使用本機 agrabah 後端服務（測試當下確認本機沒有起 `game_back_office` 等本機 dev server，admin 角色的 dev 站台本來就是遠端網址，不需要本機服務）。測試產生的 `scratch/4584c9af-fc11-4061-98e3-f0e85f76f65d/` 與 `logs/4584c9af-fc11-4061-98e3-f0e85f76f65d.log` 依設計保留在原地未清理，兩個目錄皆已在 `.gitignore` 範圍內。
