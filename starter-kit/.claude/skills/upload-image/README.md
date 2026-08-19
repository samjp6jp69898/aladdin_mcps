# 上傳圖片 skill（H18 待實作）

這個目錄先佔位。H18 要在這裡放一支真正的上傳 skill，把 `../../settings.json`
裡已經預留好的這條 allowlist 規則兌現：

```
Bash(bash .claude/skills/upload-image/upload.sh)
```

## 給 H18 實作者的硬性要求（不是建議）

跟 `../login/README.md` 是同一套理由，這裡不重複貼實測證據，只列這支
skill 特有的部分：

1. entry point 必須是 `.claude/skills/upload-image/upload.sh`，agent 呼叫時
   下給 Bash tool 的指令字串必須固定不變，**不能把檔案路徑當成命令列參數
   直接接在這個指令後面**（那樣等於在允許清單規則後面留了一個開放的
   萬用字元缺口）。要嘛用固定的環境變數（例如先把路徑寫進一個固定名稱的
   暫存檔，或走 stdin）把檔案路徑傳給 `upload.sh`，要嘛讓使用者在對話裡
   講清楚要傳哪個檔案、由 skill 內部用固定邏輯去找，兩種都可以，
   但呼叫這支腳本的 Bash 指令字串本身必須逐字固定。
2. `upload.sh` 內部依 plan.md D5／H8 的 `POST /files` 端點契約：
   - multipart 上傳到目前操作環境對應的 `<domain>/mcp-admin-<env>/files`，
     帶 `Authorization: Bearer <該環境 token>`（從 `.mcp.json` 用 `jq` 取得）。
   - 成功回應會帶一個 `fileId`，這個 `fileId` 才是後續要傳給
     `agrabah_admin_edit_game` 等 tool 的圖片參數值（不是本機檔案路徑——
     hosted 模式下 tool 吃的是 `{code, fileId}`，不是 `{code, filePath}`）。
   - 每次上傳都要重新取得 token／執行一次（單次使用、依 server 端策略過期），
     不要快取上一次的 `fileId` 給不同的圖片重複用。

實作完成後記得同步更新 `../../settings.json` 的 `allow` 規則，並比照
`../login/README.md` 最後一段，重新做一次「兩個 host 對照組」實測。
