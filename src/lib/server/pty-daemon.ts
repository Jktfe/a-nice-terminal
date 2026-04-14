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
const SILENCE_HOOK_SCRIPT = join(HOME, '.ant', 'hooks', 'ant-silence-notify');

// After this many ms of silence, fire a prompt-detection check.
// Must match the monitor-silence value set on each window (3s).
const SILENCE_DEDUP_MS = 15_000; // don't re-alert within this window

// Module-level broadcast dedup for silence events. Both paths that produce a
// `terminal_silence` broadcast (control-mode's %alert-silence parser AND the
// new `silence` IPC called by the tmux set-hook helper) consult this map so
// only one broadcast fires per session per SILENCE_DEDUP_MS window.
const lastSilenceBroadcast = new Map<string, number>();

// ─── %output debounce → terminal_line broadcast ──────────────────────────────
// tmux control mode emits %output for every byte of terminal content. During
// streaming/spinners this can be hundreds/sec. We debounce per-session with a
// 100ms window, collapsing bursts to the final settled text before broadcasting.
// Live WS viewers still get the raw PTY stream via the existing onData path;
// this debounced path feeds the CHAT pane (text rendering, not xterm.js).

const OUTPUT_DEBOUNCE_MS = 100;  // idle timeout — fire after 100ms of silence
const OUTPUT_MAX_WAIT_MS = 2000; // ceiling — fire at most every 2s during continuous output

const lastCapture = new Map<string, string>();

interface OutputTimer {
  timer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  firstTs: number;
}
const outputTimers = new Map<string, OutputTimer>();

// Pending chrome-check requests — keyed by "sessionId:line"
const chromeChecks = new Map<string, (isChrome: boolean) => void>();

async function flushViaCapture(sessionId: string, ot: OutputTimer): Promise<void> {
  if (ot.timer) { clearTimeout(ot.timer); ot.timer = null; }
  if (ot.maxTimer) { clearTimeout(ot.maxTimer); ot.maxTimer = null; }
  ot.firstTs = 0;

  // Capture the current rendered screen (plain text, no ANSI)
  const screen = captureClean(sessionId, 50);
  if (!screen) return;

  const prev = lastCapture.get(sessionId) ?? '';
  lastCapture.set(sessionId, screen);

  if (!prev) return; // First capture — establish baseline, don't broadcast

  const prevLines = prev.split('\n');
  const newLines = screen.split('\n');

  // Find how many trailing lines match (common suffix)
  let common = 0;
  while (
    common < prevLines.length &&
    common < newLines.length &&
    prevLines[prevLines.length - 1 - common] === newLines[newLines.length - 1 - common]
  ) {
    common++;
  }

  if (common === prevLines.length && common === newLines.length) return;

  const rawFresh = newLines.slice(0, newLines.length - common)
    .map(l => l.trimEnd())
    .filter(l => l.length > 0);

  if (rawFresh.length === 0) return;

  // Filter out UI chrome. We ask the main server (which has the drivers loaded)
  // for fine-grained filtering via the 'is_chrome' IPC.
  const filteredLines: string[] = [];
  for (const line of rawFresh) {
    // 1. Fast path: generic chrome patterns (work for Claude Code, Gemini, etc.)
    if (/^─{10,}$/.test(line)) continue;
    if (/^❯\s*$/.test(line)) continue;
    if (/^[✽✳✻✶✢·★⏺⠂⠐⠈]+(\s|$)/.test(line)) continue;
    if (/^⏵⏵/.test(line)) continue;
    if (/shift\+tab|esc to interrupt|for shortcuts/.test(line)) continue;
    if (/^\s*[\u2800-\u28FF]+\s*$/.test(line)) continue;
    if (/^[/\\|_`~\-.\s()*@^×]+$/.test(line)) continue;
    if (/tokens?\)|thought for \d/.test(line)) continue;
    if (/^\s*[✔◼]\s+Task \d+/.test(line)) continue;

    // 2. Slow path: driver-specific classification (requires IPC roundtrip)
    const isChrome = await checkChrome(sessionId, line);
    if (!isChrome) filteredLines.push(line);
  }

  const text = filteredLines.join('\n').trim();
  if (!text) return;

  broadcast({
    type: 'terminal_line',
    sessionId,
    text,
    ts: Date.now(),
  });
}

/** IPC to main server: is this line UI chrome for the current session's driver? */
function checkChrome(sessionId: string, line: string): Promise<boolean> {
  const key = `${sessionId}:${line}`;
  return new Promise((resolve) => {
    chromeChecks.set(key, resolve);
    broadcast({ type: 'check_chrome', sessionId, line });
    // Timeout — if server doesn't respond, assume it's NOT chrome (safe fallback)
    setTimeout(() => {
      if (chromeChecks.has(key)) {
        chromeChecks.delete(key);
        resolve(false);
      }
    }, 150);
  });
}

/** Called on every %output line. We don't process the content — just use it
 *  as a signal that something changed, then debounce a capture-pane call. */
function handleOutputLine(sessionId: string, _rawContent: string): void {
  let ot = outputTimers.get(sessionId);
  if (!ot) {
    ot = { timer: null, maxTimer: null, firstTs: 0 };
    outputTimers.set(sessionId, ot);
  }

  if (!ot.firstTs) ot.firstTs = Date.now();

  // Restart idle debounce (trailing edge — fires 100ms after last output)
  if (ot.timer) clearTimeout(ot.timer);
  ot.timer = setTimeout(() => flushViaCapture(sessionId, ot!), OUTPUT_DEBOUNCE_MS);

  // Max-wait ceiling — fire at most every 500ms during continuous streaming
  if (!ot.maxTimer) {
    ot.maxTimer = setTimeout(() => flushViaCapture(sessionId, ot!), OUTPUT_MAX_WAIT_MS);
  }
}

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
//
// tmux -C emits notifications as lines starting with `%`. We listen for:
//
//   %alert-silence                           — already used for prompt detection
//   %window-add @<id>                        — new window in our session
//   %window-close @<id>
//   %window-renamed @<id> <name>
//   %session-changed $<id> <name>            — tmux switched our active session
//   %session-renamed <name>
//   %sessions-changed
//   %layout-change @<id> <layout-string>     — split/resize/close pane
//   %pane-mode-changed %<id>                 — entered/left copy mode etc.
//   %continue %<id>                          — pane unpaused (mapped to activity)
//   %pause %<id>                             — pane paused
//   %exit [reason]                           — tmux session exited
//
// Everything else is dropped for now. When a message we care about arrives, we
// broadcast a `terminal_event` line on the unix socket; the server writes it
// to the `terminal_events` table, giving agents + the librarian a structured
// timeline to read alongside the raw transcript.

// Match one `%word` notification prefix, capture the kind and the rest.
const NOTIFY_RE = /^%(\S+)(?:\s+(.*))?$/;

// Whitelist of notification kinds we persist. Anything outside this set is
// ignored so we don't flood the DB with %begin/%end/%output chatter.
const PERSIST_KINDS = new Set<string>([
  'window-add',
  'window-close',
  'window-renamed',
  'session-changed',
  'session-renamed',
  'sessions-changed',
  'layout-change',
  'pane-mode-changed',
  'continue',
  'pause',
  'exit',
  'unlinked-window-add',
  'unlinked-window-close',
  'unlinked-window-renamed',
  'client-session-changed',
  'client-detached',
]);

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
        handleControlLine(line, sessionId, session);
      }
    });

    ctrl.onExit(() => {
      LOG(`ctrl mode exited: ${sessionId}`);
      // Record the ctrl-mode exit as a session event so downstream readers
      // know the structured timeline stopped here.
      broadcast({
        type: 'terminal_event',
        sessionId,
        ts: Date.now(),
        kind: 'ctrl-exit',
        data: {},
      });
    });
    return ctrl;
  } catch (e) {
    LOG(`ctrl mode failed for ${sessionId}:`, e);
    return null;
  }
}

function handleControlLine(line: string, sessionId: string, session: PTYSession): void {
  if (!line || line[0] !== '%') return;

  // tmux control mode lines end with \r\n; split('\n') leaves trailing \r
  // which breaks NOTIFY_RE's $ anchor (JS dot doesn't match \r).
  const match = line.trimEnd().match(NOTIFY_RE);
  if (!match) return;
  const kind = match[1];
  const rest = match[2] ?? '';

  // %output — terminal content. Feed into the debounce buffer which collapses
  // streaming/spinner bursts to settled text, then broadcasts as terminal_line.
  // This is the data source for the chat-as-terminal rendering path.
  if (kind === 'output') {
    // Format: %output %<pane-id> <content>
    // Strip the pane-id prefix to get the raw content
    const contentStart = rest.indexOf(' ');
    const content = contentStart >= 0 ? rest.slice(contentStart + 1) : rest;
    handleOutputLine(sessionId, content);
    return;
  }

  // Special case: silence alert still drives prompt detection and broadcasts
  // its own `terminal_silence` message for backwards compat. Also persisted
  // as a terminal_event so idle-tick can see it without subscribing to two
  // channels. The broadcast itself is debounced via the shared
  // `lastSilenceBroadcast` map so the parallel set-hook path (see the
  // `silence` IPC case below) and this control-mode path don't double-post.
  if (kind === 'alert-silence') {
    const now = Date.now();
    broadcast({
      type: 'terminal_event',
      sessionId,
      ts: now,
      kind: 'alert-silence',
      data: {},
    });
    session.lastSilenceAlert = now;
    if (now - (lastSilenceBroadcast.get(sessionId) ?? 0) < SILENCE_DEDUP_MS) return;
    lastSilenceBroadcast.set(sessionId, now);
    const text = captureClean(sessionId, 30);
    if (!text) return;
    broadcast({
      type: 'terminal_silence',
      sessionId,
      isPrompt: isWaitingForInput(text),
      text,
    });
    return;
  }

  // Everything else: persist only the whitelisted structured events. Keep
  // the raw tail in `data.raw` for forensics, plus a light-touch structured
  // parse for the common shapes.
  if (!PERSIST_KINDS.has(kind)) return;

  broadcast({
    type: 'terminal_event',
    sessionId,
    ts: Date.now(),
    kind,
    data: parseEventData(kind, rest),
  });
}

// Best-effort structured parsing of the argument string. Falls back to
// `{raw: rest}` for anything we don't recognise. The goal is to make common
// queries cheap (e.g. "list all window-renamed events") without pretending to
// be a full tmux protocol parser.
function parseEventData(kind: string, rest: string): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!rest) return out;
  out.raw = rest;

  switch (kind) {
    case 'window-add':
    case 'window-close':
    case 'unlinked-window-add':
    case 'unlinked-window-close': {
      // `@<window-id>`
      const m = rest.match(/^@(\d+)/);
      if (m) out.window_id = parseInt(m[1], 10);
      break;
    }
    case 'window-renamed':
    case 'unlinked-window-renamed': {
      // `@<window-id> <name>`
      const m = rest.match(/^@(\d+)\s+(.*)$/);
      if (m) {
        out.window_id = parseInt(m[1], 10);
        out.name = m[2];
      }
      break;
    }
    case 'session-changed':
    case 'client-session-changed': {
      // `$<session-id> <name>` or `<client> $<session-id> <name>`
      const m = rest.match(/\$(\d+)\s+(.*)$/);
      if (m) {
        out.session_tmux_id = parseInt(m[1], 10);
        out.name = m[2];
      }
      break;
    }
    case 'session-renamed': {
      out.name = rest;
      break;
    }
    case 'layout-change': {
      // `@<window-id> <layout> [visible-layout] [flags]`
      const m = rest.match(/^@(\d+)\s+(\S+)/);
      if (m) {
        out.window_id = parseInt(m[1], 10);
        out.layout = m[2];
      }
      break;
    }
    case 'pane-mode-changed':
    case 'continue':
    case 'pause': {
      // `%<pane-id>`
      const m = rest.match(/^%(\d+)/);
      if (m) out.pane_id = parseInt(m[1], 10);
      break;
    }
    case 'exit':
    case 'client-detached': {
      out.reason = rest || null;
      break;
    }
  }
  return out;
}

// ─── Belt-and-braces silence hook ─────────────────────────────────────────────
//
// tmux's `-C attach-session` subprocess is fragile — it can die on some tmux
// versions / load conditions, which kills the control-mode silence path above.
// As a redundant channel we also install a native tmux `set-hook alert-silence`
// pointing at a small shell helper that pokes the daemon's Unix socket with a
// `silence` IPC message. The daemon then broadcasts `terminal_silence` through
// the same path — dedup'd via `lastSilenceBroadcast` so ctrl-mode + hook never
// double-fire.
//
// This is called on every spawn AND every reconnect — idempotent (tmux just
// re-sets the same option + hook).
function installSilenceHook(sessionId: string) {
  if (!existsSync(SILENCE_HOOK_SCRIPT)) return; // helper not deployed — skip quietly
  try {
    execFileSync(TMUX, [
      'set-window-option', '-t', sessionId, 'monitor-silence', '3',
    ], { stdio: 'pipe' });
    // Suppress ALL tmux status-bar redraws that cause mobile xterm.js flicker:
    // 1. silence-action=none: don't visually flag windows on silence transitions
    // 2. status=off: disable tmux's own status bar entirely — ANT renders its
    //    own session header in the UI, so the native tmux bar is redundant and
    //    its flag-toggling format (#{window_silence_flag}, #{window_activity_flag})
    //    causes continuous redraws on TUIs that paint frequently.
    execFileSync(TMUX, [
      'set-option', '-t', sessionId, 'silence-action', 'none',
    ], { stdio: 'pipe' });
    execFileSync(TMUX, [
      'set-option', '-t', sessionId, 'status', 'off',
    ], { stdio: 'pipe' });
    // Shell-quote the session ID defensively. tmux session IDs are
    // alphanumeric + `-` in practice, but a stray `'` would break run-shell.
    const safeSid = sessionId.replace(/'/g, `'\\''`);
    execFileSync(TMUX, [
      'set-hook', '-t', sessionId, 'alert-silence',
      `run-shell '${SILENCE_HOOK_SCRIPT} ${safeSid}'`,
    ], { stdio: 'pipe' });
  } catch (e) {
    LOG(`installSilenceHook failed for ${sessionId}:`, (e as Error).message);
  }
}

// Read the current pane_title for a session via a one-shot tmux display call.
// Sub-millisecond; used by the server-side 2s polling loop to catch OSC title
// updates from claude (⠂/✳ task summary) and gemini ("Action Required…").
function readPaneTitle(sessionId: string): string {
  try {
    return execFileSync(TMUX, [
      'display-message', '-p', '-t', sessionId, '#{pane_title}',
    ], { stdio: 'pipe' }).toString().replace(/\n$/, '');
  } catch { return ''; }
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
        // Re-apply the silence hook — idempotent and survives daemon restarts.
        installSilenceHook(msg.sessionId);
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

      // Install the belt-and-braces native tmux set-hook in parallel with
      // control mode. If ctrl mode flakes, this still delivers silence.
      setTimeout(() => {
        if (session.alive) installSilenceHook(msg.sessionId);
      }, 600);

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
      lastSilenceBroadcast.delete(msg.sessionId);
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

    // Silence notification from tmux's native alert-silence hook (via the
    // ant-silence-notify helper). This is the belt-and-braces path that works
    // even when ctrl-mode's %alert-silence parser is down. Shares dedup state
    // with the ctrl-mode path so we never double-post.
    case 'silence': {
      const now = Date.now();
      if (now - (lastSilenceBroadcast.get(msg.sessionId) ?? 0) < SILENCE_DEDUP_MS) break;
      lastSilenceBroadcast.set(msg.sessionId, now);
      const text = captureClean(msg.sessionId, 30);
      if (!text) break;
      broadcast({
        type: 'terminal_silence',
        sessionId: msg.sessionId,
        isPrompt: isWaitingForInput(text),  // kept for schema compat; server ignores
        text,
      });
      break;
    }

    // Current pane_title for a session. Used by the server's polling loop
    // to detect OSC title changes from CLIs that emit OSC 0/1/2 (claude, gemini).
    case 'title': {
      const title = readPaneTitle(msg.sessionId);
      send(socket, { type: 'title', sessionId: msg.sessionId, callId: msg.callId, title });
      break;
    }

    case 'is_chrome_result': {
      const key = `${msg.sessionId}:${msg.line}`;
      chromeChecks.get(key)?.(msg.isChrome);
      chromeChecks.delete(key);
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
