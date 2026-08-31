/**
 * tools/issue.ts — aladdin_kit_issue
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { runKitScript } from '../spawn_kit_script.ts';
import { asTextResult } from '../mcp_result.ts';

// 跟 make-starter-kit.ts 的 ALLOWED_GRANTS 保持同步：目前真的部署常駐、
// 端到端可用的環境。這裡刻意重複列一份（而不是 import 那支腳本的常數），
// 因為那支腳本設計上是獨立 CLI，不對外 export；schema 用的是字串常數本身，
// 之後那份清單擴充時要記得一併更新這裡。
const ALLOWED_GRANT_VALUES = [ 'admin-dev', 'platform-dev-pk', 'admin-pre', 'admin-evi' ] as const;

export function registerIssueKitTool(server: McpServer): void {
    server.registerTool(
        'aladdin_kit_issue',
        {
            title: '核發企劃 starter kit',
            description:
                '包裝 ../aladdin-ai-assistant-kit/make-starter-kit.ts：幫一位企劃核發（或重新簽發）一份 ' +
                'starter kit，內含他個人專屬的 Bearer token，讓他自己的 Claude Code 能連回本機常駐的 ' +
                'hosted MCP server（aladdin-admin / aladdin-platform）操作 agrabah 後台。\n\n' +
                '不帶 grants 時預設給 admin-dev + 所有已部署的 platform-dev-*（目前只有 platform-dev-pk），' +
                '並在這個 id 還沒有 toolsmith 條目時一併核發 toolsmith——這是最常見的組合，正常情況不需要' +
                '特別指定。admin-pre、admin-evi 是額外的環境，只有明確要開放這兩個時才需要在 grants 裡加上去' +
                '（不會因為留空而自動帶到，也不影響是否核發 toolsmith）。明確帶 grants 縮小範圍時視為刻意只要' +
                '那幾個環境，不會連帶核發 toolsmith。\n\n' +
                '對同一個 id 重跑：預設拒絕並回傳既有紀錄（核發時間、顯示名），不做任何修改。要重新簽發' +
                '（換一把新 token，舊 token 立刻失效）必須明確帶 rotate=true——這會讓對方手上舊的 kit 打不通，' +
                '呼叫前確認清楚是不是真的要重簽。\n\n' +
                '成功後產出在 aladdin-ai-assistant-kit/dist/<id>/，回傳的 output 欄位會附下一步提醒：整個資料夾' +
                '要透過一對一私密管道交給企劃（不可貼群組/共用文件/會存檔的頻道）——這份資料夾等同他的完整' +
                'agrabah 帳號。',
            inputSchema: {
                id: z.string().describe(
                    '企劃唯一代號：小寫英數字/連字號/底線，2-32 字元，必須以小寫英文字母開頭。同時是名冊 id ' +
                    '與輸出目錄名（dist/<id>/），建議用企劃的英文/拼音代稱（例如 chenmei），不要用中文或空白。',
                ),
                name: z.string().describe('企劃顯示名稱（例如「陳美」），寫入 token 名冊供人工核對用，不影響任何權限判斷。'),
                grants: z.array(z.enum(ALLOWED_GRANT_VALUES)).min(1).optional().describe(
                    '要開放的環境子集。留空預設給 admin-dev + 所有已部署的 platform-dev-*（目前是 ' +
                    'platform-dev-pk），並一併核發 toolsmith（若還沒有）——大多數情況不需要帶這個參數；只有' +
                    '明確要限縮權限範圍（且不核發 toolsmith）時才指定。',
                ),
                rotate: z.boolean().optional().default(false).describe(
                    'true=對已存在的 id 重新簽發新 token（舊 token 立刻失效，舊 kit 打不通）。id 不存在時這個' +
                    '參數沒有作用（等同一般首次核發）。',
                ),
            },
        },
        async ({ id, name, grants, rotate }) => {
            const args = [ '--id', id, '--name', name ];
            if (grants && grants.length > 0) args.push('--grants', grants.join(','));
            if (rotate) args.push('--rotate');

            const result = runKitScript(args);
            return asTextResult({
                success: result.success,
                distDir: result.success
                    ? `/Users/user/aladdin/aladdin_mcps/aladdin-ai-assistant-kit/dist/${ id }`
                    : undefined,
                output: result.stdout || undefined,
                error: result.success ? undefined : (result.stderr || '（腳本無輸出，僅回傳非 0 exit code）'),
            });
        },
    );
}
