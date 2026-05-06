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
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'fs';
import { join } from 'path';
import { execFileSync } from 'child_process';
import { Osc133BlockParser, type Osc133CommandBlock } from './osc133.js';

const ANT_DIR  = join(process.env.HOME || '/tmp', '.ant');
const SOCK_PATH = join(ANT_DIR, 'pty.sock');
const LOCK_PATH = join(ANT_DIR, 'pty-daemon.lock');
const LOG = (...a: any[]) => console.log('[pty-daemon]', ...a);
const HOME = process.env.HOME || '/tmp';
const TMUX_BIN = '/opt/homebrew/bin/tmux';
// Optional dedicated tmux server socket (env: ANT_TMUX_SOCKET). When set,
// the daemon writes a one-line wrapper script that always invokes tmux with
// -L <socket>, and uses that script everywhere a tmux process is spawned.
// This keeps probe / test runs from leaking sessions into the user's default
// tmux server. Default empty string ⇒ shared user socket (current behaviour).
const TMUX = (() => {
  const sock = process.env.ANT_TMUX_SOCKET || '';
  if (!sock) return TMUX_BIN;
  mkdirSync(ANT_DIR, { recursive: true });
  const wrapperPath = join(ANT_DIR, `tmux-${sock}.sh`);
  writeFileSync(wrapperPath, `#!/bin/sh\nexec ${TMUX_BIN} -L ${sock} "$@"\n`);
  chmodSync(wrapperPath, 0o755);
  console.log('[pty-daemon]', `tmux socket isolation: -L ${sock} via ${wrapperPath}`);
  return wrapperPath;
})();
const SILENCE_HOOK_SCRIPT = join(HOME, '.ant', 'hooks', 'ant-silence-notify');
const HOOK_DIR = join(HOME, '.ant', 'hooks');
const CAPTURE_DIR = join(HOME, '.local', 'state', 'ant', 'capture');
const INSTALLED_SHELL_INTEGRATION_DIR = join(HOOK_DIR, 'shell-integration');
const STATIC_SHELL_INTEGRATION_DIR = join(process.cwd(), 'static', 'shell-integration');
const LEGACY_SHELL_INTEGRATION_DIR = join(process.cwd(), 'ant-capture');

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

// Per-session stripLines count — how many bottom-of-screen lines to strip
// before diffing (removes CLI chrome like input prompts, status bars, etc.).
// Set via the `set_cli_flag` IPC when the user tags a session with a CLI mode.
const stripLinesMap = new Map<string, number>();

interface OutputTimer {
  timer: ReturnType<typeof setTimeout> | null;
  maxTimer: ReturnType<typeof setTimeout> | null;
  firstTs: number;
}
const outputTimers = new Map<string, OutputTimer>();

// Pending chrome-check requests — keyed by "sessionId:line"
const chromeChecks = new Map<string, (isChrome: boolean) => void>();

const oscParsers = new Map<string, Osc133BlockParser>();
const rawByteOffsets = new Map<string, number>();
const controlByteOffsets = new Map<string, number>();

async function flushViaCapture(sessionId: string, ot: OutputTimer): Promise<void> {
  if (ot.timer) { clearTimeout(ot.timer); ot.timer = null; }
  if (ot.maxTimer) { clearTimeout(ot.maxTimer); ot.maxTimer = null; }
  ot.firstTs = 0;

  // Capture the current rendered screen (plain text, no ANSI)
  const fullScreen = captureClean(sessionId, 50);
  if (!fullScreen) return;

  // Status detection needs the TUI footer/status bar that chat rendering strips.
  // Control-mode %output tells us the pane changed; capture-pane gives us the
  // current rendered text. Send a bottom-window sample before stripping chrome.
  const statusSample = fullScreen.split('\n').slice(-30).join('\n').trim();
  if (statusSample) {
    broadcast({
      type: 'terminal_status_sample',
      sessionId,
      text: statusSample,
      ts: Date.now(),
    });
  }

  // Strip bottom N lines based on cli_flag (removes CLI chrome like input bars,
  // status lines, spinners, etc.) before diffing so they never enter the pipeline.
  let screen = fullScreen;
  const stripN = stripLinesMap.get(sessionId) ?? 15;
  if (stripN > 0) {
    const lines = screen.split('\n');
    if (lines.length > stripN) {
      screen = lines.slice(0, lines.length - stripN).join('\n');
    }
  }

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

  // Non-consecutive duplicate detection: only emit lines that were NOT in the previous
  // capture. This prevents re-broadcasting static content that shifted but was
  // already delivered.
  const rawFresh = newLines.slice(0, newLines.length - common)
    .map(l => l.trimEnd())
    .filter(l => l.length > 0 && !prevLines.includes(l));

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

function parserFor(sessionId: string): Osc133BlockParser {
  let parser = oscParsers.get(sessionId);
  if (!parser) {
    parser = new Osc133BlockParser();
    oscParsers.set(sessionId, parser);
  }
  return parser;
}

function handleOscOutput(sessionId: string, data: string, startByte: number): void {
  for (const block of parserFor(sessionId).push(data, startByte)) {
    broadcastBlockEvent(sessionId, block);
  }
}

function handleRawOutput(sessionId: string, data: string): void {
  const startByte = rawByteOffsets.get(sessionId) ?? 0;
  handleOscOutput(sessionId, data, startByte);
  rawByteOffsets.set(sessionId, startByte + Buffer.byteLength(data));
}

function handleControlOutput(sessionId: string, content: string): void {
  const decoded = decodeTmuxControlOutput(content);
  if (!decoded) return;
  const startByte = controlByteOffsets.get(sessionId) ?? 0;
  controlByteOffsets.set(sessionId, startByte + Buffer.byteLength(decoded));
}

function decodeTmuxControlOutput(content: string): string {
  return content
    .replace(/\\([0-7]{3})/g, (_m, octal: string) => String.fromCharCode(Number.parseInt(octal, 8)))
    .replace(/\\e/g, '\x1b')
    .replace(/\\r/g, '\r')
    .replace(/\\n/g, '\n')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

function broadcastBlockEvent(sessionId: string, block: Osc133CommandBlock): void {
  const durationMs = Math.max(0, block.endedAtMs - block.startedAtMs);
  broadcast({
    type: 'block_event',
    sessionId,
    ts: block.endedAtMs,
    source: 'hook',
    trust: 'high',
    kind: 'command_block',
    text: block.command,
    payload: {
      command: block.command,
      exit_code: block.exitCode,
      cwd: block.cwd,
      duration_ms: durationMs,
      started_at: new Date(block.startedAtMs).toISOString(),
      ended_at: new Date(block.endedAtMs).toISOString(),
      osc133: block.markers,
    },
    raw_ref: {
      start_byte: block.rawStartByte,
      end_byte: block.rawEndByte,
    },
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
let lockFd: number | null = null;

function processExists(pid: number): boolean {
  if (!Number.isFinite(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function readLockPid(): number | null {
  try {
    const raw = readFileSync(LOCK_PATH, 'utf8').trim();
    const pid = Number(raw);
    return Number.isFinite(pid) ? pid : null;
  } catch {
    return null;
  }
}

function acquireDaemonLock(): void {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      lockFd = openSync(LOCK_PATH, 'wx');
      writeFileSync(lockFd, `${process.pid}\n`);
      return;
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code !== 'EEXIST') throw err;

      const existingPid = readLockPid();
      if (existingPid && processExists(existingPid)) {
        LOG(`daemon already running as pid ${existingPid}; exiting`);
        process.exit(0);
      }

      try { unlinkSync(LOCK_PATH); } catch {}
    }
  }

  throw new Error(`Could not acquire daemon lock at ${LOCK_PATH}`);
}

function releaseDaemonLock(): void {
  if (lockFd !== null) {
    try { closeSync(lockFd); } catch {}
    lockFd = null;
  }

  if (readLockPid() === process.pid) {
    try { unlinkSync(LOCK_PATH); } catch {}
  }
}

function unlinkDaemonSocket(): void {
  try { unlinkSync(SOCK_PATH); } catch {}
}

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
    handleControlOutput(sessionId, content);
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
    // Inject ANT_SESSION into the tmux environment so any process launched
    // inside this session (Claude Code, Gemini CLI, etc.) inherits it.
    // Claude Code hooks use this to route events back to the right ANT chat.
    execFileSync(TMUX, [
      'set-environment', '-t', sessionId, 'ANT_SESSION', sessionId,
    ], { stdio: 'pipe' });
    execFileSync(TMUX, [
      'set-environment', '-t', sessionId, 'ANT_SERVER', `https://localhost:${process.env.ANT_PORT || '6458'}`,
    ], { stdio: 'pipe' });
    execFileSync(TMUX, [
      'set-environment', '-t', sessionId, 'ANT_SERVER_URL', `https://localhost:${process.env.ANT_PORT || '6458'}`,
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

function shellIntegrationDir(): string | null {
  for (const dir of [INSTALLED_SHELL_INTEGRATION_DIR, STATIC_SHELL_INTEGRATION_DIR, LEGACY_SHELL_INTEGRATION_DIR]) {
    if (existsSync(join(dir, 'ant.zsh')) || existsSync(join(dir, 'ant.bash')) || existsSync(join(dir, 'ant.fish'))) {
      return dir;
    }
  }
  return null;
}

function safeRuntimeName(sessionId: string): string {
  return sessionId.replace(/[^A-Za-z0-9_.-]/g, '_');
}

function prepareShellIntegration(sessionId: string, env: Record<string, string>): string | null {
  const integrationDir = shellIntegrationDir();
  if (!integrationDir) return null;

  const runtimeDir = join(HOOK_DIR, 'runtime', safeRuntimeName(sessionId));
  const zdotdir = join(runtimeDir, 'zdotdir');
  const bashrc = join(runtimeDir, 'bashrc');
  const launcher = join(runtimeDir, 'launch-shell');
  mkdirSync(zdotdir, { recursive: true });
  mkdirSync(CAPTURE_DIR, { recursive: true });

  const originalZdotdir = env.ZDOTDIR || HOME;
  writeFileSync(join(zdotdir, '.zshrc'), [
    `ANT_ORIGINAL_ZDOTDIR="${escapeDoubleQuoted(originalZdotdir)}"`,
    'if [ -f "$ANT_ORIGINAL_ZDOTDIR/.zshrc" ]; then source "$ANT_ORIGINAL_ZDOTDIR/.zshrc"; fi',
    '[ -f "$ANT_SHELL_INTEGRATION_DIR/ant.zsh" ] && source "$ANT_SHELL_INTEGRATION_DIR/ant.zsh"',
    '',
  ].join('\n'));

  writeFileSync(bashrc, [
    '[ -f "$HOME/.bashrc" ] && source "$HOME/.bashrc"',
    '[ -f "$ANT_SHELL_INTEGRATION_DIR/ant.bash" ] && source "$ANT_SHELL_INTEGRATION_DIR/ant.bash"',
    '',
  ].join('\n'));

  writeFileSync(launcher, [
    '#!/bin/sh',
    'shell="${SHELL:-/bin/zsh}"',
    'name="${shell##*/}"',
    'case "$name" in',
    '  bash) exec "$shell" --rcfile "$ANT_BASH_RC" -i ;;',
    '  zsh) exec "$shell" -i ;;',
    '  fish) exec "$shell" --init-command "source \\"$ANT_SHELL_INTEGRATION_DIR/ant.fish\\"" ;;',
    '  *) exec "$shell" -i ;;',
    'esac',
    '',
  ].join('\n'));
  chmodSync(launcher, 0o755);

  env.ANT_CAPTURE_DIR = CAPTURE_DIR;
  env.ANT_SHELL_INTEGRATION_DIR = integrationDir;
  env.ANT_BASH_RC = bashrc;
  env.BASH_ENV = bashrc;
  env.ENV = bashrc;
  env.ANT_ORIGINAL_ZDOTDIR = originalZdotdir;
  env.ZDOTDIR = zdotdir;

  return launcher;
}

function escapeDoubleQuoted(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\$/g, '\\$').replace(/`/g, '\\`');
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

function writeViaTmux(sessionId: string, data: string): boolean {
  if (!tmuxSessionExists(sessionId)) return false;

  try {
    if (data === '\r' || data === '\n' || data === '\r\n') {
      execFileSync(TMUX, ['send-keys', '-t', sessionId, 'Enter'], { stdio: 'pipe' });
      return true;
    }

    const bufferName = `ant-write-${process.pid}-${Date.now()}`;
    execFileSync(TMUX, ['load-buffer', '-b', bufferName, '-'], { input: data, stdio: ['pipe', 'pipe', 'pipe'] });
    try {
      execFileSync(TMUX, ['paste-buffer', '-b', bufferName, '-t', sessionId], { stdio: 'pipe' });
    } finally {
      try { execFileSync(TMUX, ['delete-buffer', '-b', bufferName], { stdio: 'pipe' }); } catch {}
    }
    return true;
  } catch (e) {
    LOG(`tmux write fallback failed for ${sessionId}:`, (e as Error).message);
    return false;
  }
}

// ─── Unix socket server ───────────────────────────────────────────────────────

mkdirSync(ANT_DIR, { recursive: true });
acquireDaemonLock();
if (existsSync(SOCK_PATH)) unlinkDaemonSocket();

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
      // Trust the cached `alive` flag only if tmux confirms the session still
      // exists. Otherwise the cache is stale (e.g. tmux died externally without
      // triggering term.onExit, or the daemon was started inside tmux and the
      // earlier spawn silently failed) and we need to drop it and respawn.
      if (existing?.alive && tmuxSessionExists(msg.sessionId)) {
        // Reconnect path: serve scrollback from tmux's own buffer.
        // capture-pane handles alt-screen automatically — no prefix injection needed.
        // Re-apply the silence hook — idempotent and survives daemon restarts.
        installSilenceHook(msg.sessionId);
        const scrollback = captureScrollback(msg.sessionId);
        send(socket, { type: 'spawned', sessionId: msg.sessionId, callId: msg.callId, alive: true, scrollback });
        return;
      }
      if (existing) {
        // Stale cache — drop the dead PTY handle before spawning a fresh tmux.
        try { existing.ctrl?.kill(); } catch {}
        try { existing.pty.kill(); } catch {}
        sessions.delete(msg.sessionId);
        LOG(`evicted stale session cache: ${msg.sessionId}`);
      }

      // Strip TMUX env vars before spawning — if the daemon was started from
      // inside an existing tmux session, $TMUX/$TMUX_PANE leak into the child
      // and tmux refuses to nest, causing the spawn to die silently.
      const childEnv: Record<string, string> = {
        ...process.env,
        ANT_SESSION_ID: msg.sessionId,
        ANT_CAPTURE_DEPTH: '0',
        TERM: 'xterm-256color',
      } as Record<string, string>;
      const shellLauncher = prepareShellIntegration(msg.sessionId, childEnv);
      delete childEnv.TMUX;
      delete childEnv.TMUX_PANE;
      delete childEnv.TMUX_PLUGIN_MANAGER_PATH;

      const tmuxArgs = [
        'new-session', '-A',
        '-s', msg.sessionId,
        '-e', `ANT_SESSION_ID=${msg.sessionId}`,
        '-e', `ANT_CAPTURE_DIR=${childEnv.ANT_CAPTURE_DIR ?? CAPTURE_DIR}`,
        '-e', `ANT_CAPTURE_DEPTH=0`,
        ...(childEnv.ANT_SHELL_INTEGRATION_DIR ? ['-e', `ANT_SHELL_INTEGRATION_DIR=${childEnv.ANT_SHELL_INTEGRATION_DIR}`] : []),
        ...(childEnv.ANT_BASH_RC ? ['-e', `ANT_BASH_RC=${childEnv.ANT_BASH_RC}`] : []),
        ...(childEnv.BASH_ENV ? ['-e', `BASH_ENV=${childEnv.BASH_ENV}`] : []),
        ...(childEnv.ENV ? ['-e', `ENV=${childEnv.ENV}`] : []),
        ...(childEnv.ZDOTDIR ? ['-e', `ZDOTDIR=${childEnv.ZDOTDIR}`] : []),
        ...(childEnv.ANT_ORIGINAL_ZDOTDIR ? ['-e', `ANT_ORIGINAL_ZDOTDIR=${childEnv.ANT_ORIGINAL_ZDOTDIR}`] : []),
        '-x', String(msg.cols || 220),
        '-y', String(msg.rows || 50),
      ];
      if (shellLauncher) tmuxArgs.push(shellLauncher);

      const term = pty.spawn(TMUX, tmuxArgs, {
        name: 'xterm-256color',
        cols: msg.cols || 220,
        rows: msg.rows || 50,
        cwd: msg.cwd || HOME,
        env: childEnv,
      });

      const session: PTYSession = { pty: term, ctrl: null, alive: true, lastSilenceAlert: 0 };
      sessions.set(msg.sessionId, session);

      // Reinforce ANT_SESSION_ID at the session level so it survives any global
      // tmux env pollution from nested processes (e.g. Claude Code's internal tmux).
      // Per-session env takes precedence over global env for new windows/panes.
      try {
        execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ANT_SESSION_ID', msg.sessionId], { stdio: 'pipe' });
        execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ANT_CAPTURE_DIR', childEnv.ANT_CAPTURE_DIR ?? CAPTURE_DIR], { stdio: 'pipe' });
        execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ANT_CAPTURE_DEPTH', '0'], { stdio: 'pipe' });
        if (childEnv.ANT_SHELL_INTEGRATION_DIR) execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ANT_SHELL_INTEGRATION_DIR', childEnv.ANT_SHELL_INTEGRATION_DIR], { stdio: 'pipe' });
        if (childEnv.ANT_BASH_RC) execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ANT_BASH_RC', childEnv.ANT_BASH_RC], { stdio: 'pipe' });
        if (childEnv.BASH_ENV) execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'BASH_ENV', childEnv.BASH_ENV], { stdio: 'pipe' });
        if (childEnv.ENV) execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ENV', childEnv.ENV], { stdio: 'pipe' });
        if (childEnv.ZDOTDIR) execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ZDOTDIR', childEnv.ZDOTDIR], { stdio: 'pipe' });
        if (childEnv.ANT_ORIGINAL_ZDOTDIR) execFileSync(TMUX, ['set-environment', '-t', msg.sessionId, 'ANT_ORIGINAL_ZDOTDIR', childEnv.ANT_ORIGINAL_ZDOTDIR], { stdio: 'pipe' });
      } catch {}

      term.onData((data: string) => {
        handleRawOutput(msg.sessionId, data);
        broadcast({ type: 'output', sessionId: msg.sessionId, data });
      });

      term.onExit(() => {
        session.alive = false;
        try { session.ctrl?.kill(); } catch {}
        oscParsers.delete(msg.sessionId);
        rawByteOffsets.delete(msg.sessionId);
        controlByteOffsets.delete(msg.sessionId);
        broadcast({ type: 'exit', sessionId: msg.sessionId });
        LOG(`session exited: ${msg.sessionId}`);
      });

      // Start control mode quickly enough to catch the first command sent by
      // CLI/browser clients immediately after the spawn health response.
      setTimeout(() => {
        if (session.alive) session.ctrl = spawnControlMode(msg.sessionId, session);
      }, 100);

      // Install the belt-and-braces native tmux set-hook in parallel with
      // control mode. If ctrl mode flakes, this still delivers silence.
      setTimeout(() => {
        if (session.alive) installSilenceHook(msg.sessionId);
      }, 250);

      LOG(`spawned session: ${msg.sessionId}`);
      // New session — no scrollback yet
      send(socket, { type: 'spawned', sessionId: msg.sessionId, callId: msg.callId, alive: true, scrollback: '' });
      break;
    }

    case 'write': {
      // Prefer tmux paste-buffer (reliable, server-side) over the daemon's
      // node-pty client handle. Daemon-spawned tmux clients can silently
      // detach across reconnects, leaving s.alive=true but s.pty.write()
      // delivering bytes to a dead PTY. paste-buffer hits the tmux server
      // directly and lands in the active pane every time.
      // Fall back to s.pty.write only when the tmux session truly doesn't
      // exist (e.g. brand-new spawn before tmux has settled).
      if (writeViaTmux(msg.sessionId, msg.data)) break;
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
      oscParsers.delete(msg.sessionId);
      rawByteOffsets.delete(msg.sessionId);
      controlByteOffsets.delete(msg.sessionId);
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

    case 'reap-orphans': {
      // Kill any tmux session whose name is NOT in the caller-supplied list of
      // known/active ANT session IDs. The caller (server) is the source of
      // truth for what's "live" (it owns the DB); the daemon just executes.
      const known = new Set<string>(Array.isArray(msg.knownIds) ? msg.knownIds : []);
      const killed: string[] = [];
      let listed: string[] = [];
      try {
        const out = execFileSync(TMUX, ['list-sessions', '-F', '#{session_name}'], { stdio: 'pipe' }).toString();
        listed = out.split('\n').map(s => s.trim()).filter(Boolean);
      } catch { listed = []; }

      for (const sid of listed) {
        if (known.has(sid)) continue;
        const s = sessions.get(sid);
        if (s) {
          try { s.ctrl?.kill(); } catch {}
          try { s.pty.kill(); } catch {}
          s.alive = false;
          sessions.delete(sid);
        }
        lastSilenceBroadcast.delete(sid);
        oscParsers.delete(sid);
        rawByteOffsets.delete(sid);
        controlByteOffsets.delete(sid);
        try {
          execFileSync(TMUX, ['kill-session', '-t', sid], { stdio: 'pipe' });
          killed.push(sid);
          LOG(`reaped orphan tmux session: ${sid}`);
        } catch {}
      }
      send(socket, { type: 'reap-orphans-result', callId: msg.callId, killed });
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

    case 'set_cli_flag': {
      // Store the stripLines count for this session based on the CLI mode.
      // The client sends the cliFlag slug; we import the mode list to look up stripLines.
      // To avoid importing the full cli-modes module in the daemon, the server
      // sends stripLines directly alongside the flag.
      const strip = typeof msg.stripLines === 'number' ? msg.stripLines : 0;
      if (strip > 0) {
        stripLinesMap.set(msg.sessionId, strip);
      } else {
        stripLinesMap.delete(msg.sessionId);
      }
      LOG(`set_cli_flag: ${msg.sessionId} → ${msg.cliFlag ?? 'none'} (stripLines=${strip})`);
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

function cleanupDaemonFiles() {
  if (readLockPid() === process.pid) {
    unlinkDaemonSocket();
  }
  releaseDaemonLock();
}

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
process.on('exit', cleanupDaemonFiles);
