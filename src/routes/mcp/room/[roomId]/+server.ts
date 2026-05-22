/**
 * MCP one-paste onboarding route.
 *
 * GET /mcp/room/:roomId?invite=<INV>&password=<PW>&handle=<HANDLE>[&format=json]
 *
 * Server-side wrap of the 3-step ceremony so a Claude Desktop / Code agent
 * (or its human) can paste ONE URL instead of running exchange + join +
 * verify by hand. Per JWPK msg_7i2h8klrtp.
 *
 * Behaviour:
 *   - Missing invite/password → HTML form prompting for them, with the URL
 *     auto-filled and a "Continue" button that POSTs back to the same path.
 *   - Valid invite+password → run exchangePasswordForToken (kind=mcp) then
 *     bindTokenToRoomMembership, return either:
 *       (a) JSON `{ok:true, tokenSecret, mcpConfig, handle, roomId, host}`
 *           when ?format=json or Accept: application/json
 *       (b) HTML page with a paste-ready Claude Desktop config block,
 *           clear instructions, and a copy button.
 *   - Auth failures collapse to 401 "invite cannot be used" — same
 *     contract as /api/chat-invites/:inviteId/exchange.
 *
 * Why this lives in /mcp/room/ not /api/: a-nice-terminal's hooks.server.ts
 * gates non-/api/ routes behind the demo-login cookie, which would 303→/login
 * for an unauthenticated agent following the share-URL. Bypass for /mcp/* is
 * added at the gate so this route resolves directly.
 *
 * Security: the URL conveys the invite password as a query parameter. This
 * matches the existing remote-invite share model — the URL itself IS the
 * auth bearer until the one-shot exchange burns it. After redemption the
 * tokenSecret in the response IS the bearer; the URL becomes a no-op.
 * Consumers should treat the URL as a credential and delete after use.
 */

import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  ChatInviteRevokedError,
  ChatInviteHandleNotAllowedError,
  exchangePasswordForToken
} from '$lib/server/chatInviteStore';
import { bindTokenToRoomMembership } from '$lib/server/chatMembershipBinding';

interface OnboardedResult {
  roomId: string;
  tokenSecret: string;
  handle: string;
  host: string;
  mcpConfig: McpConfigBlock;
}

interface McpConfigBlock {
  mcpServers: Record<string, McpServerEntry>;
}

interface McpServerEntry {
  command: string;
  args: string[];
  env: Record<string, string>;
}

function buildMcpConfig(input: { roomId: string; tokenSecret: string; host: string }): McpConfigBlock {
  const slug = `antchat-${input.roomId}`;
  return {
    mcpServers: {
      [slug]: {
        command: '/Applications/Antchat.app/Contents/Resources/mcp-server-ant/mcp-server-ant.sh',
        args: [],
        env: {
          ANT_SERVER_URL: input.host,
          ANT_BEARER: input.tokenSecret,
          ANT_ROOM_ID: input.roomId
        }
      }
    }
  };
}

function htmlForm(input: { roomId: string; inviteId: string | null; host: string }): string {
  const inviteValue = (input.inviteId ?? '').replace(/"/g, '&quot;');
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Join Antchat room ${escapeHtml(input.roomId)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 640px; margin: 60px auto; padding: 0 24px; color: #1c1c1c; }
  h1 { font-size: 22px; }
  label { display: block; margin: 16px 0 4px; font-weight: 600; }
  input { width: 100%; padding: 10px 12px; font-size: 15px; border: 1px solid #d4d4d4; border-radius: 8px; }
  button { margin-top: 24px; padding: 12px 20px; font-size: 15px; font-weight: 600; background: #1c1c1c; color: white; border: 0; border-radius: 8px; cursor: pointer; }
  .hint { color: #6e6e6e; font-size: 13px; margin-top: 4px; }
</style>
</head>
<body>
<h1>Join Antchat room <code>${escapeHtml(input.roomId)}</code></h1>
<p>Provide the invite password and the handle you want to join as. The URL
becomes a paste-ready Claude Desktop config block.</p>
<form method="GET">
  <label>Invite ID</label>
  <input name="invite" value="${inviteValue}" required>
  <label>Password</label>
  <input name="password" type="password" required>
  <label>Handle (e.g. @yourname-claudedesktop)</label>
  <input name="handle" placeholder="@agent-handle" required>
  <button type="submit">Continue</button>
</form>
</body>
</html>`;
}

function htmlResult(result: OnboardedResult): string {
  const configJson = JSON.stringify(result.mcpConfig, null, 2);
  const merged = JSON.stringify(
    { mcpServers: { [`antchat-${result.roomId}`]: result.mcpConfig.mcpServers[`antchat-${result.roomId}`] } },
    null,
    2
  );
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>Antchat MCP config — room ${escapeHtml(result.roomId)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 720px; margin: 40px auto; padding: 0 24px; color: #1c1c1c; }
  h1 { font-size: 22px; }
  pre { background: #f5f5f5; padding: 16px; border-radius: 8px; overflow-x: auto; font-size: 13px; }
  .ok { color: #057a55; font-weight: 600; }
  .hint { color: #6e6e6e; font-size: 13px; }
  button { padding: 8px 14px; font-size: 13px; font-weight: 600; background: #1c1c1c; color: white; border: 0; border-radius: 6px; cursor: pointer; margin-bottom: 12px; }
  ol li { margin: 10px 0; }
  code { background: #f0f0f0; padding: 2px 6px; border-radius: 4px; font-size: 13px; }
</style>
</head>
<body>
<h1>✅ Joined room <code>${escapeHtml(result.roomId)}</code> as <code>${escapeHtml(result.handle)}</code></h1>
<p class="hint">Bearer minted. Paste the block below into Claude Desktop's <code>claude_desktop_config.json</code> (or Claude Code's <code>~/.claude.json</code>), restart the app, and the antchat tools appear.</p>
<button onclick="navigator.clipboard.writeText(document.getElementById('cfg').textContent).then(()=>this.textContent='Copied');">Copy config</button>
<pre id="cfg">${escapeHtml(merged)}</pre>
<h2>Config file paths</h2>
<ol>
<li>Claude Desktop: <code>~/Library/Application Support/Claude/claude_desktop_config.json</code></li>
<li>Claude Code: <code>~/.claude.json</code></li>
</ol>
<p class="hint">The block adds a <code>mcpServers.antchat-${escapeHtml(result.roomId)}</code> entry — merge it into your existing <code>mcpServers</code> map; don't overwrite other servers. After saving, fully quit and relaunch the host app.</p>
<p class="hint">This URL contains a one-shot password and a freshly-minted bearer. Treat as a credential. Delete after use.</p>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function originFromRequest(request: Request, url: URL): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  const forwardedProto = request.headers.get('x-forwarded-proto');
  if (forwardedHost && forwardedHost.length > 0) {
    return `${forwardedProto ?? 'https'}://${forwardedHost}`;
  }
  return url.origin;
}

function wantsJson(request: Request, url: URL): boolean {
  if (url.searchParams.get('format') === 'json') return true;
  const accept = request.headers.get('accept') ?? '';
  return accept.includes('application/json');
}

export const GET: RequestHandler = async ({ params, request, url }) => {
  const roomId = params.roomId ?? '';
  if (roomId.length === 0) throw error(400, 'URL roomId is required.');

  const inviteId = url.searchParams.get('invite');
  const password = url.searchParams.get('password');
  const handle = url.searchParams.get('handle');
  const host = originFromRequest(request, url);

  if (!inviteId || !password || !handle) {
    if (wantsJson(request, url)) {
      throw error(400, 'invite, password, and handle query parameters are required.');
    }
    return new Response(htmlForm({ roomId, inviteId, host }), {
      headers: { 'content-type': 'text/html; charset=utf-8' }
    });
  }

  let exchangeResult: { tokenId: string; tokenSecret: string };
  try {
    exchangeResult = exchangePasswordForToken({
      inviteId,
      password,
      kind: 'mcp',
      handle
    });
  } catch (failure) {
    if (failure instanceof ChatInviteRevokedError) throw error(401, 'invite cannot be used');
    if (failure instanceof ChatInviteHandleNotAllowedError) {
      throw error(403, 'handle not permitted by invite');
    }
    if (failure instanceof Response) throw failure;
    throw error(401, 'invite cannot be used');
  }

  const binding = bindTokenToRoomMembership({
    roomId,
    tokenSecret: exchangeResult.tokenSecret
  });
  if (!binding) {
    throw error(401, 'invite cannot bind to this room');
  }

  const result: OnboardedResult = {
    roomId,
    tokenSecret: exchangeResult.tokenSecret,
    handle: binding.member.handle,
    host,
    mcpConfig: buildMcpConfig({
      roomId,
      tokenSecret: exchangeResult.tokenSecret,
      host
    })
  };

  if (wantsJson(request, url)) {
    return json({
      ok: true,
      roomId: result.roomId,
      handle: result.handle,
      tokenSecret: result.tokenSecret,
      host: result.host,
      mcpConfig: result.mcpConfig
    });
  }

  return new Response(htmlResult(result), {
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
};
