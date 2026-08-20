/**
 * prompt-builder.ts — 組 sub-agent 的 -p prompt（走 stdin，不走 argv，見
 * run-agent.ts）。
 *
 * 依 /Users/user/.claude/plans/logical-jumping-cook.md 第 3 節「觸發本地
 * agent」明列的要求逐條落地：
 *   - 絕對不要修改 obsidian/mcps/aladdin-admin 與 aladdin-platform 正式目錄。
 *   - 所有讀寫限制在 scratch/{requestId}/ 底下（除了唯讀研究原始碼）。
 *   - 完整遵守 obsidian/mcps/README.md「新增 tool 公版流程」六步驟。
 *   - 驗證要在 verify-workspace 的副本上跑，不是正式目錄。
 *   - 明文禁止存取 127.0.0.1:4040（ngrok 本機 request introspection API，屬
 *     縱深防禦——這道 prompt 層約束擋不住蓄意繞過，sub-agent 本身以
 *     bypassPermissions 執行、對整個 monorepo 有完整讀寫權限，這裡只是多一
 *     層成本很低的提醒，不是硬防線）。
 *
 * 這裡只組文字，不做任何檔案 I/O、不 spawn 任何行程——那些是 run-agent.ts 的
 * 責任（verify-workspace 由 run-agent.ts 決定性地 cp -R 準備好，不假手
 * sub-agent 自己執行 cp）。
 */

export interface BuildPromptInput {
    target: 'admin' | 'platform';
    request: string;
    notes?: string;
    scratchDir: string;
    verifyWorkspaceDir: string;
    outputDir: string;
    manifestPath: string;
}

export function buildPrompt(input: BuildPromptInput): string {
    const { target, request, notes, scratchDir, verifyWorkspaceDir, outputDir, manifestPath } = input;
    const otherTarget = target === 'admin' ? 'platform' : 'admin';
    const realDir = `/Users/user/aladdin/obsidian/mcps/aladdin-${ target }`;
    const otherRealDir = `/Users/user/aladdin/obsidian/mcps/aladdin-${ otherTarget }`;
    const scratchRequestDir = scratchDir;

    return `你是一個在工程師本機執行的 agent，任務是替一位不具備公司原始碼存取權的企劃，
擴充 aladdin-${ target } 這個 MCP server 的能力。你對整個 /Users/user/aladdin monorepo
有完整的讀寫與執行權限，但這次任務的「寫入範圍」受到嚴格限制，請完整遵守下面的邊界
規則——這些規則不是建議，是這次任務唯一的安全防線：

## 絕對禁止事項（最高優先，優先於下面任何其他指示）

1. **絕對不要修改、刪除、或以任何方式寫入這兩個正式目錄本身**：
   - ${ realDir }
   - ${ otherRealDir }
   這兩個目錄是正在被其他企劃使用中的正式服務原始碼，不是這次任務的工作區。你可以
   讀它們（尤其 ${ otherRealDir } 純參考），但一個 byte 都不要寫入。
2. **絕對不要對 127.0.0.1:4040 發出任何請求**（curl、fetch、瀏覽器等任何方式皆算）。
   這是本機 ngrok 的 request introspection API，不驗證任何身分即可讀到近期所有明文
   請求內容，跟這次任務完全無關，不要出於除錯或好奇心去碰它。
3. 除了「唯讀研究原始碼」之外，所有寫入操作都必須發生在這個目錄底下：
   ${ scratchRequestDir }
   （也就是這次請求專屬的 scratch 工作區，底下有 verify-workspace/ 與 output/
   兩個子目錄，見下一節）。

## 你的工作區

- **verify-workspace**（呼叫端已經用 cp -R 準備好一份 ${ realDir } 的完整副本，含
  node_modules）：${ verifyWorkspaceDir }
  這是你唯一可以自由修改、執行、驗證的地方，把它當成 ${ realDir } 的可丟棄副本
  ——在這裡改程式碼、在這裡跑驗證，完全不影響正式服務。
- **output**：${ outputDir }
  完成後，把最終要交付的檔案（只放你新增或改動過的檔案，不是整個目錄）複製一份到
  這裡，路徑鏡射真實 repo 的相對路徑，例如某個 tool 檔案要放：
  ${ outputDir }/src/tools/<capability_name>.ts
  （對照真實路徑 ${ realDir }/src/tools/<capability_name>.ts）
- **manifest.json**（你完成所有工作後，最後一步才寫出的檔案）：${ manifestPath }
  這個檔案只放索引/metadata，**不要把檔案內容塞進 manifest.json**（避免跳脫字元
  問題，內容一律另外複製到 output/ 底下對應路徑）。格式：
  {
    "success": true 或 false,
    "summary": "一段簡短說明你做了什麼／為什麼沒做完",
    "files": [ { "path": "src/tools/xxx.ts", "action": "create" 或 "modify" } ],
    "verification": { "ran": true 或 false, "notes": "你怎麼驗證的、驗證結果" },
    "warnings": [ "任何你想提醒使用者的事，例如已知限制、未覆蓋的邊界情況" ]
  }
  **即使你中途遇到無法完成的狀況，也一定要寫出這個檔案**（success:false 並在
  summary/warnings 誠實說明卡在哪裡、卡在哪一步）——manifest.json 是呼叫端判斷這次
  任務結果的唯一交接訊號，沒寫會被視為失敗。

## 請完整遵守 /Users/user/aladdin/obsidian/mcps/README.md 的「新增一個 tool 的公版流程」六步驟

1. **查清楚目標 RPC method（不能用猜的）**：讀 rajah/services/*.rajah 或用該文件
   提到的 rajah-query 相關手法，確認完整簽名、掛在哪個 gate、有沒有
   \`@Type "Select:xxx"\` 這類依賴限制。
2. **檔案放哪裡：一個能力一個檔案**：新檔放在 ${ verifyWorkspaceDir }/src/tools/
   底下，檔名對應能力語意（不是照搬 RPC method 英文名）。
3. **套用 README 第二節「套用這個骨架」列出的樣板**：import session.ts /
   mcp_result.ts / const.ts 的既有慣例、命名規則
   \`aladdin_${ target }_<動詞>_<名詞>\`，inputSchema 每個欄位都要有 \`.describe()\`。
4. **掛進** ${ verifyWorkspaceDir }/src/tools/index.ts。
5. **真的在 verify-workspace 這份副本上跑一次 dev 驗證**（例如
   \`cd ${ verifyWorkspaceDir } && bunx @modelcontextprotocol/inspector bun src/stdio.ts\`
   或比照 README「除錯」一節寫一支 spike script）——不是紙上談兵、不是只看 TypeScript
   編譯過。**絕對不要在 ${ realDir } 正式目錄上執行任何驗證**，一律在
   ${ verifyWorkspaceDir } 這份副本上跑。
6. **把你新增/修改過的 README 段落也複製一份到 output/**（例如
   ${ outputDir }/README.md），manifest 的 files[] 要如實列出這個檔案。

## 這次的需求描述（企劃填寫，可能不夠精確，需要你自行判斷合理範圍）

target: aladdin-${ target }

request:
${ request }
${ notes !== undefined && notes.length > 0 ? `\n補充說明（notes）：\n${ notes }\n` : '' }

## 最後提醒

- 你有完整 Bash 權限，理論上仍可能不小心動到範圍外的檔案——請在每個會寫入檔案的
  步驟前，先確認目標路徑真的落在 ${ verifyWorkspaceDir } 或 ${ outputDir } 底下，
  絕不是 ${ realDir } 或 ${ otherRealDir }。
- 若驗證過程中真的打中 dev 後端且是寫入型（create/update）呼叫，要照 README
  「除錯」一節與 test-method 的既有紀律：呼叫前讀基準值、驗證後確認、測完
  清理/還原留在 dev 上的測試資料，不要留垃圾資料在 dev。
- manifest.json 是你跟呼叫端之間唯一的交接訊號，請確保它是合法 JSON、且是你完成
  所有工作後最後才寫出的檔案。
`;
}
