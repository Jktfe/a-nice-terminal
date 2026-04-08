#!/usr/bin/env bun
// ANT PTY Daemon — runs independently of the web server
// Unix socket: ~/.ant/pty.sock
// Protocol: newline-delimited JSON
//
// Starts automatically when the server starts (detached child).
// Survives server restarts — PTY sessions stay alive.

import * as net from 'net';
import * as pty from 'node-pty';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execSync } from 'child_process';

const ANT_DIR = join(process.env.HOME || '/tmp', '.ant');
const SOCK_PATH = join(ANT_DIR, 'pty.sock');
const SCROLLBACK_LIMIT = 256 * 1024;
const LOG = (...a: any[]) => console.log('[pty-daemon]', ...a);
const HOME = process.env.HOME || '/tmp';
const TMUX = '/opt/homebrew/bin/tmux';

// ANT session IDs use only alphanumeric + hyphens — safe to pass as tmux session name.
// Uses execFileSync (not exec) to avoid shell injection.
function tmuxSessionExists(sessionId: string): boolean {
  try {
    execSync(`${TMUX} has-session -t ${sessionId} 2>/dev/null`, { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

mkdirSync(ANT_DIR, { recursive: true });
if (existsSync(SOCK_PATH)) unlinkSync(SOCK_PATH);

interface PTYSession {
  pty: pty.IPty;
  scrollback: string;
  alive: boolean;
}

const sessions = new Map<string, PTYSession>();
const clients = new Set<net.Socket>();

const server = net.createServer((socket) => {
  clients.add(socket);
  LOG(`client connected (total: ${clients.size})`);

  let buf = '';
  socket.on('data', (chunk) => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try { handle(JSON.parse(line), socket); } catch {}
    }
  });

  socket.on('close', () => { clients.delete(socket); });
  socket.on('error', () => { clients.delete(socket); });
});

function send(socket: net.Socket, msg: any) {
  try { socket.write(JSON.stringify(msg) + '\n'); } catch {}
}

function broadcast(msg: any) {
  const line = JSON.stringify(msg) + '\n';
  for (const c of clients) {
    try { c.write(line); } catch {}
  }
}

function handle(msg: any, socket: net.Socket) {
  switch (msg.type) {
    case 'spawn': {
      const existing = sessions.get(msg.sessionId);
      if (existing?.alive) {
        send(socket, { type: 'spawned', sessionId: msg.sessionId, callId: msg.callId, alive: true, scrollback: existing.scrollback });
        return;
      }
      // Use tmux new-session -A: creates if new, attaches if existing (survives server restarts)
      const term = pty.spawn(TMUX, [
        'new-session', '-A',
        '-s', msg.sessionId,
        '-x', String(msg.cols || 220),
        '-y', String(msg.rows || 50),
      ], {
        name: 'xterm-256color',
        cols: msg.cols || 220,
        rows: msg.rows || 50,
        cwd: msg.cwd || HOME,
        env: {
          ...process.env,
          ANT_SESSION_ID: msg.sessionId,
          ANT_CAPTURE_DEPTH: '0',
          TERM: 'xterm-256color',
        } as Record<string, string>,
      });
      const session: PTYSession = { pty: term, scrollback: '', alive: true };
      sessions.set(msg.sessionId, session);

      term.onData((data: string) => {
        session.scrollback += data;
        if (session.scrollback.length > SCROLLBACK_LIMIT) {
          session.scrollback = session.scrollback.slice(-SCROLLBACK_LIMIT);
        }
        broadcast({ type: 'output', sessionId: msg.sessionId, data });
      });

      term.onExit(() => {
        session.alive = false;
        broadcast({ type: 'exit', sessionId: msg.sessionId });
        LOG(`session exited: ${msg.sessionId}`);
      });

      LOG(`spawned session: ${msg.sessionId}`);
      send(socket, { type: 'spawned', sessionId: msg.sessionId, callId: msg.callId, alive: true, scrollback: '' });
      break;
    }
    case 'write': {
      const s = sessions.get(msg.sessionId);
      if (s?.alive) s.pty.write(msg.data);
      break;
    }
    case 'resize': {
      const s = sessions.get(msg.sessionId);
      if (s?.alive) s.pty.resize(msg.cols, msg.rows);
      break;
    }
    case 'kill': {
      const s = sessions.get(msg.sessionId);
      if (s) { try { s.pty.kill(); } catch {} s.alive = false; sessions.delete(msg.sessionId); }
      // Also kill the tmux session if it still exists
      try { execSync(`${TMUX} kill-session -t ${msg.sessionId} 2>/dev/null`, { stdio: 'pipe' }); } catch {}
      LOG(`killed session: ${msg.sessionId}`);
      break;
    }
    case 'list': {
      // Include in-memory alive sessions plus any tmux sessions not yet in memory
      const alive = [...sessions.entries()]
        .filter(([id, s]) => s.alive || tmuxSessionExists(id))
        .map(([id]) => id);
      send(socket, { type: 'list', sessions: alive });
      break;
    }
    case 'ping': {
      send(socket, { type: 'pong' });
      break;
    }
  }
}

server.listen(SOCK_PATH, () => {
  LOG(`listening at ${SOCK_PATH}`);
});

server.on('error', (err) => {
  console.error('[pty-daemon] fatal:', err);
  process.exit(1);
});

// Graceful shutdown
function shutdown() {
  LOG('shutting down, killing all sessions');
  for (const [, s] of sessions) {
    try { s.pty.kill(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
