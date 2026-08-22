/**
 * tools/login.ts — aladdin_admin_auth_login
 *
 * rajah: Auth.Login
 */

import { z } from 'zod';
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import { login } from '../session.ts';
import { asTextResult, asErrorResult } from '../mcp_result.ts';

export function registerLoginTool(server: McpServer): void {
    server.registerTool(
        'aladdin_admin_auth_login',
        {
            title: 'Login to agrabah admin backend',
            description:
                '登入 agrabah admin 後台（rajah: Auth.Login），取得後續 RPC 呼叫所需的登入態。' +
                'Token 只存在本 MCP server process 記憶體中，不落地、不回傳給呼叫端。' +
                '留空 identifier/password 會使用環境變數設定的預設測試帳密。' +
                '其他 tool 偵測到尚未登入、或 token 過期（後端有效期 15 分鐘）時會自動呼叫本流程重登一次，' +
                '不需要每次手動先呼叫這支——只有在後端明確要求 TOTP／簡訊驗證碼且沒有預設值時才需要手動帶 totpCode，' +
                '這種當下動態驗證碼必須向操作者當場索取，不可自行編造或猜測。',
            inputSchema: {
                identifier: z.string().optional().describe('登入帳號，留空則用環境變數 ALADDIN_ADMIN_USER'),
                password: z.string().optional().describe('登入密碼，留空則用環境變數 ALADDIN_ADMIN_PASSWORD'),
                totpCode: z.string().optional().describe('當下的 TOTP / 簡訊驗證碼；僅在後端回應要求時才需要，不寫死、不預先猜測'),
            },
        },
        async ({ identifier, password, totpCode }) => {
            const r = await login({ identifier, password, totpCode });
            return r.success ? asTextResult(r) : asErrorResult(r);
        },
    );
}
