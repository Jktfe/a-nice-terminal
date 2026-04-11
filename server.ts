// ANT v3 — Custom Server with WebSocket support
// Uses Node's http server (SvelteKit adapter-node) + ws for WebSocket

import { config } from 'dotenv';
config(); // Load .env

import { createServer } from 'http';
import { readFileSync, existsSync, mkdirSync, copyFileSync, chmodSync, appendFileSync } from 'fs';
import { join } from 'path';
import { createServer as createHttpsServer } from 'https';
import { handler } from './build/handler.js';
import { WebSocketServer } from 'ws';

// Connect to the persistent PTY daemon (survives server restarts)
let ptyManager: any;
async function getPtyManager() {
  if (!ptyManager) {
    const mod = await import('./src/lib/server/pty-client.js');
    ptyManager = mod.ptyClient;
    await ptyManager.ensureDaemon();
    ptyManager.connect();
  }
  return ptyManager;
}

// Unique ID for this server process — changes on every restart
const BUILD_ID = Date.now().toString(36);

const PORT = parseInt(process.env.PORT || process.env.ANT_PORT || '6458');
const HOST = process.env.HOST || process.env.ANT_HOST || '0.0.0.0';
const TLS_CERT = process.env.ANT_TLS_CERT;
const TLS_KEY = process.env.ANT_TLS_KEY;
const API_KEY = process.env.ANT_API_KEY;

// Create HTTP or HTTPS server
let server: ReturnType<typeof createServer>;
let protocol = 'http';

if (TLS_CERT && TLS_KEY && existsSync(TLS_CERT) && existsSync(TLS_KEY)) {
  const cert = readFileSync(TLS_CERT);
  const key = readFileSync(TLS_KEY);
  server = createHttpsServer({ cert, key }, handler);
  protocol = 'https';
  console.log(`[tls] Using cert: ${TLS_CERT}`);
} else {
  server = createServer(handler);
}

// WebSocket server in noServer mode so we can auth before upgrading
const wss = new WebSocketServer({ noServer: true });

interface WSClient { joinedSessions: Set<string> }
const clients = new Map<any, WSClient>();

// Shared broadcast registry — API routes use this to push events to WS clients
import('./src/lib/server/ws-broadcast.js').catch(() => {});

// Authenticate and upgrade WebSocket connections
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  if (API_KEY) {
    // Same-origin browser connections don't carry auth headers —
    // allow them through just like the HTTP hook does.
    const origin = req.headers['origin'] as string | undefined;
    const serverOrigin = origin ? `${protocol}://${req.headers['host']}` : null;
    const isSameOrigin = !origin || origin === serverOrigin;

    if (!isSameOrigin) {
      const url = new URL(req.url, `http://localhost`);
      const provided =
        url.searchParams.get('apiKey') ||
        (req.headers['x-api-key'] as string) ||
        (req.headers['authorization'] as string)?.replace('Bearer ', '');
      if (provided !== API_KEY) {
        socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
        socket.destroy();
        return;
      }
    }
  }

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', async (ws) => {
  const client: WSClient = { joinedSessions: new Set() };
  // Send build ID immediately — client reloads if its page was loaded from a different build
  ws.send(JSON.stringify({ type: 'build_id', buildId: BUILD_ID }));
  clients.set(ws, client);

  // Register in broadcast singleton so API routes can push events
  const { registerClient, deregisterClient, updateClientHandle } = await import('./src/lib/server/ws-broadcast.js');
  const clientKey = Symbol();
  // Will be updated when client joins a session
  const broadcastEntry = {
    sessionId: '',
    handle: null as string | null,
    send: (msg: string) => { try { ws.send(msg); } catch {} },
    get readyState() { return ws.readyState; },
  };
  registerClient(clientKey, broadcastEntry);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const ptm = await getPtyManager();

      switch (msg.type) {
        case 'join_session': {
          // Update broadcast entry so API-route pushes (tasks, messages) reach this client
          broadcastEntry.sessionId = msg.sessionId;
          const { queries: q2 } = await import('./src/lib/server/db.js');
          const sess = q2.getSession(msg.sessionId);
          broadcastEntry.handle = sess?.handle ?? null;

          // Only Terminal.svelte sends spawnPty:true — the page's own WS should NOT
          // trigger a spawn, because it doesn't know the actual terminal dimensions and
          // would start the PTY at the wrong size (default 120×30).
          // cols/rows come from fitAddon.fit(), which has run before connect() is called.
          console.log(`[ws] join_session ${msg.sessionId} spawnPty=${!!msg.spawnPty} cols=${msg.cols} rows=${msg.rows} type=${sess?.type}`);

          if (msg.spawnPty && sess?.type === 'terminal') {
            const cols = typeof msg.cols === 'number' ? msg.cols : 120;
            const rows = typeof msg.rows === 'number' ? msg.rows : 30;
            const result = await ptm.spawn(msg.sessionId, msg.cwd || process.env.HOME || '/tmp', cols, rows);
            console.log(`[ws] spawned ${msg.sessionId} alive=${result.alive} scrollback=${result.scrollback.length}b`);
            ws.send(JSON.stringify({ type: 'session_health', sessionId: msg.sessionId, alive: result.alive }));
            if (result.scrollback) {
              ws.send(JSON.stringify({ type: 'terminal_output', sessionId: msg.sessionId, data: result.scrollback }));
            }
            // Trigger a SIGWINCH after scrollback replay so TUI apps (Claude Code, vim,
            // htop, etc.) fully repaint their current screen state. Without this, a
            // session whose scrollback was trimmed mid-alt-screen renders blank because
            // the initial "enter alt-screen + paint" sequence was discarded. A resize
            // forces the process to redraw from scratch, exactly like tmux does on attach.
            if (result.alive) {
              setTimeout(() => {
                const c = typeof msg.cols === 'number' ? msg.cols : 120;
                const r = typeof msg.rows === 'number' ? msg.rows : 30;
                ptm.resize(msg.sessionId, c, r);
              }, 300);
            }
          }

          // Now start receiving live output (after scrollback has been queued for send)
          client.joinedSessions.add(msg.sessionId);
          break;
        }
        case 'leave_session':
          client.joinedSessions.delete(msg.sessionId);
          break;
        case 'terminal_input':
          ptm.write(msg.sessionId, msg.data);
          break;
        case 'terminal_resize':
          ptm.resize(msg.sessionId, msg.cols, msg.rows);
          break;
        case 'check_health':
          ws.send(JSON.stringify({ type: 'session_health', sessionId: msg.sessionId, alive: ptm.isAlive(msg.sessionId) }));
          break;
      }
    } catch (e) {
      console.error('[ws] Error:', e);
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    deregisterClient(clientKey);
  });
});

// Wire PTY output → WebSocket broadcast + touch last_activity
getPtyManager().then(async ptm => {
  // Rehydrate persistent sessions from DB
  const { rehydrateSessions, startTtlSweep } = await import('./src/lib/server/session-lifecycle.js');
  await rehydrateSessions(ptm);
  startTtlSweep(ptm);

  const { queries } = await import('./src/lib/server/db.js');
  const { default: stripAnsi } = await import('strip-ansi');

  // Throttle last_activity updates (1 write per session per 10s max)
  const activityThrottle = new Map<string, number>();

  // Buffer terminal output per session — flush to terminal_transcripts every ~10KB or 30s.
  // chunkCounters and byteOffsets are seeded from the DB on first flush per session per
  // process (see seedCountersIfNeeded) so a server restart can't reset chunk_index to 0
  // and collide with existing rows.
  const transcriptBufs  = new Map<string, string>();
  const transcriptFlush = new Map<string, ReturnType<typeof setTimeout>>();
  const chunkCounters   = new Map<string, number>();
  const byteOffsets     = new Map<string, number>();
  const seeded          = new Set<string>();

  function seedCountersIfNeeded(sessionId: string) {
    if (seeded.has(sessionId)) return;
    seeded.add(sessionId);
    try {
      const stats = queries.getTranscriptStats(sessionId);
      chunkCounters.set(sessionId, stats?.max_chunk ?? 0);
      byteOffsets.set(sessionId, stats?.total_bytes ?? 0);
    } catch {
      chunkCounters.set(sessionId, 0);
      byteOffsets.set(sessionId, 0);
    }
  }

  function flushTranscript(sessionId: string) {
    const buf = transcriptBufs.get(sessionId);
    if (!buf) return;
    transcriptBufs.delete(sessionId);
    seedCountersIfNeeded(sessionId);
    const idx = (chunkCounters.get(sessionId) ?? 0) + 1;
    const offset = byteOffsets.get(sessionId) ?? 0;
    chunkCounters.set(sessionId, idx);
    byteOffsets.set(sessionId, offset + buf.length);
    try {
      const stripped = stripAnsi(buf);
      queries.appendTranscriptWithText(sessionId, idx, buf, stripped, Date.now(), offset);
    } catch {}
  }

  ptm.onData((sessionId: string, data: string) => {
    const msg = JSON.stringify({ type: 'terminal_output', sessionId, data });
    for (const [ws, client] of clients) {
      if (client.joinedSessions.has(sessionId) && ws.readyState === 1) {
        try { ws.send(msg); } catch {}
      }
    }
    // Touch last_activity at most every 10s per session
    const now = Date.now();
    if ((now - (activityThrottle.get(sessionId) ?? 0)) > 10_000) {
      activityThrottle.set(sessionId, now);
      try { queries.touchActivity(sessionId); } catch {}
    }
    // Buffer raw output for transcript persistence
    transcriptBufs.set(sessionId, (transcriptBufs.get(sessionId) ?? '') + data);
    // Flush immediately if buffer exceeds 10KB
    if ((transcriptBufs.get(sessionId)?.length ?? 0) > 10_240) {
      clearTimeout(transcriptFlush.get(sessionId));
      transcriptFlush.delete(sessionId);
      flushTranscript(sessionId);
    } else if (!transcriptFlush.has(sessionId)) {
      // Flush after 30s of inactivity
      transcriptFlush.set(sessionId, setTimeout(() => {
        transcriptFlush.delete(sessionId);
        flushTranscript(sessionId);
      }, 30_000));
    }
  });

  // Forward terminal prompts to the session's linked chat.
  // Only fires when tmux detects 3s of silence AND the pane tail looks like a prompt.
  ptm.onSilence(async (sessionId: string, isPrompt: boolean, text: string) => {
    if (!isPrompt) return;
    const session = queries.getSession(sessionId);
    if (!session?.linked_chat_id) return;
    const { broadcast } = await import('./src/lib/server/ws-broadcast.js');
    const msgId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    const tail = text.slice(-600).trim();
    try {
      queries.createMessage(
        msgId, session.linked_chat_id,
        'assistant', tail,
        'text', 'complete',
        sessionId, null, 'prompt', '{}'
      );
      broadcast(session.linked_chat_id, {
        type: 'message_created',
        sessionId: session.linked_chat_id,
        id: msgId,
        role: 'assistant',
        content: tail,
        sender_id: sessionId,
        msg_type: 'prompt',
        created_at: new Date().toISOString(),
      });
    } catch (e) {
      console.error('[ws] Error forwarding terminal prompt to chat:', e);
    }
  });

  console.log('[server] connected to PTY daemon');
});

// Start capture pipeline
import('./src/lib/server/capture/claude-watcher.js')
  .then(mod => mod.startClaudeWatcher?.())
  .catch(() => console.log('[capture] Claude watcher not available'));

import('./src/lib/server/capture/capture-ingest.js')
  .then(mod => mod.startCaptureIngest?.())
  .catch(() => console.log('[capture] Capture ingest not available'));

// Auto-install ANT shell hooks into ~/.zshrc on first server start
(function autoInstallHooks() {
  const home = process.env.HOME || '/tmp';
  const zshrc = join(home, '.zshrc');
  if (existsSync(zshrc) && readFileSync(zshrc, 'utf8').includes('ant/hooks/ant.zsh')) return;
  const srcDir = join(process.cwd(), 'ant-capture');
  if (!existsSync(srcDir)) return;
  try {
    const hookDir = join(home, '.ant', 'hooks');
    mkdirSync(hookDir, { recursive: true });
    if (existsSync(join(srcDir, 'ant.zsh')))     copyFileSync(join(srcDir, 'ant.zsh'), join(hookDir, 'ant.zsh'));
    if (existsSync(join(srcDir, 'ant.bash')))    copyFileSync(join(srcDir, 'ant.bash'), join(hookDir, 'ant.bash'));
    if (existsSync(join(srcDir, 'ant-capture'))) { copyFileSync(join(srcDir, 'ant-capture'), join(hookDir, 'ant-capture')); chmodSync(join(hookDir, 'ant-capture'), 0o755); }
    appendFileSync(zshrc, '\n# ANT shell capture hooks\n[ -f "$HOME/.ant/hooks/ant.zsh" ] && source "$HOME/.ant/hooks/ant.zsh"\n');
    console.log('[hooks] Auto-installed ANT shell hooks into ~/.zshrc — restart your shell or run: source ~/.zshrc');
  } catch (e) {
    console.warn('[hooks] Could not auto-install hooks:', e);
  }
})();

server.listen(PORT, HOST, () => {
  console.log(`\n  ANT v3 running at ${protocol}://${HOST}:${PORT}\n`);
});

// Graceful shutdown
async function shutdown(signal: string) {
  console.log(`[server] ${signal} — shutting down (PTY daemon stays alive)`);
  const ptm = await getPtyManager();
  ptm.killAll(); // just disconnects from daemon, does not kill sessions
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
