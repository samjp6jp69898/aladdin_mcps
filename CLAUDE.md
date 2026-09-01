# CLAUDE.md（aladdin_mcps）

`aladdin_mcps/` 是 hosted MCP server 的原始碼與部署，獨立 git repo（路徑已攤平，各 server 目錄下不再有 `mcps/` 前綴）。架構、新增 tool 公版、安裝與連線的完整規範見本目錄 `README.md`；各 server 專屬資訊看該 server 自己的 README。

## 硬規則

- `git push` 一律禁止，唯一例外：`aladdin-toolsmith` 的 `deploy-pipeline.ts` 對 `main` 分支操作，僅限 tsc 結構性檢查與獨立對抗性覆核 agent 皆判定通過後才 push；任一關卡沒過即回滾、不 push。
- 其餘安全邊界（Commit message 禁 `Co-Authored-By`、CQA grounding 唯讀限定等）與 `/Users/user/aladdin/CLAUDE.md` 一致；未在此重複列出的以該檔為準。
