---
name: upload-image
description: 把一張本機圖片上傳到 agrabah hosted server，換取 fileId，供需要圖片的 MCP tool（aladdin_admin_edit_game、aladdin_platform_onboard_vendor_game）使用。Use when 使用者要幫某款遊戲換圖／設定圖片，而 MCP tool 的圖片參數要求 fileId（不是本機檔案路徑）的時候。
---

# aladdin-upload-image — 上傳圖片換取 fileId（token 不進對話紀錄）

## 何時使用

- 使用者要更新遊戲的方形圖／直方圖／橫幅圖（`aladdin_admin_edit_game` 的
  `squareImages`／`rectangleImages`／`bannerImages`，或
  `aladdin_platform_onboard_vendor_game` 的對應圖片參數），且這個 MCP
  server 是 hosted 模式（tool 的圖片欄位描述裡看得到 `fileId` 這個選項）。
- hosted 模式下這些 tool 吃的是 `{code, fileId}`，**不是**
  `{code, filePath}`——你必須先用這支 skill 把本機圖片換成 `fileId`，才能
  把它交給圖片類 tool。每張圖片都要各自呼叫一次本 skill。

## 怎麼呼叫（重要：指令字串必須逐字固定，動態資訊靠固定暫存檔傳遞）

呼叫 Bash 工具時，指令字串必須**逐字**是：

```
bash .claude/skills/upload-image/upload.sh
```

**不要**在這行後面加任何參數（環境名稱、檔案路徑都不行）。這支腳本被設計成
zero-args：兩個動態資訊（要上傳到哪個環境、本機圖片檔案路徑）改由你在呼叫
前，先用 **Write 工具**（不是 Bash）分別寫進本目錄下兩個固定檔名的暫存檔：

1. `.claude/skills/upload-image/.upload-env.tmp`
   純文字，只放一行：`.mcp.json` 裡對應目標環境的 server 別名，例如
   `aladdin-admin-dev`、`aladdin-admin-pre`、`aladdin-admin-evi`、
   `aladdin-platform`。**這個別名要跟使用者當下正在操作的環境完全一致**
   （見下方「怎麼決定要上傳到哪個環境」）。
2. `.claude/skills/upload-image/.upload-filepath.tmp`
   純文字，只放一行：本機圖片檔案的路徑（絕對路徑或相對於目前工作目錄的
   路徑皆可，Mac／Windows 路徑格式不用特別轉換，照使用者提供或你確認過的
   實際路徑原樣寫入即可，不要自己猜測或改寫格式）。

寫完這兩個檔案後，再呼叫上面那個固定的 Bash 指令。腳本會自動讀取＋立刻刪除
這兩個暫存檔（單次使用），把結果印出來。

**硬規則：兩個暫存檔每次都要重新寫**——即使這一輪的環境或檔案路徑跟上一輪
完全相同，呼叫 upload.sh 之前也一定要用 Write 工具把 `.upload-env.tmp` 與
`.upload-filepath.tmp` 兩個都重新寫一次，不要因為「上一輪已經寫過了」而
只重寫其中一個。如果上一輪呼叫因為權限被拒絕或中斷而沒有真的執行到
upload.sh，殘留的舊暫存檔會被這一輪誤用，導致靜默上傳到錯誤的圖片、卻仍然
回報「上傳成功」。

## 怎麼決定要上傳到哪個環境

`fileId` 綁定「上傳當下用的是哪一把 Bearer token」——上傳到 dev 環境拿到的
`fileId`，只能餵給 dev 環境的 `aladdin_admin_edit_game` 等 tool，不能拿去
餵 pre／evi 環境的同一支 tool（會被拒絕）。所以：

- 先確認使用者接下來要對哪個環境呼叫圖片類 tool（跟操作其他 admin/platform
  tool 時同一套判斷方式，見 kit 根目錄 `CLAUDE.md` 的「多環境提醒」一節），
  再把**同一個**環境別名寫進 `.upload-env.tmp`。
- 如果使用者的描述沒有明確指出環境，先問清楚再動手，不要假設或延用上一輪
  操作過的環境。
- 每次上傳都只針對「這一張圖、這一個環境」，不要把同一個 `fileId` 拿去給
  不同語言的圖片欄位重複用，也不要跨環境重複用——每張圖片、每個語言各自
  重新呼叫一次本 skill。

## 這支 skill 會做什麼

1. 從 `.mcp.json` 讀出目標環境的 URL 與 Bearer token（單一事實來源，skill
   內不另存第二份 token）。
2. 用 `curl -F`（透過 `curl --config -` 從 stdin 餵設定，token 不進 curl
   的命令列參數）把圖片以 multipart/form-data 上傳到
   `<目標環境 URL 前綴>/files`。
3. 成功會拿到一個 `fileId`；失敗會拿到明確的錯誤訊息（型別不對、檔案太大、
   環境設定有誤等）。

腳本執行完之後，把它印出來的內容原樣告訴使用者。

## 限制

- **單檔大小上限：約 1MB**（正式路徑經 tg-dispatcher proxy，proxy 對超過
  1MB 的請求一律拒絕；upload.sh 會在上傳前於本機先檢查大小並直接拒絕過大
  的檔案，不會浪費一次網路請求）。不要以為別處看到的 3MB 是實際上限——那
  是 hosted server 自己的設定，正式路徑上構不到，實際能通過的上限是 proxy
  的 1MB。
- 僅支援 png / jpeg / webp，且是依**檔案內容（magic bytes）**判定，不是看
  副檔名——把檔案改名成 `.png` 不會讓不支援的格式變成合法。
- `fileId` 只保留 **24 小時**，且 hosted server 每次重啟或重新部署後，
  所有既有 `fileId` 會**立即全部失效**（fileId 只存在記憶體中，不會跨行程
  重啟保留）。如果 `edit_game` 之類的 tool 回報這個 `fileId` 找不到或無法
  使用，這通常不是 bug，直接重新呼叫本 skill 上傳一次拿新的 `fileId` 即可。

## 拿到 fileId 之後

把腳本印出的 `fileId` 原樣（不要修改、不要截斷）填進圖片類 tool 對應欄位的
`fileId` 參數（例如 `squareImages: [{code: "zh-TW", fileId: "..."}]`），
**不要**填本機檔案路徑到 `fileId` 欄位，也不要把 `filePath` 跟 `fileId`
同時帶——hosted 模式下兩者只能擇一，兩個都帶或都不帶都會被 tool 拒絕。

`fileId` 是單次使用的：每次呼叫圖片類 tool 前都要重新走一次「上傳→拿新
fileId」，不要把這一輪拿到的 `fileId` 存起來給下一張不同的圖片、或下一次
不同的操作重複使用。

## 常見結果與你該怎麼回應使用者

- **上傳成功**：把腳本印出的 `fileId` 原樣告訴使用者（或直接接著呼叫圖片類
  tool），並告知這個 `fileId` 只能用在指定的那個環境、只能用這一次。
- **上傳被拒絕（HTTP 401）**：Bearer token 可能已失效，先重跑登入 skill
  （`bash .claude/skills/login/login.sh`）確認這個環境仍能正常登入，再重試
  一次上傳；如果登入沒問題但上傳仍然 401，聯絡工程師確認 `.mcp.json` 設定。
- **檔案大小超過上限 / 型別不在白名單內（僅接受 png/jpeg/webp，以檔案內容
  判定，不是看副檔名）**：把腳本印出的訊息原樣告訴使用者，換一張符合條件的
  圖片再試，**不要自己重試同一張圖片**、也不要嘗試改副檔名繞過（型別判定看
  的是檔案內容，改副檔名沒有用）。
- **找不到環境別名**：腳本會列出 `.mcp.json` 裡實際有哪些環境別名，跟使用者
  確認清楚要上傳到哪一個，不要自己猜一個相近的名字。
- **找不到 `.mcp.json` 或格式壞掉**：照腳本印出的訊息指引，通常需要聯絡
  工程師重新提供這份 kit。

## 這支 skill 絕對不會做的事（設計上的硬限制，不是遺漏）

- 不會把 Bearer token 印到任何輸出或對話裡。
- 不會把帳密或 Bearer token 放進任何指令列參數——全部透過 `curl --config -`
  從 stdin 餵給 curl，`ps aux` 看它的執行過程只會看到 `curl --config -`。
- 不會用 `-v`／`--trace`／`--trace-ascii` 之類會把 Authorization header
  印到畫面上的 curl 旗標，也不會 echo 組好的 curl 指令或 config 內容。
- 不會快取上一次拿到的 `fileId` 給不同的圖片或不同的呼叫重複使用——每次都
  是全新的一次性上傳。
- 不會自動幫你決定要上傳到哪個環境——這個決定必須由你（Claude）依使用者
  當下的操作意圖明確指定，不會有任何「預設環境」或「延用上一輪」的行為。
