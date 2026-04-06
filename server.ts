// ANT v3 — Custom Server with WebSocket support
// Uses Node's http server (SvelteKit adapter-node) + ws for WebSocket

import { config } from 'dotenv';
config(); // Load .env

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
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
          client.joinedSessions.add(msg.sessionId);
          // Update broadcast entry so this client receives targeted messages for this session
          broadcastEntry.sessionId = msg.sessionId;
          // Look up the session's @handle so target routing works
          const { queries: q2 } = await import('./src/lib/server/db.js');
          const sess = q2.getSession(msg.sessionId);
          broadcastEntry.handle = sess?.handle ?? null;
          // spawn is idempotent — reconnects to existing session and returns scrollback
          const result = await ptm.spawn(msg.sessionId, msg.cwd || process.env.HOME || '/tmp');
          ws.send(JSON.stringify({ type: 'session_health', sessionId: msg.sessionId, alive: result.alive }));
          if (result.scrollback) {
            ws.send(JSON.stringify({ type: 'terminal_output', sessionId: msg.sessionId, data: result.scrollback }));
          }
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

  // Throttle last_activity updates (1 write per session per 10s max)
  const activityThrottle = new Map<string, number>();

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
  });

  console.log('[server] connected to PTY daemon');
});

// Start capture pipeline
import('./src/lib/server/capture/claude-watcher.js')
  .then(mod => mod.startClaudeWatcher?.())
  .catch(() => console.log('[capture] Claude watcher not available'));

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
