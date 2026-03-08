import * as pty from "node-pty";
import { execFileSync } from "child_process";
import os from "os";
import { nanoid } from "nanoid";
import db from "./db.js";
import type { DbResumeCommand } from "./types.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface PtySession {
  process: pty.IPty;
  sessionId: string;
  output: string[];
  listeners: Set<(data: string) => void>;
  resumeBuffer: string;
  resumeDebounce: ReturnType<typeof setTimeout> | null;
}

type TerminalOutputListener = (data: string) => void;

interface TerminalOutputChunk {
  index: number;
  data: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TMUX_PREFIX = "ant-";
const SESSION_TTL_MS = parseInt(process.env.ANT_SESSION_TTL_MS || String(15 * 60 * 1000), 10); // 15 min default
const MAX_TERMINAL_OUTPUT_EVENTS = 5000;
const DEFAULT_OUTPUT_LIMIT = 250;

const OSC7_RE = /\x1b\]7;file:\/\/[^/]*(\/.*?)(?:\x07|\x1b\\)/;

const defaultShell =
  process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");

const ALLOWED_SHELLS = [
  "bash", "zsh", "sh", "fish", "dash", "ksh", "tcsh",
  "powershell.exe", "cmd.exe",
  "/bin/bash", "/bin/zsh", "/bin/sh", "/bin/fish", "/bin/dash",
  "/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/fish",
  "/usr/local/bin/bash", "/usr/local/bin/zsh", "/usr/local/bin/fish",
];

const ptySessions = new Map<string, PtySession>();

// ---------------------------------------------------------------------------
// Orphan kill timers  (sessionId → timer)
// ---------------------------------------------------------------------------

const killTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// ANSI / resume-command helpers
// ---------------------------------------------------------------------------

function stripAnsi(str: string): string {
  return str.replace(
    /\x1b\[[0-9;]*[a-zA-Z]|\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b[()][AB012]/g,
    ""
  );
}

const RESUME_PATTERNS: { cli: DbResumeCommand["cli"]; re: RegExp }[] = [
  { cli: "claude", re: /\b(claude\s+(?:--resume|-r)\s+[a-zA-Z0-9_-]+)\b/ },
  { cli: "claude", re: /\b(claude\s+-c)\b/ },
  { cli: "codex",  re: /\b(codex\s+resume\s+[a-zA-Z0-9_-]+)\b/ },
  { cli: "codex",  re: /\b(codex\s+resume\s+--last)\b/ },
  { cli: "gemini", re: /\b(gemini\s+(?:--resume|-r)\s+[a-zA-Z0-9_-]+)\b/ },
  { cli: "copilot", re: /\b(copilot\s+(?:--resume|--continue)\s*[a-zA-Z0-9_-]*)\b/ },
];

type ResumeCommandListener = (cmd: DbResumeCommand) => void;
const resumeListeners = new Set<ResumeCommandListener>();

export function onResumeCommand(listener: ResumeCommandListener): () => void {
  resumeListeners.add(listener);
  return () => { resumeListeners.delete(listener); };
}

function parseResumeCommands(sessionId: string, text: string): void {
  const plain = stripAnsi(text);
  for (const { cli, re } of RESUME_PATTERNS) {
    const match = re.exec(plain);
    if (!match) continue;
    const command = match[1].trim();

    const existing = db
      .prepare("SELECT id FROM resume_commands WHERE session_id = ? AND command = ?")
      .get(sessionId, command);
    if (existing) continue;

    const lines = plain.split("\n").map((l) => l.trim()).filter(Boolean);
    const matchIdx = lines.findIndex((l) => l.includes(command));
    let description: string | null = null;
    if (matchIdx > 0) {
      description = lines[matchIdx - 1];
    } else if (matchIdx >= 0 && matchIdx < lines.length - 1) {
      description = lines[matchIdx + 1];
    }

    let rootPath: string | null = null;
    const cwdMatch = plain.match(/(?:working directory|cwd|in)\s*[:=]?\s*(\/[^\s\n]+)/i);
    if (cwdMatch) rootPath = cwdMatch[1];

    const id = nanoid(12);
    db.prepare(
      "INSERT INTO resume_commands (id, session_id, cli, command, description, root_path) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, sessionId, cli, command, description, rootPath);

    const row = db.prepare("SELECT * FROM resume_commands WHERE id = ?").get(id) as DbResumeCommand;
    resumeListeners.forEach((listener) => listener(row));
  }
}

// ---------------------------------------------------------------------------
// tmux helpers
// ---------------------------------------------------------------------------

function tmuxSessionName(sessionId: string): string {
  return `${TMUX_PREFIX}${sessionId}`;
}

function tmuxSessionExists(sessionId: string): boolean {
  try {
    execFileSync("tmux", ["has-session", "-t", tmuxSessionName(sessionId)], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

/** List all ANT-owned tmux sessions. */
function listAntTmuxSessions(): string[] {
  try {
    const out = execFileSync("tmux", ["list-sessions", "-F", "#{session_name}"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return out
      .split("\n")
      .map((l) => l.trim())
      .filter((name) => name.startsWith(TMUX_PREFIX));
  } catch {
    return []; // tmux server not running
  }
}

function killTmuxSession(sessionId: string): void {
  try {
    execFileSync("tmux", ["kill-session", "-t", tmuxSessionName(sessionId)], {
      stdio: "ignore",
    });
  } catch {
    // already dead
  }
}

// ---------------------------------------------------------------------------
// Safe env / clamp
// ---------------------------------------------------------------------------

function safeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const passthrough = [
    "PATH", "HOME", "SHELL", "USER", "LOGNAME",
    "LANG", "LC_ALL", "LC_CTYPE", "TERM_PROGRAM", "COLORTERM",
  ];
  for (const key of passthrough) {
    if (process.env[key]) env[key] = process.env[key]!;
  }
  env.TERM = "xterm-256color";
  return env;
}

function clamp(value: number, min: number, max: number) {
  if (!Number.isFinite(value)) return min;
  return Math.max(min, Math.min(Math.floor(value), max));
}

// ---------------------------------------------------------------------------
// PTY lifecycle — backed by tmux
// ---------------------------------------------------------------------------

/**
 * Create (or re-attach to) a tmux-backed PTY for the given session.
 *
 * `tmux new-session -A` attaches if the session exists, or creates it.
 * We disable the status bar and unbind the prefix key so the user
 * experiences a transparent shell — no tmux chrome, no stolen keys.
 */
export function createPty(
  sessionId: string,
  shell?: string | null,
  cwd?: string | null,
): pty.IPty {
  if (ptySessions.has(sessionId)) {
    return ptySessions.get(sessionId)!.process;
  }

  // Cancel any pending kill timer for this session
  cancelKillTimer(sessionId);

  if (shell && !ALLOWED_SHELLS.includes(shell)) {
    throw new Error(`Shell not allowed: ${shell}`);
  }

  const tmuxName = tmuxSessionName(sessionId);
  const isReattach = tmuxSessionExists(sessionId);

  // Build tmux args
  // -A  = attach-or-create
  // -s  = session name
  // -x/-y = initial size (only used on creation)
  const tmuxArgs = ["new-session", "-A", "-s", tmuxName, "-x", "120", "-y", "30"];

  if (!isReattach) {
    // On fresh creation, set the shell and working directory
    const resolvedShell = shell || defaultShell;
    const resolvedCwd = cwd || process.env.HOME || process.cwd();
    tmuxArgs.push("-c", resolvedCwd);
    // Use the shell as the default command
    tmuxArgs.push(resolvedShell);
  }

  const ptyProcess = pty.spawn("tmux", tmuxArgs, {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: cwd || process.env.HOME || process.cwd(),
    env: safeEnv(),
  });

  // Suppress tmux chrome: no status bar, no prefix key
  // Short delay to allow tmux to initialise before sending commands
  setTimeout(() => {
    try {
      execFileSync("tmux", ["set-option", "-t", tmuxName, "status", "off"], { stdio: "ignore" });
      execFileSync("tmux", ["set-option", "-t", tmuxName, "prefix", "None"], { stdio: "ignore" });
      execFileSync("tmux", ["set-option", "-t", tmuxName, "prefix2", "None"], { stdio: "ignore" });
      // Enable mouse support so scrolling works through xterm.js
      execFileSync("tmux", ["set-option", "-t", tmuxName, "mouse", "on"], { stdio: "ignore" });
    } catch {
      // Non-fatal — session may have exited already
    }
  }, 300);

  const session: PtySession = {
    process: ptyProcess,
    sessionId,
    output: [],
    listeners: new Set(),
    resumeBuffer: "",
    resumeDebounce: null,
  };
  ptySessions.set(sessionId, session);

  ptyProcess.onData((data: string) => {
    session.output.push(data);
    if (session.output.length > MAX_TERMINAL_OUTPUT_EVENTS) {
      session.output = session.output.slice(-MAX_TERMINAL_OUTPUT_EVENTS);
    }

    // Parse OSC 7 for working directory changes
    const osc7Match = OSC7_RE.exec(data);
    if (osc7Match) {
      try {
        const newCwd = decodeURIComponent(osc7Match[1]);
        db.prepare("UPDATE sessions SET cwd = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newCwd, sessionId);
      } catch {
        // Ignore decode/db errors
      }
    }

    // Buffer for resume command scanning (debounced)
    session.resumeBuffer += data;
    if (session.resumeBuffer.length > 4096) {
      session.resumeBuffer = session.resumeBuffer.slice(-4096);
    }
    if (session.resumeDebounce) clearTimeout(session.resumeDebounce);
    session.resumeDebounce = setTimeout(() => {
      try {
        parseResumeCommands(sessionId, session.resumeBuffer);
      } catch { /* ignore */ }
      session.resumeBuffer = "";
    }, 500);

    session.listeners.forEach((listener) => listener(data));
  });

  ptyProcess.onExit(() => {
    // Flush resume buffer
    if (session.resumeBuffer) {
      try { parseResumeCommands(sessionId, session.resumeBuffer); } catch {}
      session.resumeBuffer = "";
    }
    if (session.resumeDebounce) clearTimeout(session.resumeDebounce);

    // Only clean up the node-pty wrapper — the tmux session lives on
    session.listeners.clear();
    ptySessions.delete(sessionId);
  });

  return session.process;
}

export function getPty(sessionId: string): pty.IPty | undefined {
  return ptySessions.get(sessionId)?.process;
}

export function hasOutputListeners(sessionId: string): boolean {
  return !!ptySessions.get(sessionId)?.listeners.size;
}

export function addPtyOutputListener(
  sessionId: string,
  listener: TerminalOutputListener,
) {
  const session = ptySessions.get(sessionId);
  if (!session) return undefined;
  session.listeners.add(listener);
  return () => {
    session.listeners.delete(listener);
  };
}

export function removePtyOutputListeners(sessionId: string): void {
  const session = ptySessions.get(sessionId);
  if (!session) return;
  session.listeners.clear();
}

export function getTerminalOutput(
  sessionId: string,
  options?: { since?: number; limit?: number },
) {
  const session = ptySessions.get(sessionId);
  if (!session) return [];

  const safeSince = Math.max(0, Math.floor(options?.since || 0));
  const safeLimit = clamp(
    typeof options?.limit === "number" ? options.limit : DEFAULT_OUTPUT_LIMIT,
    1,
    MAX_TERMINAL_OUTPUT_EVENTS,
  );

  const end = Math.min(session.output.length, safeSince + safeLimit);
  return session.output
    .slice(safeSince, end)
    .map((data, index): TerminalOutputChunk => ({ index: safeSince + index, data }));
}

export function getTerminalOutputCursor(sessionId: string): number {
  return ptySessions.get(sessionId)?.output.length || 0;
}

/**
 * Detach the node-pty wrapper from a session.
 * The underlying tmux session remains alive for re-attachment.
 */
export function detachPty(sessionId: string): void {
  const session = ptySessions.get(sessionId);
  if (!session) return;

  session.process.kill();
  session.listeners.clear();
  if (session.resumeDebounce) clearTimeout(session.resumeDebounce);
  ptySessions.delete(sessionId);
}

/**
 * Fully destroy a session — kill the tmux session and clean up.
 * Used when the user explicitly deletes a session or the kill timer fires.
 */
export function destroyPty(sessionId: string): void {
  detachPty(sessionId);
  killTmuxSession(sessionId);
  cancelKillTimer(sessionId);
}

/**
 * Kill all ANT-owned tmux sessions. Nuclear option.
 */
export function destroyAllPtys(): number {
  let count = 0;

  // Destroy tracked sessions
  for (const sid of Array.from(ptySessions.keys())) {
    destroyPty(sid);
    count++;
  }

  // Also kill any orphaned tmux sessions from previous server runs
  for (const tmuxName of listAntTmuxSessions()) {
    const sessionId = tmuxName.slice(TMUX_PREFIX.length);
    if (!ptySessions.has(sessionId)) {
      try {
        execFileSync("tmux", ["kill-session", "-t", tmuxName], { stdio: "ignore" });
        count++;
      } catch {}
    }
  }

  return count;
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const session = ptySessions.get(sessionId);
  if (!session) return;
  session.process.resize(clamp(cols, 1, 500), clamp(rows, 1, 200));
}

// ---------------------------------------------------------------------------
// Connection-based lifecycle
// ---------------------------------------------------------------------------

/**
 * Called when the last WebSocket client disconnects from a terminal session.
 * Starts the grace-period countdown.
 */
export function startKillTimer(sessionId: string): void {
  cancelKillTimer(sessionId);
  const timer = setTimeout(() => {
    killTimers.delete(sessionId);
    console.log(`[pty-manager] Kill timer expired for session ${sessionId} — destroying tmux session`);
    destroyPty(sessionId);
  }, SESSION_TTL_MS);
  killTimers.set(sessionId, timer);
}

/**
 * Called when a WebSocket client connects to a terminal session.
 * Cancels any pending kill timer.
 */
export function cancelKillTimer(sessionId: string): void {
  const timer = killTimers.get(sessionId);
  if (timer) {
    clearTimeout(timer);
    killTimers.delete(sessionId);
  }
}

/**
 * Returns true if a tmux session exists for this ANT session
 * (even if no node-pty wrapper is attached).
 */
export function hasTmuxSession(sessionId: string): boolean {
  return tmuxSessionExists(sessionId);
}

// ---------------------------------------------------------------------------
// Startup reaping — re-adopt or kill orphaned tmux sessions
// ---------------------------------------------------------------------------

/**
 * Called once at server startup. For each orphaned ANT tmux session,
 * start a kill timer. If a client reconnects before it fires, the
 * session survives. Otherwise it gets cleaned up.
 */
export function reapOrphanedSessions(): void {
  const tmuxSessions = listAntTmuxSessions();
  if (tmuxSessions.length === 0) return;

  console.log(`[pty-manager] Found ${tmuxSessions.length} orphaned tmux session(s) — starting ${SESSION_TTL_MS / 1000}s kill timers`);
  for (const tmuxName of tmuxSessions) {
    const sessionId = tmuxName.slice(TMUX_PREFIX.length);
    startKillTimer(sessionId);
  }
}
