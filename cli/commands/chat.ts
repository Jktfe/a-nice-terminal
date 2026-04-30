import { api } from '../lib/api.js';
import { config } from '../lib/config.js';
import { createInterface } from 'readline';
import WebSocket from 'ws';
import { execFileSync } from 'child_process';

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
    const msg = flags.msg || args[2];
    if (!msg) { console.error('Usage: ant chat send <id> --msg "message"'); return; }
    const sender = resolveIdentity(isExternal);
    const result = await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: msg, format: 'text', sender_id: sender }, roomOpts(id));
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

    // Load recent history first
    const data = await api.get(ctx, `/api/sessions/${id}/messages?limit=10`);
    for (const m of (data.messages || [])) {
      const prefix = m.role === 'user' ? '\x1b[36mYou\x1b[0m' : '\x1b[33mANT\x1b[0m';
      console.log(`${prefix}: ${m.content}`);
    }

    console.log('\n--- Joined chat (streaming, Ctrl+C to exit) ---\n');

    // Connect WebSocket — always prefer wss:// (http:// → wss:// since server is TLS-only)
    const wsUrl = ctx.serverUrl.replace('https://', 'wss://').replace('http://', 'wss://') + '/ws';
    const ws = new WebSocket(wsUrl, {
      headers: ctx.apiKey ? { 'Authorization': `Bearer ${ctx.apiKey}` } : {},
      rejectUnauthorized: false,
    });

    ws.on('open', () => {
      ws.send(JSON.stringify({ type: 'join_session', sessionId: id }));
      
      // Heartbeat for presence tracking
      const heartbeat = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: 'presence_ping' }));
        }
      }, 30000);
      
      ws.on('close', () => clearInterval(heartbeat));
    });

    ws.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString());
        if (msg.type === 'message_created' && msg.sessionId === id) {
          const prefix = msg.role === 'user' ? '\x1b[36mYou\x1b[0m' : '\x1b[33mANT\x1b[0m';
          console.log(`${prefix}: ${msg.content}`);
        } else if (msg.type === 'stream_chunk' && msg.sessionId === id) {
          process.stdout.write(msg.content || '');
        }
      } catch {}
    });

    // Interactive input
    const joinSender = resolveIdentity(isExternal);
    const rl = createInterface({ input: process.stdin, output: process.stdout, prompt: '\x1b[36mYou\x1b[0m: ' });
    rl.prompt();
    rl.on('line', async (line) => {
      const trimmed = line.trim();
      if (!trimmed) { rl.prompt(); return; }
      try {
        await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: trimmed, format: 'text', sender_id: joinSender });
      } catch (e: any) {
        console.error(`Error: ${e.message}`);
      }
      rl.prompt();
    });
    rl.on('close', () => { ws.close(); process.exit(0); });
    process.on('SIGINT', () => { ws.close(); process.exit(0); });
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
