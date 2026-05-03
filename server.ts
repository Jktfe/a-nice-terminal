// ANT v3 — Custom Server with WebSocket support
// Uses Node's http server (SvelteKit adapter-node) + ws for WebSocket

import { config } from 'dotenv';
config(); // Load .env

// adapter-node enforces this before SvelteKit route handlers run.
process.env.BODY_SIZE_LIMIT ||= '10M';

// SvelteKit adapter-node's get_origin() defaults the protocol to "https" when
// PROTOCOL_HEADER is unset. On a plain-HTTP deployment that means
// event.url.origin = "https://host:port" while the browser sends
// "Origin: http://host:port" — the same-origin check in hooks.server.ts then
// fails and any browser-driven /api/* write returns 401. Auto-deriving
// ORIGIN from ANT_SERVER_URL avoids the foot-gun for HTTP-only deployments.
if (!process.env.ORIGIN && process.env.ANT_SERVER_URL) {
  process.env.ORIGIN = process.env.ANT_SERVER_URL;
}

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

const UPLOADS_ROOT = resolve(process.cwd(), 'static', 'uploads');
const UPLOADS_ROOT_PREFIX = `${UPLOADS_ROOT}/`;

function tryServeUpload(req: IncomingMessage, res: ServerResponse): boolean {
  if (!req.url?.startsWith('/uploads/')) return false;

  let pathname: string;
  try {
    pathname = new URL(req.url, 'http://localhost').pathname;
  } catch {
    res.writeHead(400);
    res.end('Bad Request');
    return true;
  }

  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    // Malformed escape — fall back to raw pathname.
  }

  // Reject null bytes or any literal traversal segment after decoding.
  if (decoded.includes('\0') || decoded.split('/').some((seg) => seg === '..')) {
    res.writeHead(400);
    res.end('Bad Request');
    return true;
  }

  // Resolve under uploads root and enforce containment — pre-auth route, so
  // a missing check here lets any unauthenticated client read arbitrary files.
  const rel = decoded.replace(/^\/uploads\/?/, '');
  const filePath = resolve(UPLOADS_ROOT, rel);
  if (filePath !== UPLOADS_ROOT && !filePath.startsWith(UPLOADS_ROOT_PREFIX)) {
    res.writeHead(400);
    res.end('Bad Request');
    return true;
  }

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

// Track sessions where CLI auto-detection has already fired (set once per session)
const autoDetectedSessions = new Set<string>();

// Shared broadcast registry — API routes use this to push events to WS clients
import('./src/lib/server/ws-broadcast.js').catch(() => {});
import('./src/lib/server/router-init.js').then((m) => { m.initRouter(); }).catch((e) => console.error('[message-router] init failed:', e));

// Room-token resolver — used at WS upgrade to scope clients to one room.
// Top-level await so the resolver is ready before the first connection.
const { extractTokenFromHeaders, resolveToken } = await import('./src/lib/server/room-invites.js');

// Authenticate and upgrade WebSocket connections
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  const upgradeUrl = new URL(req.url, `http://localhost`);

  // Room-token-scoped clients (Sec-WebSocket-Protocol: ant.token.<plaintext>
  // or ?token=<plaintext>). When a valid token is presented, we pin the WS
  // to the token's room and drop any out-of-room frames in the connection
  // handler below. An invalid token → 401 even if API_KEY would have passed.
  let roomScope: { roomId: string; kind: string; handle: string | null; tokenId: string } | null = null;
  const tokenPlain = extractTokenFromHeaders(req.headers as Record<string, string | undefined>, upgradeUrl);
  if (tokenPlain) {
    const resolved = resolveToken(tokenPlain);
    if (!resolved) {
      socket.write('HTTP/1.1 401 Unauthorized\r\n\r\n');
      socket.destroy();
      return;
    }
    roomScope = {
      roomId: resolved.token.room_id,
      kind: resolved.token.kind,
      handle: resolved.token.handle,
      tokenId: resolved.token.id,
    };
  }

  if (API_KEY && !roomScope) {
    // Same-origin browser connections don't carry auth headers —
    // allow them through just like the HTTP hook does.
    const origin = req.headers['origin'] as string | undefined;
    const serverOrigin = origin ? `${protocol}://${req.headers['host']}` : null;
    const isSameOrigin = !origin || origin === serverOrigin;

    if (!isSameOrigin) {
      const provided =
        upgradeUrl.searchParams.get('apiKey') ||
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
    if (roomScope) (req as any).__antRoomScope = roomScope;
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', async (ws, req) => {
  const client: WSClient = { joinedSessions: new Set() };
  // If the upgrade attached a room scope (via valid invite token), this WS
  // is restricted to that one room — see roomScope check inside the message
  // dispatch below. Same-origin browser clients have no scope and retain
  // their pre-existing dashboard-wide reach.
  const roomScope = (req as any)?.__antRoomScope as
    | { roomId: string; kind: string; handle: string | null; tokenId: string }
    | undefined;
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

      // Token-scoped clients can only act on their granted room. We let
      // presence_ping through (it's session-less) and reject everything else
      // whose sessionId targets a different room. Sending an explicit error
      // frame back lets the CLI surface what went wrong instead of guessing.
      if (roomScope && msg.type !== 'presence_ping') {
        if (typeof msg.sessionId === 'string' && msg.sessionId !== roomScope.roomId) {
          ws.send(JSON.stringify({
            type: 'error',
            error: 'token_room_mismatch',
            scope: roomScope.roomId,
            requested: msg.sessionId,
            message: 'this token is scoped to a different room',
          }));
          return;
        }
      }

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

          const canSpawnTerminal =
            sess?.type === 'terminal' &&
            !(sess as any).deleted_at &&
            !(sess as any).archived;

          if (msg.spawnPty && canSpawnTerminal) {
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
          } else if (msg.spawnPty && sess?.type === 'terminal') {
            console.warn(`[ws] refusing to spawn inactive terminal ${msg.sessionId} archived=${!!(sess as any).archived} deleted=${!!(sess as any).deleted_at}`);
            ws.send(JSON.stringify({
              type: 'session_health',
              sessionId: msg.sessionId,
              alive: false,
              unavailable: true,
            }));
          }

          // Now start receiving live output (after scrollback has been queued for send)
          client.joinedSessions.add(msg.sessionId);

          // Push current status so the freshly-connected client doesn't have to
          // wait for the next refresh tick or status change to know what state
          // this agent is in. No-op if no status has ever been computed.
          try {
            const { getAgentStatus } = await import('./src/lib/server/agent-event-bus.js');
            const current = getAgentStatus(msg.sessionId);
            if (current) {
              ws.send(JSON.stringify({
                type: 'agent_status_updated',
                sessionId: msg.sessionId,
                status: current,
              }));
            }
          } catch {}
          break;
        }
        case 'leave_session':
          client.joinedSessions.delete(msg.sessionId);
          leaveClientSession(clientKey, msg.sessionId);
          break;
        case 'terminal_input':
          {
            const { queries: q2 } = await import('./src/lib/server/db.js');
            const inputSession = q2.getSession(msg.sessionId) as any;
            if (
              !inputSession ||
              inputSession.type !== 'terminal' ||
              inputSession.deleted_at ||
              inputSession.archived
            ) {
              console.warn(`[ws] refusing terminal_input for inactive terminal ${msg.sessionId}`);
              break;
            }
            ptm.write(msg.sessionId, msg.data);
            // Auto-detect CLI from first terminal input (set once, overrideable)
            if (msg.data && !autoDetectedSessions.has(msg.sessionId)) {
              const input = msg.data.toLowerCase();
              const CLI_DETECT: [RegExp, string][] = [
                [/\bclaude\b/, 'claude-code'],
                [/\bcodex\b/, 'codex-cli'],
                [/\bgemini\b/, 'gemini-cli'],
                [/\bcopilot\b/, 'copilot-cli'],
                [/\bqwen\b/, 'qwen-cli'],
                [/\bhermes\s+acp\b/, 'hermes-acp'],
                [/\bpi\b(?:\s+--|$)/, 'pi'],
                [/\baider\b/, 'lm-studio'],
                [/\bperspective\b/, 'perspective'],
                [/\bollama\b/, 'ollama'],
              ];
              for (const [re, slug] of CLI_DETECT) {
                if (re.test(input)) {
                  autoDetectedSessions.add(msg.sessionId);
                  // Only set if session doesn't already have a cli_flag
                  const sess = inputSession;
                  if (sess && !sess.cli_flag) {
                    // Set cli_flag directly via DB + PTY daemon (same as the REST endpoint)
                    q2.setCliFlag(msg.sessionId, slug);
                    const meta = JSON.parse((sess.meta as string) || '{}');
                    meta.agent_driver = slug;
                    q2.updateSession(null, null, null, JSON.stringify(meta), msg.sessionId);
                    import('./src/lib/cli-modes.js').then(({ getCliMode }) => {
                      const mode = getCliMode(slug);
                      ptm.setCliFlag(msg.sessionId, slug, mode?.stripLines ?? 0);
                    }).catch(() => {});
                    broadcast(msg.sessionId, { type: 'cli_flag_updated', sessionId: msg.sessionId, cli_flag: slug });
                    console.log(`[auto-detect] ${msg.sessionId} → ${slug}`);
                  }
                  break;
                }
              }
            }
          }
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

// Wire PTY output → WebSocket broadcast, transcript persistence, and terminal-visible activity.
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
  const { PiRpcStreamAdapter } = await import('./src/lib/server/pi-rpc/projection.js');
  const { AcpStreamAdapter } = await import('./src/lib/server/acp/projection.js');

  // Throttle last_activity updates (1 write per session per 10s max)
  const activityThrottle = new Map<string, number>();
  let broadcastGlobalForActivity: ((msg: object) => void) | null = null;

  // Track when each session last went silent (for idle-attention badges).
  // Declared here so the terminal_line handler (which clears silence on visible
  // output) and the onSilence handler (which sets it) share the same Map.
  const silenceStart = new Map<string, number>();
  const piRpcAdapters = new Map<string, InstanceType<typeof PiRpcStreamAdapter>>();
  const piRpcSessionCache = new Map<string, { checkedAt: number; isPi: boolean }>();
  const acpAdapters = new Map<string, InstanceType<typeof AcpStreamAdapter>>();
  const acpSessionCache = new Map<string, { checkedAt: number; isAcp: boolean }>();

  function isPiSession(sessionId: string): boolean {
    const now = Date.now();
    const cached = piRpcSessionCache.get(sessionId);
    if (cached && now - cached.checkedAt < 1000) return cached.isPi;
    let isPi = false;
    try {
      const session = queries.getSession(sessionId) as any;
      let meta: any = {};
      try { meta = typeof session?.meta === 'string' ? JSON.parse(session.meta) : (session?.meta ?? {}); } catch {}
      const slug = session?.cli_flag || meta.agent_driver;
      isPi = slug === 'pi' || slug === 'pi-coding-agent';
    } catch {}
    piRpcSessionCache.set(sessionId, { checkedAt: now, isPi });
    return isPi;
  }

  function ingestPiRpcOutput(sessionId: string, data: string): void {
    if (!isPiSession(sessionId)) return;
    let adapter = piRpcAdapters.get(sessionId);
    if (!adapter) {
      adapter = new PiRpcStreamAdapter({ baseTsMs: Date.now() });
      piRpcAdapters.set(sessionId, adapter);
    }
    const events = adapter.feedStdout(data);
    for (const event of events) {
      appendRunEvent(
        sessionId,
        'rpc',
        'high',
        event.kind,
        event.text,
        {
          ...event.payload,
          payload_hash: event.payload_hash,
          transcript_sha256_so_far: adapter.transcriptSha256(),
        },
        event.raw_ref,
      );
    }
  }

  function isHermesAcpSession(sessionId: string): boolean {
    const now = Date.now();
    const cached = acpSessionCache.get(sessionId);
    if (cached && now - cached.checkedAt < 1000) return cached.isAcp;
    let isAcp = false;
    try {
      const session = queries.getSession(sessionId) as any;
      let meta: any = {};
      try { meta = typeof session?.meta === 'string' ? JSON.parse(session.meta) : (session?.meta ?? {}); } catch {}
      const slug = session?.cli_flag || meta.agent_driver;
      isAcp = slug === 'hermes-acp';
    } catch {}
    acpSessionCache.set(sessionId, { checkedAt: now, isAcp });
    return isAcp;
  }

  function ingestAcpOutput(sessionId: string, data: string): void {
    if (!isHermesAcpSession(sessionId)) return;
    let adapter = acpAdapters.get(sessionId);
    if (!adapter) {
      adapter = new AcpStreamAdapter({ baseTsMs: Date.now() });
      acpAdapters.set(sessionId, adapter);
    }
    const events = adapter.feedStdout(data);
    for (const event of events) {
      appendRunEvent(
        sessionId,
        'acp',
        'high',
        event.kind,
        event.text,
        {
          ...event.payload,
          payload_hash: event.payload_hash,
          transcript_sha256_so_far: adapter.transcriptSha256(),
        },
        event.raw_ref,
      );
    }
  }

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
    // Buffer raw output for transcript persistence
    transcriptBufs.set(sessionId, (transcriptBufs.get(sessionId) ?? '') + data);
    ingestPiRpcOutput(sessionId, data);
    ingestAcpOutput(sessionId, data);
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
      appendRunEvent(
        event.sessionId,
        'tmux',
        'raw',
        'system',
        tmuxEventText(event.kind, event.data ?? {}),
        { tmux_kind: event.kind, ...(event.data ?? {}) },
        null,
      );
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
    const now = Date.now();
    // Touch last_activity from terminal-visible output only. Raw PTY bytes can
    // contain redraw/chrome noise; this path is the cleaned ANT terminal stream.
    if ((now - (activityThrottle.get(sessionId) ?? 0)) > 10_000) {
      activityThrottle.set(sessionId, now);
      try { queries.touchActivity(sessionId); } catch {}
      broadcastGlobalForActivity?.({
        type: 'session_activity',
        sessionId,
        last_activity: new Date(now).toISOString(),
        activity_source: 'terminal_line',
      });
    }
    // Clear silence tracking from visible terminal output, not raw PTY noise.
    silenceStart.delete(sessionId);
    appendRunEvent(
      sessionId,
      'terminal',
      'medium',
      kindFromTerminalText(text),
      text,
      { source_event: 'terminal_line' },
      null,
    );
    // Feed to agent event bus for interactive event detection
    import('./src/lib/server/agent-event-bus.js')
      .then(({ feed, markTerminalActivity }) => {
        markTerminalActivity(sessionId, now);
        return feed(sessionId, text);
      })
      .catch(() => {});
    import('./src/lib/server/prompt-bridge.js')
      .then(({ feedPromptBridge }) => feedPromptBridge(sessionId, text))
      .catch(() => {});
  });

  // Unstripped bottom-of-pane samples from control mode. These include the CLI
  // footer/status line that the chat-output path intentionally strips away.
  ptm.onStatusSample(async (sessionId: string, text: string) => {
    import('./src/lib/server/agent-event-bus.js')
      .then(({ feedStatus }) => feedStatus(sessionId, text))
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

  type RunEventSource = 'acp' | 'hook' | 'json' | 'rpc' | 'terminal' | 'status' | 'tmux';
  type RunEventTrust = 'high' | 'medium' | 'raw';

  function normalizeRunEvent(row: any) {
    if (!row) return null;
    let payload: unknown = {};
    try { payload = typeof row.payload === 'string' ? JSON.parse(row.payload) : (row.payload ?? {}); }
    catch { payload = {}; }
    return {
      id: row.id,
      session_id: row.session_id,
      ts: row.ts_ms,
      ts_ms: row.ts_ms,
      source: row.source,
      trust: row.trust,
      kind: row.kind,
      text: row.text ?? '',
      payload,
      raw_ref: row.raw_ref ?? null,
      created_at: row.created_at,
    };
  }

  function appendRunEvent(
    sessionId: string,
    source: RunEventSource,
    trust: RunEventTrust,
    kind: string,
    text: string,
    payload: Record<string, unknown> = {},
    rawRef: string | null = null,
  ) {
    const cleanText = text.trim();
    if (!cleanText && Object.keys(payload).length === 0) return null;
    try {
      const row = queries.appendRunEvent(
        sessionId,
        Date.now(),
        source,
        trust,
        kind,
        cleanText.slice(0, 12_000),
        JSON.stringify(payload),
        rawRef,
      );
      const event = normalizeRunEvent(row);
      if (event) {
        broadcast(sessionId, { type: 'run_event_created', sessionId, event });
      }
      return event;
    } catch {
      return null;
    }
  }

  function kindFromTerminalText(text: string): string {
    if (/\b(error|failed|exception|traceback|fatal|denied)\b/i.test(text)) return 'error';
    if (/\b(reading|searching|running|writing|edited|added|created|updated|deleted|test|build)\b/i.test(text)) return 'progress';
    return 'message';
  }

  function kindFromAgentEvent(event: any): string {
    const eventClass = String(event?.class ?? event?.type ?? '');
    if (eventClass === 'permission_request' || eventClass === 'tool_auth') return 'permission';
    if (eventClass === 'free_text' || eventClass === 'multi_choice' || eventClass === 'confirmation') return 'question';
    if (eventClass === 'error_retry') return 'error';
    if (eventClass === 'progress' || eventClass === 'thinking') return 'progress';
    return 'message';
  }

  function textFromAgentEvent(event: any): string {
    return String(
      event?.text ??
      event?.payload?.message ??
      event?.payload?.question ??
      event?.payload?.prompt ??
      event?.payload?.status ??
      event?.class ??
      event?.type ??
      'Agent event',
    );
  }

  function tmuxEventText(kind: string, data: Record<string, unknown>): string {
    if (kind === 'alert-silence') return 'Terminal went quiet';
    if (kind === 'ctrl-exit') return 'tmux control connection exited';
    const name = typeof data.name === 'string' ? `: ${data.name}` : '';
    const raw = typeof data.raw === 'string' ? ` ${data.raw}` : '';
    return `tmux ${kind}${name}${raw}`.trim();
  }

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
          const event = JSON.parse(content);
          appendRunEvent(
            sessionId,
            'terminal',
            'medium',
            kindFromAgentEvent(event),
            textFromAgentEvent(event),
            { event, chat_id: chatId, message_id: msgId },
            null,
          );
          const { trackEvent } = await import('./src/lib/server/agent-event-bus.js');
          trackEvent(sessionId, msgId, chatId, event);
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
  broadcastGlobalForActivity = broadcastGlobal;
  import('./src/lib/server/agent-event-bus.js').then(({ init }) => {
    init({
      getSession: queries.getSession,
      postToChat: postToLinkedChat,
      writeToTerminal: (sid: string, data: string) => ptm.write(sid, data),
      updateMessageMeta: queries.updateMessageMeta,
      broadcastToChat: broadcast,
      broadcastGlobal,
      appendRunEvent,
    });
  }).catch(() => {});
  import('./src/lib/server/prompt-bridge.js').then(({ initPromptBridge }) => {
    initPromptBridge({
      getSession: queries.getSession,
      postToChat: postToLinkedChat,
      writeToTerminal: (sid: string, data: string) => ptm.write(sid, data),
      broadcastGlobal,
      appendRunEvent,
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

  // Silence tracking is cleared from the terminal_line handler above, so raw
  // PTY redraw noise does not mask an idle terminal.

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

  // ─── Watchdog: resource monitor + stall detection ──────────────────────────
  import('./src/lib/server/watchdog.js').then(({ startWatchdog }) => {
    startWatchdog({
      getActiveSessions: () => {
        try {
          return (queries.listTerminalSessions() as any[])
            .filter((s: any) => !s.deleted_at)
            .map((s: any) => s.id);
        } catch { return []; }
      },
      getLastActivity: (sessionId: string) => {
        try {
          const session = queries.getSession(sessionId) as any;
          if (!session?.last_activity) return null;
          return new Date(session.last_activity).getTime();
        } catch { return null; }
      },
      broadcastGlobal,
    });
  }).catch((e) => console.warn('[watchdog] init failed:', e));

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
