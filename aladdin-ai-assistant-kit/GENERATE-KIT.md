# 工程師專用：怎麼幫企劃產生一份 kit

> 這份文件不會被發給企劃（不在 `make-starter-kit.ts` 的 `STATIC_FILES`
> 白名單裡）。企劃看的是 `README.md`。

> **不要對同一個 `--id` 同時跑兩個 instance**（例如兩個工程師手滑同時發
> 同一個人）。腳本是「先檢查、再寫入」兩階段，沒有做跨行程鎖，同時執行時
> 兩邊都可能通過檢查、最後名冊以後寫入者為準，兩人可能都以為自己拿到的
> kit 是唯一有效版本。實務上這支工具本來就是單人手動逐一執行，風險低，
> 但值得留意——真的不確定時，先跑一次 `--list` 確認沒人正在處理同一個人。

## 一次性

```bash
cd /Users/user/aladdin/obsidian/mcps/aladdin-ai-assistant-kit
bun make-starter-kit.ts --id chenmei --name "陳美"
```

不帶 `--grants` 時預設兩個都給：`admin-dev`（`aladdin-admin-dev`）+
`platform-dev-pk`（`aladdin-platform`）。目前也**只有**這兩個是真的部署上線
可用的環境——pre/evi 被 tasks.json 的 H38 裁定擋住（prod 寫入閘門補強要先
做完），uat 與 platform 其他平台產品根本還沒部署。腳本會拒絕任何其他
`--grants` 值並講清楚理由，不會靜默忽略。

只要其中一種：

```bash
bun make-starter-kit.ts --id chenmei --name "陳美" --grants admin-dev
bun make-starter-kit.ts --id chenmei --name "陳美" --grants platform-dev-pk
```

產出在 `dist/<id>/`（已被 `.gitignore` 排除，不會被 git 追蹤）。整個資料夾
交給企劃即可，交付方式看資料夾內 README.md 開頭的提醒——**一對一私密管道，
不要貼群組/共用文件/會存檔的頻道**。

## 查目前已經發過誰

```bash
bun make-starter-kit.ts --list
```

列出兩份名冊（admin-dev、platform-dev-pk）目前所有的 `id`／顯示名／核發
時間，不含 token 值。

## 同一個人要重新簽發（rotate）

```bash
bun make-starter-kit.ts --id chenmei --name "陳美" --rotate
```

行為：對這次 `--grants` 指定的每個環境各自產生一把全新 token，**取代**名冊
裡同一個 `id` 的舊條目——舊 token 立刻失效（名冊 fail-closed、每個 request
現讀檔案，不需要重啟任何服務），舊的 kit 資料夾即使還留著，裡面的 token 也
已經打不通了。同時整個重新產生 `dist/<id>/`。

**不帶 `--rotate` 對同一個 `id` 重跑會直接拒絕**（印出既有紀錄、不做任何
修改）——這是刻意的預設，避免手滑重跑指令就悄悄轉出一把新 token、卻沒注意
到舊的已經失效。

**`--grants` 縮小範圍不等於撤權**：如果這個人之前被發過 admin-dev +
platform-dev-pk，這次只 `--rotate --grants admin-dev`，platform 那把舊
token 完全不會被動到，也不會被撤銷。要撤銷用 H28 的撤銷流程（尚未實作），
不要指望這支產生器順便做這件事。

## 驗收一次新發的 kit（H19 AC 要求，別跳過）

```bash
# 1. .mcp.json 是合法 JSON
python3 -m json.tool dist/chenmei/.mcp.json > /dev/null && echo OK

# 2. grep 不到公司原始碼路徑/其他人的 token（抽查）
grep -rl "/Users/user/aladdin" dist/chenmei/ || echo "沒有命中（正常）"

# 3. 名冊確實新增了紀錄
bun make-starter-kit.ts --list | grep chenmei

# 4. 新 token 真的能通過認證（實際打一次 initialize；token 直接從
#    dist/chenmei/.mcp.json 裡讀，不要手動複製貼上到別的地方）
TOKEN=$(python3 -c "import json;print(json.load(open('dist/chenmei/.mcp.json'))['mcpServers']['aladdin-admin-dev']['headers']['Authorization'].split(' ')[1])")
curl -sS -m 5 -X POST https://unrefreshing-trudy-subsequently.ngrok-free.dev/mcp-admin-dev/mcp \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  -H 'accept: application/json, text/event-stream' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"verify","version":"0"}}}'
```

驗收完不要把這份測試用 kit 留著發出去——如果只是自我驗證，`--rotate` 掉或
之後交給 H28 的撤銷流程處理。

## toolsmith（尚未支援）

toolsmith（H25/H26 上線後）預期是**全員共用一把 `TOOLSMITH_API_TOKEN`**
（跟 admin/platform 一人一把不同），撤銷任一人需要輪替並重發**所有**已發出
的 kit。要把 toolsmith 加進這支產生器時，第一份含 toolsmith 的 kit 發出去
之前，這個不對稱一定要先用醒目文字提醒操作者（tasks.json H19 AC 原文
要求）。目前 `.env.example`／`.mcp.json.example` 完全沒有 toolsmith 相關
欄位，這支產生器現況也完全不處理它。
