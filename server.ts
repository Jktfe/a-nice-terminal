// ANT v3 — Custom Server with WebSocket support
// Uses Node's http server (SvelteKit adapter-node) + ws for WebSocket

import { config } from 'dotenv';
config(); // Load .env

// adapter-node enforces this before SvelteKit route handlers run.
process.env.BODY_SIZE_LIMIT ||= '10M';

import { createServer, type IncomingMessage, type ServerResponse } from 'http';
import {
  appendFileSync,
  chmodSync,
  copyFileSync,
  cpSync,
  createReadStream,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'fs';
import { extname, join, resolve } from 'path';
import { createServer as createHttpsServer } from 'https';
import { pathToFileURL } from 'url';
import { WebSocketServer } from 'ws';

const BUILD_DIR = resolve(process.cwd(), 'build');
const SNAPSHOT_ROOT = resolve(process.cwd(), '.ant-runtime', 'build-snapshots');
const ACTIVE_SNAPSHOT_FILE = resolve(SNAPSHOT_ROOT, '.active');
const MAX_BUILD_SNAPSHOTS = 5;

async function importValidatedSnapshot(snapshotDir: string) {
  const manifestUrl = `${pathToFileURL(join(snapshotDir, 'server', 'manifest.js')).href}?ts=${Date.now()}`;
  const handlerUrl = `${pathToFileURL(join(snapshotDir, 'handler.js')).href}?ts=${Date.now()}`;

  const manifestModule = await import(manifestUrl);
  const manifest = manifestModule.manifest;

  // Validate the snapshot before serving it. The adapter rewrites hashed SSR
  // chunks during each build, so a restart that points at a half-written build
  // can pass startup and then explode with 500s on the first request.
  await Promise.all((manifest?._?.nodes ?? []).map((load: () => Promise<unknown>) => load()));
  await Promise.all(
    (manifest?._?.routes ?? [])
      .filter((route: { endpoint?: null | (() => Promise<unknown>) }) => typeof route.endpoint === 'function')
      .map((route: { endpoint: () => Promise<unknown> }) => route.endpoint())
  );

  const handlerModule = await import(handlerUrl);
  return { handler: handlerModule.handler as typeof import('./build/handler.js').handler };
}

function copyBuildSnapshot() {
  if (!existsSync(join(BUILD_DIR, 'handler.js'))) {
    throw new Error(`No build output found at ${BUILD_DIR}`);
  }

  mkdirSync(SNAPSHOT_ROOT, { recursive: true });
  const snapshotId = `${Date.now().toString(36)}-${process.pid}`;
  const snapshotDir = resolve(SNAPSHOT_ROOT, snapshotId);
  cpSync(BUILD_DIR, snapshotDir, { recursive: true });
  return { snapshotDir, snapshotId };
}

function readActiveSnapshot() {
  if (!existsSync(ACTIVE_SNAPSHOT_FILE)) return null;

  try {
    const snapshotDir = readFileSync(ACTIVE_SNAPSHOT_FILE, 'utf8').trim();
    if (!snapshotDir || !existsSync(snapshotDir)) return null;
    return {
      snapshotDir,
      snapshotId: snapshotDir.split('/').pop() || 'unknown',
    };
  } catch {
    return null;
  }
}

function rememberActiveSnapshot(snapshotDir: string) {
  mkdirSync(SNAPSHOT_ROOT, { recursive: true });
  writeFileSync(ACTIVE_SNAPSHOT_FILE, snapshotDir, 'utf8');
}

function cleanupOldSnapshots(activeSnapshotDir: string) {
  const entries = readdirSync(SNAPSHOT_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => resolve(SNAPSHOT_ROOT, entry.name))
    .sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs);

  for (const staleDir of entries.slice(MAX_BUILD_SNAPSHOTS)) {
    if (staleDir === activeSnapshotDir) continue;
    rmSync(staleDir, { recursive: true, force: true });
  }
}

async function loadBuildSnapshot() {
  const candidate = copyBuildSnapshot();

  try {
    const loaded = await importValidatedSnapshot(candidate.snapshotDir);
    rememberActiveSnapshot(candidate.snapshotDir);
    cleanupOldSnapshots(candidate.snapshotDir);
    return {
      ...loaded,
      snapshotDir: candidate.snapshotDir,
      snapshotId: candidate.snapshotId,
    };
  } catch (error) {
    console.warn(`[build] Snapshot ${candidate.snapshotId} is incomplete; falling back to last good build`, error);
    rmSync(candidate.snapshotDir, { recursive: true, force: true });
  }

  const fallback = readActiveSnapshot();
  if (fallback) {
    const loaded = await importValidatedSnapshot(fallback.snapshotDir);
    return {
      ...loaded,
      snapshotDir: fallback.snapshotDir,
      snapshotId: fallback.snapshotId,
    };
  }

  throw new Error('Could not load a valid server build snapshot');
}

const {
  handler,
  snapshotDir: ACTIVE_BUILD_DIR,
  snapshotId: BUILD_ID,
} = await loadBuildSnapshot();
console.log(`[build] Serving snapshot ${BUILD_ID} from ${ACTIVE_BUILD_DIR}`);

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

const PORT = parseInt(process.env.PORT || process.env.ANT_PORT || '6458');
const HOST = process.env.HOST || process.env.ANT_HOST || '0.0.0.0';
const TLS_CERT = process.env.ANT_TLS_CERT;
const TLS_KEY = process.env.ANT_TLS_KEY;
const API_KEY = process.env.ANT_API_KEY;
const CLIENT_ASSET_ROOT = resolve(ACTIVE_BUILD_DIR, 'client');

function assetContentType(pathname: string): string {
  const ext = extname(pathname).toLowerCase();
  switch (ext) {
    case '.js':
    case '.mjs':
      return 'text/javascript; charset=utf-8';
    case '.css':
      return 'text/css; charset=utf-8';
    case '.json':
      return 'application/json; charset=utf-8';
    case '.svg':
      return 'image/svg+xml';
    case '.png':
      return 'image/png';
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.webp':
      return 'image/webp';
    case '.ico':
      return 'image/x-icon';
    case '.txt':
      return 'text/plain; charset=utf-8';
    case '.woff':
      return 'font/woff';
    case '.woff2':
      return 'font/woff2';
    default:
      return 'application/octet-stream';
  }
}

function sendStaticFile(
  req: IncomingMessage,
  res: ServerResponse,
  filePath: string,
  headers: Record<string, string | number>
) {
  const stream = createReadStream(filePath);
  let opened = false;

  stream.on('open', () => {
    opened = true;
    res.writeHead(200, headers);
    if (req.method === 'HEAD') {
      res.end();
      stream.destroy();
      return;
    }
    stream.pipe(res);
  });

  stream.on('error', (error: NodeJS.ErrnoException) => {
    console.warn(`[assets] stream error for ${filePath}: ${error.code || error.message}`);
    if (!opened && !res.headersSent) {
      res.writeHead(error.code === 'ENOENT' ? 404 : 500, { 'Cache-Control': 'no-store' });
      res.end();
      return;
    }
    res.destroy(error);
  });
}

function tryServeClientAsset(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url || !['GET', 'HEAD'].includes(req.method || 'GET')) return false;

  let pathname: string;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    return false;
  }

  if (!pathname.startsWith('/_app/')) return false;

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Ignore malformed escape sequences and use the raw path.
  }

  const assetPath = resolve(CLIENT_ASSET_ROOT, `.${decoded}`);
  const assetRootPrefix = `${CLIENT_ASSET_ROOT}/`;
  if (assetPath !== CLIENT_ASSET_ROOT && !assetPath.startsWith(assetRootPrefix)) {
    res.writeHead(400, { 'Cache-Control': 'no-store' });
    res.end('Bad Request');
    return true;
  }

  const encodings = String(req.headers['accept-encoding'] || '');
  const variants: Array<{ path: string; encoding?: 'br' | 'gzip' }> = [];
  if (!decoded.endsWith('.br') && /\bbr\b/i.test(encodings)) {
    variants.push({ path: `${assetPath}.br`, encoding: 'br' });
  }
  if (!decoded.endsWith('.gz') && /\bgzip\b/i.test(encodings)) {
    variants.push({ path: `${assetPath}.gz`, encoding: 'gzip' });
  }
  variants.push({ path: assetPath });

  for (const variant of variants) {
    if (!existsSync(variant.path)) continue;
    const stats = statSync(variant.path);
    if (!stats.isFile()) continue;

    const headers: Record<string, string | number> = {
      'Content-Type': assetContentType(decoded),
      'Content-Length': stats.size,
      'Last-Modified': stats.mtime.toUTCString(),
      'Cache-Control': decoded.startsWith('/_app/immutable/')
        ? 'public,max-age=31536000,immutable'
        : 'public,max-age=0,must-revalidate',
      'Vary': 'Accept-Encoding',
    };
    if (variant.encoding) headers['Content-Encoding'] = variant.encoding;

    sendStaticFile(req, res, variant.path, headers);
    return true;
  }

  console.warn(`[assets] missing client asset: ${decoded}`);
  res.writeHead(404, { 'Cache-Control': 'no-store' });
  res.end('Not Found');
  return true;
}

function tryServeUpload(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url?.startsWith('/uploads/')) return false;
  const decoded = decodeURIComponent(req.url);
  const filePath = join(process.cwd(), 'static', decoded);
  if (!existsSync(filePath)) {
    res.writeHead(404);
    res.end('Not Found');
    return true;
  }
  const ext = filePath.split('.').pop()?.toLowerCase() || '';
  const mimeMap: Record<string, string> = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml' };
  const mime = mimeMap[ext] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': mime, 'Cache-Control': 'public, max-age=31536000, immutable' });
  createReadStream(filePath).pipe(res);
  return true;
}

function requestHandler(req: IncomingMessage, res: ServerResponse) {
  if (tryServeClientAsset(req, res)) return;
  if (tryServeUpload(req, res)) return;
  handler(req, res);
}

// Create HTTP or HTTPS server
let server: ReturnType<typeof createServer>;
let protocol = 'http';

if (TLS_CERT && TLS_KEY && existsSync(TLS_CERT) && existsSync(TLS_KEY)) {
  const cert = readFileSync(TLS_CERT);
  const key = readFileSync(TLS_KEY);
  server = createHttpsServer({ cert, key }, requestHandler);
  protocol = 'https';
  console.log(`[tls] Using cert: ${TLS_CERT}`);
} else {
  server = createServer(requestHandler);
}

// WebSocket server in noServer mode so we can auth before upgrading
const wss = new WebSocketServer({ noServer: true });

interface WSClient { joinedSessions: Set<string> }
const clients = new Map<any, WSClient>();

// Shared broadcast registry — API routes use this to push events to WS clients
import('./src/lib/server/ws-broadcast.js').catch(() => {});
import('./src/lib/server/router-init.js').then((m) => { m.initRouter(); }).catch((e) => console.error('[message-router] init failed:', e));

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
  const {
    registerClient,
    deregisterClient,
    joinClientSession,
    leaveClientSession,
    updateClientPresence,
  } = await import('./src/lib/server/ws-broadcast.js');
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
        case 'presence_ping': {
          updateClientPresence(clientKey);
          break;
        }
        case 'join_session': {
          // Update broadcast entry so API-route pushes (tasks, messages) reach this client
          const { queries: q2 } = await import('./src/lib/server/db.js');
          const sess = q2.getSession(msg.sessionId);
          const handle = sess?.handle ?? null;
          broadcastEntry.sessionId = msg.sessionId;
          broadcastEntry.handle = handle;
          joinClientSession(clientKey, msg.sessionId, handle);

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
          leaveClientSession(clientKey, msg.sessionId);
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
        case 'check_chrome': {
          const { isChrome } = await import('./src/lib/server/agent-event-bus.js');
          const result = isChrome(msg.sessionId, msg.line);
          ptm.writeRaw(JSON.stringify({ type: 'is_chrome_result', sessionId: msg.sessionId, line: msg.line, isChrome: result }) + '\n');
          break;
        }
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
  // Expose ptm.write on globalThis so API routes can use the SAME daemon connection
  // that the WS terminal_input handler uses — this is the path that WORKS.
  (globalThis as any).__antPtmWrite = (sessionId: string, data: string) => ptm.write(sessionId, data);

  // Rehydrate persistent sessions from DB
  const { rehydrateSessions, startTtlSweep } = await import('./src/lib/server/session-lifecycle.js');
  await rehydrateSessions(ptm);
  startTtlSweep(ptm);

  const { queries } = await import('./src/lib/server/db.js');
  const { default: stripAnsi } = await import('strip-ansi');

  // Throttle last_activity updates (1 write per session per 10s max)
  const activityThrottle = new Map<string, number>();

  // Track when each session last went silent (for idle-attention badges).
  // Declared here so the onData handler (which clears silence on output)
  // and the onSilence handler (which sets it) share the same Map.
  const silenceStart = new Map<string, number>();

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
    // Terminal output is also buffered per session for transcripts
    seedCountersIfNeeded(sessionId);
    const chunkIdx = (chunkCounters.get(sessionId) ?? 0) + 1;

    const msg = JSON.stringify({ type: 'terminal_output', sessionId, data, seq: chunkIdx });
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
    // Clear silence tracking — terminal produced output, so it's not idle
    silenceStart.delete(sessionId);
    // Agent event bus — fed from ptm.onLine() (debounced, ANSI-stripped text)
    // instead of raw PTY data. Raw bytes contain cursor-movement sequences
    // that, when stripped, concatenate words ("Doyouwanttoproceed?").
  });

  // Persist tmux control-mode structured events — the "what happened in this
  // terminal" timeline that sits alongside the raw transcript. Cheap writes;
  // only whitelisted kinds reach us thanks to pty-daemon's PERSIST_KINDS.
  ptm.onEvent((event: { sessionId: string; ts: number; kind: string; data: Record<string, unknown> }) => {
    try {
      queries.appendTerminalEvent(event.sessionId, event.ts, event.kind, JSON.stringify(event.data ?? {}));
    } catch {}
  });

  // ─── Terminal output → linked chat (the "chat IS the terminal" path) ──────
  //
  // Settled text from tmux control mode (%output, debounced via capture-pane
  // diff in the daemon). NOT posted to the chat — the chat is a curated
  // interaction surface (agent events + user messages only). Terminal output
  // lives in the "Terminal" text view (terminal_transcripts table).
  //
  // This handler feeds the agent event bus for interactive event detection.
  // When the bus detects a permission prompt / question / etc., IT posts the
  // agent_event message to the chat — that's the only path terminal content
  // reaches the chat.
  ptm.onLine(async (sessionId: string, text: string) => {
    // Feed to agent event bus for interactive event detection
    import('./src/lib/server/agent-event-bus.js')
      .then(({ feed }) => feed(sessionId, text))
      .catch(() => {});
  });

  // ─── Legacy terminal-state signals (silence + title polling) ────────────
  //
  // These predate the control-mode terminal_line path above. Both are now
  // disabled for sessions WITH a linked chat — terminal output flows via the
  // terminal_line path, so silence/title signals are redundant noise there.
  //
  //   1. `terminal_silence` — disabled for all sessions (see onSilence below).
  //      Sessions with a linked chat use terminal_line; unlinked sessions have
  //      no chat target. Handler registered as a no-op hook for future use.
  //
  //   2. pane_title polling (every 2s) — runs for UNLINKED sessions only.
  //      Tracks OSC 0/1/2 title changes in lastTitleBySession; no broadcast
  //      target for unlinked sessions, so changes are just recorded locally.
  //
  // `postToLinkedChat` is still used by the terminal_line path (onLine above)
  // and the agent event bus — kept here for those callers.

  const { broadcast } = await import('./src/lib/server/ws-broadcast.js');

  async function postToLinkedChat(
    sessionId: string,
    chatId: string,
    content: string,
    msgType: string,
  ) {
    const msgId = Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
    try {
      queries.createMessage(
        msgId, chatId,
        'assistant', content,
        'text', 'complete',
        sessionId, null, null, msgType, '{}'
      );
      broadcast(chatId, {
        type: 'message_created',
        sessionId: chatId,
        id: msgId,
        role: 'assistant',
        content,
        sender_id: sessionId,
        reply_to: null,
        msg_type: msgType,
        created_at: new Date().toISOString(),
      });
      if (msgType === 'agent_event') {
        try {
          const { trackEvent } = await import('./src/lib/server/agent-event-bus.js');
          trackEvent(sessionId, msgId, chatId, JSON.parse(content));
        } catch (e) {
          console.error('[linkedchat] track agent_event failed:', e);
        }
      }
    } catch (e) {
      console.error(`[linkedchat] forward ${msgType} failed:`, e);
    }
  }

  // Initialize agent event bus with server dependencies
  const { broadcastGlobal } = await import('./src/lib/server/ws-broadcast.js');
  import('./src/lib/server/agent-event-bus.js').then(({ init }) => {
    init({
      getSession: queries.getSession,
      postToChat: postToLinkedChat,
      writeToTerminal: (sid: string, data: string) => ptm.write(sid, data),
      updateMessageMeta: queries.updateMessageMeta,
      broadcastToChat: broadcast,
      broadcastGlobal,
    });
  }).catch(() => {});

  // Signal 1: silence → idle-attention badges.
  // When a terminal goes quiet for >30s with no pending agent event, we
  // broadcast a gentle "idle attention" indicator to the dashboard.
  ptm.onSilence(async (sessionId: string, _isPrompt: boolean, _text: string) => {
    const now = Date.now();
    if (!silenceStart.has(sessionId)) {
      silenceStart.set(sessionId, now);
    }
    const elapsed = now - (silenceStart.get(sessionId) ?? now);
    // If silent >30s AND the agent-event-bus has NO active event, broadcast idle attention
    if (elapsed > 30_000) {
      try {
        const { getPendingEvent } = await import('./src/lib/server/agent-event-bus.js');
        const pending = getPendingEvent(sessionId);
        if (!pending.needs_input) {
          broadcastGlobal({ type: 'session_idle_attention', sessionId });
        }
      } catch {}
    }
  });

  // Silence tracking is cleared from within the existing ptm.onData handler
  // (see silenceStart.delete call in the onData callback above).

  // Signal 2: pane_title polling — 2s interval, unlinked sessions only.
  // ─── Title poller ────────────────────────────────────────────────────────
  //
  // Sessions WITH a linked_chat_id are excluded: they receive terminal output
  // directly via the terminal_line path (ptm.onLine above), so title polling
  // is redundant noise for them.
  //
  // For sessions WITHOUT a linked chat the poller tracks title changes in
  // lastTitleBySession. This keeps the mechanism alive for future use (e.g.
  // surfacing title changes in the session list) without spamming any chat.
  //
  const lastTitleBySession = new Map<string, string>();

  // Strip ALL leading glyphs for comparison — braille + status indicators.
  // This prevents ✳↔⠂ oscillation from counting as a semantic change.
  function normalizeTitleForCompare(raw: string): string {
    return raw
      .replace(/^[\u2800-\u28FF✳◇◆▪✻●○✦✢⏺]+\s*/u, '')
      .trim();
  }

  const hostnameRaw = (process.env.HOSTNAME || '').trim();
  function isDefaultTitle(t: string): boolean {
    if (!t) return true;
    if (t === hostnameRaw) return true;
    if (hostnameRaw && (t === `${hostnameRaw}.local` || `${t}.local` === hostnameRaw)) return true;
    if (/^\S+@\S+:/.test(t)) return true;
    return false;
  }

  setInterval(async () => {
    let rows: any[] = [];
    try {
      rows = queries.getUnlinkedTerminalSessions() as any[];
    } catch { return; }
    for (const row of rows) {
      const sid: string = row.id;

      let title = '';
      try { title = await ptm.title(sid); } catch { continue; }
      if (!title) continue;

      // Raw-equality check first (cheapest)
      const prev = lastTitleBySession.get(sid) ?? '';
      if (title === prev) continue;
      lastTitleBySession.set(sid, title);

      // Semantic-equality check (strips ALL glyphs including ✳/◇)
      const normNew = normalizeTitleForCompare(title);
      const normPrev = normalizeTitleForCompare(prev);
      if (normNew === normPrev) continue;
      if (isDefaultTitle(normNew)) continue;

      // Title changed — tracked in lastTitleBySession for status/health use.
      // No linked chat means no broadcast target; nothing more to do here.
    }
  }, 2000);

  console.log('[server] connected to PTY daemon — silence hook + title poller active');
});

// Start capture pipeline
import('./src/lib/server/capture/claude-watcher.js')
  .then(mod => mod.startClaudeWatcher?.())
  .catch(() => console.log('[capture] Claude watcher not available'));

import('./src/lib/server/capture/capture-ingest.js')
  .then(mod => mod.startCaptureIngest?.())
  .catch(() => console.log('[capture] Capture ingest not available'));

// Refresh ANT hook-dir contents on every server start, and patch ~/.zshrc
// on first install. Helper scripts (ant-capture, ant-silence-notify) are
// always re-copied so they track the repo copy — they're referenced by
// tmux hooks + the pty-daemon and must exist on disk regardless of whether
// the one-time .zshrc patch has already been applied.
(function autoInstallHooks() {
  const home = process.env.HOME || '/tmp';
  const srcDir = join(process.cwd(), 'ant-capture');
  if (!existsSync(srcDir)) return;
  const hookDir = join(home, '.ant', 'hooks');

  try {
    mkdirSync(hookDir, { recursive: true });
    const helpers: Array<{ file: string; exec: boolean }> = [
      { file: 'ant.zsh',            exec: false },
      { file: 'ant.bash',           exec: false },
      { file: 'ant-capture',        exec: true  },
      { file: 'ant-silence-notify', exec: true  },  // called by tmux alert-silence hook
    ];
    for (const { file, exec } of helpers) {
      const srcPath = join(srcDir, file);
      if (!existsSync(srcPath)) continue;
      copyFileSync(srcPath, join(hookDir, file));
      if (exec) chmodSync(join(hookDir, file), 0o755);
    }
  } catch (e) {
    console.warn('[hooks] Could not refresh hook dir:', e);
    return;
  }

  const zshrc = join(home, '.zshrc');
  try {
    if (!existsSync(zshrc) || readFileSync(zshrc, 'utf8').includes('ant/hooks/ant.zsh')) return;
    appendFileSync(zshrc, '\n# ANT shell capture hooks\n[ -f "$HOME/.ant/hooks/ant.zsh" ] && source "$HOME/.ant/hooks/ant.zsh"\n');
    console.log('[hooks] Patched ~/.zshrc to source ANT capture hooks — run: source ~/.zshrc');
  } catch (e) {
    console.warn('[hooks] Could not patch ~/.zshrc:', e);
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
