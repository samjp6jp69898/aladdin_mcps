# 登入 skill（H17 待實作）

這個目錄先佔位。H17 要在這裡放一支真正的登入 skill，把 `../../settings.json`
裡已經預留好的這條 allowlist 規則兌現：

```
Bash(bash .claude/skills/login/login.sh)
```

## 給 H17 實作者的硬性要求（不是建議）

1. **entry point 必須是 `.claude/skills/login/login.sh`，且不吃任何 Claude 傳進來的
   額外參數**——agent 呼叫這支 skill 時，實際下給 Bash tool 的指令字串必須永遠
   是逐字一樣的 `bash .claude/skills/login/login.sh`，不能因為要傳帳號、密碼、
   環境名稱等資訊而在指令列上加任何東西。
2. **原因**：`../../settings.json` 的 `_securityNote` 已經用實測證據記錄了——
   Claude Code 的 Bash allow 規則是純字串比對，只要規則裡出現 `*`，
   就會把從那個位置到指令結尾的任何內容（包含被注入的第二個網址／host）
   都當成合法放行，不會跳出權限確認。唯一被證實安全、兩端都有錨定的寫法，
   是**完全不帶萬用字元的逐字規則**。所以這支 skill 收到的指令字串必須是
   固定值，動態的部分（要打哪個環境、帳號密碼、Bearer token）一律讓
   `login.sh` 自己在腳本內部去讀 `.env`／`.mcp.json`，不要讓 agent
   在對話裡組出帶著這些值的 curl 指令。
3. `login.sh` 內部要做的事（依 plan.md D4／H6 的 `/login` 端點契約）：
   - 從 `.env` 讀 `AGRABAH_ADMIN_USER`／`AGRABAH_ADMIN_PASSWORD`
     （讀之前記得處理 Windows CRLF：`.env` 若被記事本存成 CRLF，
     值尾端會黏一個 `\r`，要 strip 掉，不能假設使用者一定用 LF 存檔）。
   - 從 `.mcp.json` 用 `jq` 取出目前要操作的環境對應的 Bearer token
     與 URL 前綴（一份 kit 可能同時註冊多個 `agrabah-admin-<env>` entry，
     要讓使用者或呼叫端指定是哪一個環境，不要假設只有一筆）。
   - 打對應環境的 `POST /login`，回應只需要判斷成功/失敗與是否要求 TOTP，
     **不要把 JWT 印到 stdout**（JWT 留在 hosted server 端的登入態容器裡，
     這支 skill 只需要回報登入結果）。
   - 密碼絕對不能出現在任何 echo／print 輸出，全程只在 shell 變數裡流動。

實作完成後記得同步更新 `../../settings.json` 的 `allow` 規則（如果最終的
呼叫方式跟這裡假設的不完全一樣，例如需要傳環境名稱參數，就要照
`_securityNote` 的方法重新做一次「兩個 host 對照組」實測，確認新規則
一樣沒有辦法被夾帶額外網址滿足）。
