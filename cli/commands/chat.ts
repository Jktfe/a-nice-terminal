import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { createInterface } from 'readline';
import { execFileSync } from 'child_process';
import { readFileSync, statSync } from 'fs';
import { basename, extname, resolve } from 'path';

/** Detect whether we're inside an ANT-managed tmux session. */
export function detectNativeSession(): { isNative: boolean; sessionId: string | null } {
  // Explicit env var takes priority
  if (process.env.ANT_SESSION_ID) {
    return { isNative: true, sessionId: process.env.ANT_SESSION_ID };
  }
  // Inside tmux? The session name IS the ANT terminal session ID.
  if (process.env.TMUX) {
    try {
      const pane = process.env.TMUX_PANE;
      const tmuxArgs = pane
        ? ['display-message', '-p', '-t', pane, '#{session_name}']
        : ['display-message', '-p', '#{session_name}'];
      const name = execFileSync('tmux', tmuxArgs, { stdio: 'pipe' }).toString().trim();
      if (name) return { isNative: true, sessionId: name };
    } catch {}
  }
  return { isNative: false, sessionId: null };
}

/**
 * Resolve sender identity for chat messages.
 *
 * Native sessions (inside ANT tmux): returns the tmux session name, which is
 * the ANT terminal session ID. The server resolves this to the terminal's
 * handle and display_name automatically.
 *
 * External sessions (--external flag or no tmux): returns the configured
 * handle or a generic 'cli-external' identifier.
 */
function resolveIdentity(external: boolean): string {
  if (external) {
    return config.get('handle') || 'cli-external';
  }
  const { isNative, sessionId } = detectNativeSession();
  if (isNative && sessionId) return sessionId;
  return config.get('handle') || 'cli';
}

// Auto-attach the per-room bearer token saved by `ant join-room` so remote ANTs
// don't need to pass --key. Narrower than master apiKey — scoped to one room
// and revocable from the inviter side. Falls through to apiKey if no token.
function roomOpts(id: string): { roomToken?: string } | undefined {
  const t = config.getRoomToken(id);
  return t?.token ? { roomToken: t.token } : undefined;
}

const MIME_BY_EXT: Record<string, string> = {
  '.avif': 'image/avif',
  '.csv': 'text/csv',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.js': 'text/javascript',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.svg': 'image/svg+xml',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
};

function normalizeTarget(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const trimmed = value.trim();
  if (trimmed === '@everyone') return null;
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function mimeForPath(path: string): string {
  return MIME_BY_EXT[extname(path).toLowerCase()] || 'application/octet-stream';
}

async function postMultipart(ctx: any, path: string, formData: FormData, opts?: { roomToken?: string }): Promise<any> {
  const headers: Record<string, string> = {};
  if (opts?.roomToken) headers.Authorization = `Bearer ${opts.roomToken}`;
  else if (ctx.apiKey) headers.Authorization = `Bearer ${ctx.apiKey}`;

  const options: any = {
    method: 'POST',
    headers,
    body: formData,
    tls: { rejectUnauthorized: false },
    dispatcher: undefined as any,
  };

  if (ctx.serverUrl.startsWith('https://') && typeof (globalThis as any).Bun === 'undefined') {
    try {
      const { Agent } = await import('undici');
      options.dispatcher = new Agent({ connect: { rejectUnauthorized: false } });
    } catch {}
  }

  let url = `${ctx.serverUrl}${path}`;
  let res: Response;
  try {
    headers.Origin = new URL(url).origin;
    res = await fetch(url, options);
  } catch (err: any) {
    if (url.startsWith('http://') && (err.code === 'UND_ERR_SOCKET' || err.message?.includes('socket'))) {
      url = url.replace('http://', 'https://');
      headers.Origin = new URL(url).origin;
      console.warn(`[ant] http:// failed — retrying with https://`);
      res = await fetch(url, options);
    } else {
      throw err;
    }
  }
  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: res.statusText }));
    throw new Error(err.error || `HTTP ${res.status}`);
  }
  return res.json();
}

async function sendFileMessage(args: {
  ctx: any;
  roomId: string;
  filePath: string;
  sender: string;
  target: string | null;
  note: string;
  room: { roomToken?: string } | undefined;
}) {
  const absPath = resolve(args.filePath);
  const stat = statSync(absPath);
  if (!stat.isFile()) throw new Error(`Not a file: ${absPath}`);

  const bytes = readFileSync(absPath);
  const name = basename(absPath);
  const mime = mimeForPath(absPath);
  const formData = new FormData();
  formData.append('file', new Blob([bytes], { type: mime }), name);

  const qs = new URLSearchParams({ session_id: args.roomId, handle: args.sender });
  const uploaded = await postMultipart(args.ctx, `/api/upload?${qs.toString()}`, formData, args.room);

  const targetLine = args.target ? `${args.target} ` : '';
  const intro = args.note.trim() ? `${args.note.trim()}\n\n` : '';
  const content = `${targetLine}${intro}Shared file: ${name}\n${uploaded.url}\nSHA-256: ${uploaded.hash}\nSource: ${absPath}`;

  const result = await api.post(args.ctx, `/api/sessions/${args.roomId}/messages`, {
    role: 'user',
    content,
    format: 'text',
    sender_id: args.sender,
    target: args.target,
    msg_type: 'file_share',
    meta: {
      source: 'cli_file_share',
      file: {
        name,
        original_path: absPath,
        url: uploaded.url,
        hash: uploaded.hash,
        size: uploaded.size,
        mime_type: mime,
      },
    },
  }, args.room);

  try {
    await api.post(args.ctx, `/api/sessions/${args.roomId}/file-refs`, {
      file_path: absPath,
      note: `Shared${args.target ? ` to ${args.target}` : ''}: ${uploaded.url}`,
      flagged_by: args.sender,
    }, args.room);
  } catch {}

  return { uploaded, message: result };
}

function formatPendingEvent(status: any): string {
  if (!status?.needs_input) return 'No pending interactive prompt.';
  const event = status.event || {};
  const eventClass = status.event_class || event.class || event.type || 'prompt';
  const summary = status.summary || event.text || event.payload?.message || event.payload?.question || event.payload?.prompt || 'Input needed';
  const lines = [
    `Pending ${eventClass}: ${summary}`,
    `Event: ${status.event_id || 'unknown'}`,
  ];
  if (status.route?.terminal_id) lines.push(`Terminal: ${status.route.terminal_id}`);
  if (status.event_chat_id || status.route?.linked_chat_id) lines.push(`Linked chat: ${status.event_chat_id || status.route.linked_chat_id}`);
  lines.push(`Decide: ant chat decide ${status.route?.linked_chat_id || status.event_chat_id || '<chat-id>'} approve --why "reason"`);
  return lines.join('\n');
}

function decisionAction(args: string[], flags: any): string {
  if (flags.approve) return 'approve';
  if (flags.deny) return 'deny';
  if (flags.retry) return 'retry';
  if (flags.abort) return 'abort';
  if (flags.yes) return 'yes';
  if (flags.no) return 'no';
  if (flags.confirm) return String(flags.confirm) === 'false' || String(flags.confirm).toLowerCase() === 'no' ? 'no' : 'yes';
  if (flags.text) return 'text';
  if (flags.select || flags.option || flags.index) return 'select';
  return String(flags.action || args[2] || '').toLowerCase();
}

function buildDecisionPayload(status: any, action: string, args: string[], flags: any) {
  const event = status.event;
  if (!event) throw new Error('Pending status did not include event payload');

  const reason = flags.why || flags.reason || flags.justification || '';
  let payload: any;
  switch (action) {
    case 'approve':
    case 'run':
    case 'authorise':
    case 'authorize':
      payload = { type: 'approve', choice: { action: 'approve' } };
      break;
    case 'deny':
    case 'reject':
      payload = { type: 'deny', choice: { action: 'deny' } };
      break;
    case 'yes':
    case 'confirm':
      payload = { type: 'confirm', choice: { yes: true } };
      break;
    case 'no':
    case 'cancel':
      payload = { type: 'confirm', choice: { yes: false } };
      break;
    case 'retry':
      payload = { type: 'retry', choice: { action: 'retry' } };
      break;
    case 'abort':
      payload = { type: 'abort', choice: { action: 'abort' } };
      break;
    case 'text': {
      const value = flags.text || flags.value || args[3];
      if (!value) throw new Error('Text decision requires --text "response"');
      payload = { type: 'text', choice: { value } };
      break;
    }
    case 'select': {
      const raw = flags.select || flags.option || flags.index || args[3];
      const index = Number(raw) - 1;
      if (!Number.isInteger(index) || index < 0) throw new Error('Select decision requires --select 1 (1-based option number)');
      payload = { type: 'select', choice: { index } };
      break;
    }
    default:
      throw new Error('Usage: ant chat decide <id> approve|deny|yes|no|retry|abort|text|select --why "reason"');
  }

  return {
    ...payload,
    event_id: status.event_id,
    event_content: JSON.stringify(event),
    justification: reason,
    source: 'cli_decision',
  };
}

function resolveMemberIdentifier(external: boolean, flags: any): { key: 'session_id' | 'handle'; value: string } {
  if (typeof flags.session === 'string' && flags.session.trim()) {
    return { key: 'session_id', value: flags.session.trim() };
  }
  if (typeof flags.handle === 'string' && flags.handle.trim()) {
    const handle = flags.handle.trim();
    return { key: 'handle', value: handle.startsWith('@') ? handle : `@${handle}` };
  }
  if (!external) {
    const { isNative, sessionId } = detectNativeSession();
    if (isNative && sessionId) return { key: 'session_id', value: sessionId };
  }
  const configuredSession = config.get('sessionId');
  if (configuredSession) return { key: 'session_id', value: configuredSession };
  const configuredHandle = config.get('handle');
  if (configuredHandle) return { key: 'handle', value: configuredHandle };
  return { key: 'session_id', value: resolveIdentity(external) };
}

export async function chat(args: string[], flags: any, ctx: any) {
  const sub = args[0];
  const id = ['send', 'read', 'reply', 'join', 'leave', 'pending', 'decide'].includes(sub) ? args[1] : sub;
  const isExternal = !!flags.external;

  if (!id) {
    console.error('Usage: ant chat <session-id>');
    return;
  }

  // Send a single message
  if (sub === 'send') {
    const positionalTarget = args[2]?.startsWith('@') ? normalizeTarget(args[2]) : null;
    const target = normalizeTarget(flags.to || flags.target) || positionalTarget;
    const msgArgIndex = args[2]?.startsWith('@') ? 3 : 2;
    const msg = flags.msg || args[msgArgIndex] || '';
    const filePath = typeof flags.file === 'string' ? flags.file : '';
    if (!msg && !filePath) { console.error('Usage: ant chat send <id> [@handle] --msg "message" [--file /path/to/file]'); return; }
    const sender = resolveIdentity(isExternal);
    const room = roomOpts(id);
    if (filePath) {
      const result = await sendFileMessage({ ctx, roomId: id, filePath, sender, target, note: msg, room });
      if (ctx.json) { console.log(JSON.stringify(result)); return; }
      console.log(`Shared: ${result.uploaded.url}`);
      return;
    }
    const result = await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: msg, format: 'text', sender_id: sender, target }, room);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    console.log(`Sent: ${msg}`);
    return;
  }

  // Show the pending interactive prompt for a terminal or linked chat
  if (sub === 'pending') {
    const status = await api.get(ctx, `/api/sessions/${id}/status`);
    if (ctx.json) { console.log(JSON.stringify(status)); return; }
    console.log(formatPendingEvent(status));
    return;
  }

  // Approve/deny/respond to the current pending interactive prompt.
  // This is intentionally CLI-friendly so a coordinator agent can make a
  // decision with justification without using the browser card.
  if (sub === 'decide') {
    const status = await api.get(ctx, `/api/sessions/${id}/status`);
    if (!status?.needs_input) {
      if (ctx.json) { console.log(JSON.stringify({ ok: false, reason: 'no_pending_prompt' })); return; }
      console.log('No pending interactive prompt.');
      return;
    }
    const action = decisionAction(args, flags);
    const payload = buildDecisionPayload(status, action, args, flags);
    const sender = resolveIdentity(isExternal);
    const linkedChatId = status.event_chat_id || status.route?.linked_chat_id || id;
    const result = await api.post(ctx, `/api/sessions/${linkedChatId}/messages`, {
      role: 'user',
      content: JSON.stringify(payload),
      format: 'text',
      sender_id: sender,
      reply_to: status.event_id || null,
      msg_type: 'agent_response',
      meta: {
        source: 'cli_decision',
        terminal_id: status.route?.terminal_id || status.terminal?.id || null,
        justification: payload.justification || null,
      },
    });
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    console.log(`Decision sent: ${payload.type}${payload.justification ? ` — ${payload.justification}` : ''}`);
    return;
  }

  // Leave a chatroom as the current terminal/agent
  if (sub === 'leave') {
    const identity = resolveMemberIdentifier(isExternal, flags);
    const path = `/api/sessions/${id}/participants?${identity.key}=${encodeURIComponent(identity.value)}`;
    const result = await api.del(ctx, path);
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    if (result.removed) {
      console.log(`Left ${id} as ${identity.value}`);
    } else {
      console.log(`No membership found for ${identity.value} in ${id}`);
    }
    return;
  }

  // Read chat history
  if (sub === 'read') {
    const limit = flags.limit || 50;
    const data = await api.get(ctx, `/api/sessions/${id}/messages?limit=${limit}`, roomOpts(id));
    const messages = data.messages || [];
    if (ctx.json) { console.log(JSON.stringify(messages)); return; }
    for (const m of messages) {
      const prefix = m.role === 'user' ? '\x1b[36mYou\x1b[0m' : '\x1b[33mANT\x1b[0m';
      console.log(`${prefix}: ${m.content}`);
    }
    return;
  }

  // Reply to latest
  if (sub === 'reply') {
    const msg = flags.msg || args[2];
    if (!msg) { console.error('Usage: ant chat reply <id> --msg "message"'); return; }
    const sender = resolveIdentity(isExternal);
    const result = await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: msg, format: 'text', sender_id: sender }, roomOpts(id));
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    console.log(`Replied: ${msg}`);
    return;
  }

  // Join real-time chat stream
  if (sub === 'join') {
    if (!id) { console.error('Usage: ant chat join <session-id>'); return; }

    // Per-room token wins over the master apiKey for both HTTP backfill and
    // the WS upgrade — same precedence as the request() helper. Without this,
    // remote ANTs (Funnel-only, no master key) get 401 on the join path even
    // though `ant chat send` works fine for them.
    const room = roomOpts(id);
    const roomToken = room?.roomToken;

    // Load recent history first
    const data = await api.get(ctx, `/api/sessions/${id}/messages?limit=10`, room);
    for (const m of (data.messages || [])) {
      const prefix = m.role === 'user' ? '\x1b[36mYou\x1b[0m' : '\x1b[33mANT\x1b[0m';
      console.log(`${prefix}: ${m.content}`);
    }

    console.log('\n--- Joined chat (streaming, Ctrl+C to exit) ---\n');

    // Receive live messages over Server-Sent Events.
    //
    // We deliberately avoid WebSockets here: bun's `node:http` shim has a
    // WS-upgrade bug that delivers the initial server-pushed frame
    // (`build_id`) but silently drops every subsequent broadcast — so under
    // the bun-installed `ant` CLI, `ant chat join` saw history and never the
    // live messages. The server already exposes `/mcp/room/:id/stream` as
    // SSE for the read-only web viewer; the broadcast loop registers the
    // SSE writer as a virtual WS client, so the same `message_created`
    // payloads arrive there. Plain HTTP/1.1 chunked streaming is robust
    // across both bun and node runtimes.
    //
    // SSE requires a per-room bearer token, so the streaming receiver only
    // works when one is available. Without one (master-apiKey path), we
    // skip live streaming and degrade to backfill-only.
    let abort: AbortController | null = null;
    if (roomToken) {
      abort = new AbortController();
      const streamUrl = `${ctx.serverUrl}/mcp/room/${encodeURIComponent(id)}/stream?token=${encodeURIComponent(roomToken)}`;
      (async () => {
        try {
          const res = await fetch(streamUrl, {
            headers: { Accept: 'text/event-stream' },
            signal: abort!.signal,
            // @ts-ignore — bun + node both honour this for self-signed local TLS.
            //              real Funnel cert paths ignore it.
            tls: { rejectUnauthorized: false },
          });
          if (!res.ok || !res.body) {
            console.error(`Stream failed: HTTP ${res.status}`);
            return;
          }
          const reader = res.body.getReader();
          const decoder = new TextDecoder();
          let buf = '';
          // The broadcast loop fans the same message_created event out via
          // both the primary delivery path and the message-router, so each id
          // arrives twice on the SSE stream. Dedup on the client.
          const seen = new Set<string>();
          while (true) {
            const { value, done } = await reader.read();
            if (done) break;
            buf += decoder.decode(value, { stream: true });
            // SSE frames are separated by a blank line; each frame is one or
            // more `field: value` lines. We only care about the `data:` field.
            let idx;
            while ((idx = buf.indexOf('\n\n')) >= 0) {
              const frame = buf.slice(0, idx);
              buf = buf.slice(idx + 2);
              const dataLines = frame.split('\n').filter((l) => l.startsWith('data: ')).map((l) => l.slice(6));
              if (!dataLines.length) continue;
              try {
                const msg = JSON.parse(dataLines.join('\n'));
                if (msg.type === 'message_created' && msg.sessionId === id) {
                  if (msg.id && seen.has(msg.id)) continue;
                  if (msg.id) seen.add(msg.id);
                  const prefix = msg.role === 'user' ? '\x1b[36mYou\x1b[0m' : '\x1b[33mANT\x1b[0m';
                  process.stdout.write(`\r\x1b[K${prefix}: ${msg.content}\n\x1b[36mYou\x1b[0m: `);
                }
              } catch {}
            }
          }
        } catch (e: any) {
          if (e?.name !== 'AbortError') console.error(`Stream error: ${e?.message ?? e}`);
        }
      })();
    } else {
      console.error('(no room token — running backfill-only; use `ant join-room` to enable live streaming)');
    }

    // Interactive input
    const joinSender = resolveIdentity(isExternal);
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '\x1b[36mYou\x1b[0m: ' });
    rl.prompt();
    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) { rl.prompt(); return; }
      try {
        await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: trimmed, format: 'text', sender_id: joinSender }, room);
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
      }
      rl.prompt();
    });
    rl.on('close', () => { abort?.abort(); process.exit(0); });
    process.on('SIGINT', () => { abort?.abort(); process.exit(0); });
    return;
  }

  // Interactive chat mode
  const data = await api.get(ctx, `/api/sessions/${id}/messages?limit=20`);
  const messages = data.messages || [];
  for (const m of messages) {
    const prefix = m.role === 'user' ? '\x1b[36mYou\x1b[0m' : '\x1b[33mANT\x1b[0m';
    console.log(`${prefix}: ${m.content}`);
  }

  console.log('\n--- Interactive chat (Ctrl+C to exit) ---\n');
  const interactiveSender = resolveIdentity(isExternal);
  const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '\x1b[36mYou\x1b[0m: ' });
  rl.prompt();
  rl.on('line', async (line) => {
    const trimmed = line.trim();
    if (!trimmed) { rl.prompt(); return; }
    try {
      await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: trimmed, format: 'text', sender_id: interactiveSender });
    } catch (e: any) {
      console.error(`Error: ${e.message}`);
    }
    rl.prompt();
  });
  rl.on('close', () => process.exit(0));
}
