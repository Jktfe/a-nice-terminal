// ANT v3 — Custom Server with WebSocket support
// Uses Node's http server (SvelteKit adapter-node) + ws for WebSocket

import { config } from 'dotenv';
config(); // Load .env

import { createServer } from 'http';
import { readFileSync, existsSync } from 'fs';
import { createServer as createHttpsServer } from 'https';
import { handler } from './build/handler.js';
import { WebSocketServer } from 'ws';

// Lazy-load PTY manager
let ptyManager: any;
async function getPtyManager() {
  if (!ptyManager) {
    const mod = await import('./src/lib/server/pty-manager.js');
    ptyManager = mod.ptyManager;
  }
  return ptyManager;
}

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

// Authenticate and upgrade WebSocket connections
server.on('upgrade', (req, socket, head) => {
  if (!req.url?.startsWith('/ws')) {
    socket.destroy();
    return;
  }

  if (API_KEY) {
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

  wss.handleUpgrade(req, socket, head, (ws) => {
    wss.emit('connection', ws, req);
  });
});

wss.on('connection', (ws) => {
  const client: WSClient = { joinedSessions: new Set() };
  clients.set(ws, client);

  ws.on('message', async (raw) => {
    try {
      const msg = JSON.parse(raw.toString());
      const ptm = await getPtyManager();

      switch (msg.type) {
        case 'join_session':
          client.joinedSessions.add(msg.sessionId);
          if (!ptm.isAlive(msg.sessionId)) {
            ptm.spawn(msg.sessionId, msg.cwd || process.env.HOME || '/tmp');
          }
          ws.send(JSON.stringify({ type: 'session_health', sessionId: msg.sessionId, alive: ptm.isAlive(msg.sessionId) }));
          break;
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

  ws.on('close', async () => {
    // Snapshot joined sessions before removing from map
    const joined = new Set(client.joinedSessions);
    clients.delete(ws);

    // Kill any PTY session that now has no remaining subscribers
    const ptm = await getPtyManager();
    for (const sessionId of joined) {
      const hasSubscribers = [...clients.values()].some(c => c.joinedSessions.has(sessionId));
      if (!hasSubscribers && ptm.isAlive(sessionId)) {
        ptm.kill(sessionId);
        console.log(`[ws] PTY killed for session ${sessionId} — no remaining viewers`);
      }
    }
  });
});

// Wire PTY output → WebSocket broadcast
getPtyManager().then(ptm => {
  ptm.onData((sessionId: string, data: string) => {
    const msg = JSON.stringify({ type: 'terminal_output', sessionId, data });
    for (const [ws, client] of clients) {
      if (client.joinedSessions.has(sessionId) && ws.readyState === 1) {
        try { ws.send(msg); } catch {}
      }
    }
  });
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
  console.log(`[server] ${signal} — shutting down`);
  const ptm = await getPtyManager();
  ptm.killAll();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 5000);
}
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
