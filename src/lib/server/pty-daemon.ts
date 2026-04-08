#!/usr/bin/env bun
// ANT PTY Daemon — hybrid control mode
//
// Two connections per session:
//   raw PTY  — tmux attach-session        — live I/O (unchanged)
//   ctrl PTY — tmux -C attach-session     — silence detection + state queries
//
// Scrollback is served via `tmux capture-pane` (tmux's own buffer, no accumulation,
// no alt-screen corruption, no 256KB limit).
//
// Unix socket: ~/.ant/pty.sock  |  Protocol: newline-delimited JSON

import * as net from 'net';
import * as pty from 'node-pty';
import { unlinkSync, existsSync, mkdirSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';

const ANT_DIR  = join(process.env.HOME || '/tmp', '.ant');
const SOCK_PATH = join(ANT_DIR, 'pty.sock');
const LOG = (...a: any[]) => console.log('[pty-daemon]', ...a);
const HOME = process.env.HOME || '/tmp';
const TMUX = '/opt/homebrew/bin/tmux';

// After this many ms of silence, fire a prompt-detection check.
// Must match the monitor-silence value set on each window (3s).
const SILENCE_DEDUP_MS = 15_000; // don't re-alert within this window

// ─── tmux helpers ────────────────────────────────────────────────────────────

function tmuxSessionExists(sessionId: string): boolean {
  try {
    execFileSync(TMUX, ['has-session', '-t', sessionId], { stdio: 'pipe' });
    return true;
  } catch { return false; }
}

// Full scrollback + current screen, ANSI-encoded — for xterm.js rendering on reconnect.
// `capture-pane -e` preserves colours; `-J` joins wrapped lines; `-S -N` includes N lines
// of history. tmux handles alt-screen correctly — no manual prefix injection needed.
function captureScrollback(sessionId: string): string {
  try {
    return execFileSync(TMUX, [
      'capture-pane', '-t', sessionId,
      '-p',           // print to stdout
      '-e',           // include ANSI escape sequences
      '-J',           // join wrapped lines (better for TUI apps)
      '-S', '-1000',  // last 1000 lines of history + current screen
    ], { stdio: 'pipe', maxBuffer: 20 * 1024 * 1024 }).toString();
  } catch { return ''; }
}

// Plain text — no ANSI codes. Used for prompt detection and memory palace ingestion.
function captureClean(sessionId: string, lines = 30): string {
  try {
    return execFileSync(TMUX, [
      'capture-pane', '-t', sessionId,
      '-p', '-J',
      '-S', `-${lines}`,
    ], { stdio: 'pipe' }).toString().trim();
  } catch { return ''; }
}

// Detect whether the tail of the pane output looks like a program waiting for input:
//   • ends with a question mark
//   • numbered list (1. Yes / 2. No style menus)
//   • y/n or Y/N prompt
//   • bullet / dash list followed by quiet cursor
function isWaitingForInput(text: string): boolean {
  const lines = text.split('\n').filter(l => l.trim());
  if (!lines.length) return false;
  const tail = lines.slice(-8).join('\n');
  return (
    /\?\s*$/.test(tail) ||                    // ends with ?
    /^\s*\d+[.)]\s+\w/m.test(tail) ||         // numbered list  (1. Yes)
    /\[?[yY]\/[nN]\]?/i.test(tail) ||         // [Y/n] style
    /^\s*[-•·]\s+\w/m.test(tail)              // bullet list
  );
}

// ─── Session state ────────────────────────────────────────────────────────────

interface PTYSession {
  pty:              pty.IPty;       // raw PTY — live I/O (input forwarding + output streaming)
  ctrl:             pty.IPty | null; // control mode PTY — silence detection
  alive:            boolean;
  lastSilenceAlert: number;         // epoch ms — dedup rapid silence fires
}

const sessions = new Map<string, PTYSession>();
const clients  = new Set<net.Socket>();

// ─── Control mode ─────────────────────────────────────────────────────────────

function spawnControlMode(sessionId: string, session: PTYSession): pty.IPty | null {
  try {
    const ctrl = pty.spawn(TMUX, ['-C', 'attach-session', '-t', sessionId], {
      name: 'dumb',
      cols: 220, rows: 50,
      cwd: HOME,
      env: { ...process.env } as Record<string, string>,
    });

    // Enable silence monitoring after the control mode handshake settles.
    // 3s of silence → %alert-silence fires → we capture + check for prompts.
    setTimeout(() => {
      try { ctrl.write('set-window-option monitor-silence 3\n'); } catch {}
    }, 800);

    let buf = '';
    ctrl.onData(data => {
      buf += data;
      const lines = buf.split('\n');
      buf = lines.pop()!;
      for (const line of lines) {
        if (!line.startsWith('%alert-silence')) continue;

        const now = Date.now();
        if (now - session.lastSilenceAlert < SILENCE_DEDUP_MS) continue;
        session.lastSilenceAlert = now;

        const text = captureClean(sessionId, 30);
        if (!text) continue;

        // Always broadcast the silence event — server decides what to do with it.
        // Include isPrompt flag so server can filter intelligently.
        broadcast({
          type: 'terminal_silence',
          sessionId,
          isPrompt: isWaitingForInput(text),
          text,
        });
      }
    });

    ctrl.onExit(() => LOG(`ctrl mode exited: ${sessionId}`));
    return ctrl;
  } catch (e) {
    LOG(`ctrl mode failed for ${sessionId}:`, e);
    return null;
  }
}

// ─── Unix socket server ───────────────────────────────────────────────────────

mkdirSync(ANT_DIR, { recursive: true });
if (existsSync(SOCK_PATH)) unlinkSync(SOCK_PATH);

const server = net.createServer((socket) => {
  clients.add(socket);
  LOG(`client connected (total: ${clients.size})`);

  let buf = '';
  socket.on('data', chunk => {
    buf += chunk.toString();
    const lines = buf.split('\n');
    buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try { handle(JSON.parse(line), socket); } catch {}
    }
  });

  socket.on('close', () => clients.delete(socket));
  socket.on('error', () => clients.delete(socket));
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

// ─── Message handler ──────────────────────────────────────────────────────────

function handle(msg: any, socket: net.Socket) {
  switch (msg.type) {

    case 'spawn': {
      const existing = sessions.get(msg.sessionId);
      if (existing?.alive) {
        // Reconnect path: serve scrollback from tmux's own buffer.
        // capture-pane handles alt-screen automatically — no prefix injection needed.
        const scrollback = captureScrollback(msg.sessionId);
        send(socket, { type: 'spawned', sessionId: msg.sessionId, callId: msg.callId, alive: true, scrollback });
        return;
      }

      const term = pty.spawn(TMUX, [
        'new-session', '-A',
        '-s', msg.sessionId,
        '-e', `ANT_SESSION_ID=${msg.sessionId}`,
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

      const session: PTYSession = { pty: term, ctrl: null, alive: true, lastSilenceAlert: 0 };
      sessions.set(msg.sessionId, session);

      term.onData((data: string) => {
        broadcast({ type: 'output', sessionId: msg.sessionId, data });
      });

      term.onExit(() => {
        session.alive = false;
        try { session.ctrl?.kill(); } catch {}
        broadcast({ type: 'exit', sessionId: msg.sessionId });
        LOG(`session exited: ${msg.sessionId}`);
      });

      // Start control mode once the raw PTY has settled and tmux session is ready.
      setTimeout(() => {
        if (session.alive) session.ctrl = spawnControlMode(msg.sessionId, session);
      }, 1200);

      LOG(`spawned session: ${msg.sessionId}`);
      // New session — no scrollback yet
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

    // Memory palace / clean text extraction.
    // Returns plain text (no ANSI) — ready for parsing, summarising, storing.
    case 'capture': {
      const text = captureClean(msg.sessionId, msg.lines || 50);
      send(socket, { type: 'captured', sessionId: msg.sessionId, callId: msg.callId, text });
      break;
    }

    case 'kill': {
      const s = sessions.get(msg.sessionId);
      if (s) {
        try { s.ctrl?.kill(); } catch {}
        try { s.pty.kill(); } catch {}
        s.alive = false;
        sessions.delete(msg.sessionId);
      }
      try { execFileSync(TMUX, ['kill-session', '-t', msg.sessionId], { stdio: 'pipe' }); } catch {}
      LOG(`killed session: ${msg.sessionId}`);
      break;
    }

    case 'list': {
      const alive = [...sessions.entries()]
        .filter(([id, s]) => s.alive || tmuxSessionExists(id))
        .map(([id]) => id);
      send(socket, { type: 'list', sessions: alive });
      break;
    }

    case 'ping':
      send(socket, { type: 'pong' });
      break;
  }
}

server.listen(SOCK_PATH, () => LOG(`listening at ${SOCK_PATH}`));

server.on('error', err => {
  console.error('[pty-daemon] fatal:', err);
  process.exit(1);
});

function shutdown() {
  LOG('shutting down');
  for (const [, s] of sessions) {
    try { s.ctrl?.kill(); } catch {}
    try { s.pty.kill(); } catch {}
  }
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 3000);
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
