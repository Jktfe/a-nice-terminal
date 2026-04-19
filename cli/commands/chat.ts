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

export async function chat(args: string[], flags: any, ctx: any) {
  const sub = args[0];
  const id = sub === 'send' || sub === 'read' || sub === 'reply' || sub === 'join' ? args[1] : sub;
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
    const result = await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: msg, format: 'text', sender_id: sender });
    if (ctx.json) { console.log(JSON.stringify(result)); return; }
    console.log(`Sent: ${msg}`);
    return;
  }

  // Read chat history
  if (sub === 'read') {
    const limit = flags.limit || 50;
    const data = await api.get(ctx, `/api/sessions/${id}/messages?limit=${limit}`);
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
    const result = await api.post(ctx, `/api/sessions/${id}/messages`, { role: 'user', content: msg, format: 'text', sender_id: sender });
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
