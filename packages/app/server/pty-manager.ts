import * as pty from "node-pty";
import { existsSync, unlinkSync, readdirSync } from "fs";
import os from "os";
import { nanoid } from "nanoid";
import db from "./db.js";
import type { DbResumeCommand, DbSession } from "./types.js";
import { stripAnsi } from "./types.js";
import { HeadlessTerminalWrapper } from "./terminal/headless-terminal.js";
import { CommandTracker, type CommandEvent } from "./terminal/command-tracker.js";

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
  nextOutputIndex: number;
  headless: HeadlessTerminalWrapper;
  commandTracker: CommandTracker;
}

type TerminalOutputListener = (data: string) => void;

interface TerminalOutputChunk {
  index: number;
  data: string;
  created_at?: string;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const DTACH_SOCKET_DIR = "/tmp";
const DTACH_SOCKET_PREFIX = "ant-";
const SESSION_TTL_MS = parseInt(
  process.env.ANT_SESSION_TTL_MS || String(48 * 60 * 60 * 1000),
  10
); // 48 hour default for session persistence
const MAX_TERMINAL_OUTPUT_EVENTS = 5000;
const DEFAULT_OUTPUT_LIMIT = 250;
const TIME_OF_DAY_SECONDS_EXPR =
  "(CAST(strftime('%H', created_at) AS INTEGER) * 3600 + " +
  "CAST(strftime('%M', created_at) AS INTEGER) * 60 + CAST(strftime('%S', created_at) AS INTEGER))";
const SECONDS_PER_DAY = 24 * 60 * 60;

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

const terminalOutputInsert = db.prepare(
  "INSERT OR REPLACE INTO terminal_output_events (session_id, chunk_index, data) VALUES (?, ?, ?)"
);

const terminalOutputByCursor = db.prepare(`
  SELECT chunk_index AS "index", data
  FROM terminal_output_events
  WHERE session_id = ? AND chunk_index >= ?
  ORDER BY chunk_index ASC
  LIMIT ?
`);

const terminalOutputCursor = db.prepare(`
  SELECT COALESCE(MAX(chunk_index), -1) AS max_index
  FROM terminal_output_events
  WHERE session_id = ?
`);

const terminalOutputSearch = db.prepare(`
  SELECT chunk_index AS "index", data, created_at
  FROM terminal_output_events
  WHERE session_id = ? AND data LIKE ? ESCAPE '\\'
  ORDER BY chunk_index ASC
  LIMIT ?
`);

const terminalOutputByTime = db.prepare(`
  SELECT chunk_index AS "index", data, created_at
  FROM terminal_output_events
  WHERE session_id = ?
  AND (
    ${TIME_OF_DAY_SECONDS_EXPR} BETWEEN ? AND ?
  )
  ORDER BY chunk_index ASC
  LIMIT ?
`);

const terminalOutputByTimeRanges = db.prepare(`
  SELECT chunk_index AS "index", data, created_at
  FROM terminal_output_events
  WHERE session_id = ?
  AND (
    ${TIME_OF_DAY_SECONDS_EXPR} BETWEEN ? AND ? OR
    ${TIME_OF_DAY_SECONDS_EXPR} BETWEEN ? AND ?
  )
  ORDER BY chunk_index ASC
  LIMIT ?
`);

// ---------------------------------------------------------------------------
// Orphan kill timers  (sessionId → timer)
// ---------------------------------------------------------------------------

const killTimers = new Map<string, ReturnType<typeof setTimeout>>();

// ---------------------------------------------------------------------------
// ANSI / resume-command helpers
// ---------------------------------------------------------------------------

// (stripAnsi imported from types.js)

function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, "\\$&");
}

function buildPaddedTimeRanges(
  startSeconds: number,
  endSeconds: number,
  padMinutes = 15,
) {
  const safePad = clamp(Math.trunc(padMinutes), 0, 120);
  const pad = safePad * 60;
  const adjustedStart = startSeconds - pad;
  const adjustedEnd = endSeconds + pad;

  if (adjustedStart < 0) {
    return [
      [adjustedStart + SECONDS_PER_DAY, SECONDS_PER_DAY - 1],
      [0, adjustedEnd],
    ] as const;
  }

  if (adjustedEnd >= SECONDS_PER_DAY) {
    return [
      [adjustedStart, SECONDS_PER_DAY - 1],
      [0, adjustedEnd - SECONDS_PER_DAY],
    ] as const;
  }

  if (adjustedEnd < adjustedStart) {
    return [
      [adjustedStart, SECONDS_PER_DAY - 1],
      [0, adjustedEnd],
    ] as const;
  }

  return [[adjustedStart, adjustedEnd]] as const;
}

function getTerminalOutputCursorFromDb(sessionId: string): number {
  try {
    const row = terminalOutputCursor.get(sessionId) as { max_index: number } | undefined;
    if (row && Number.isFinite(row.max_index)) {
      return row.max_index + 1;
    }
  } catch {
    // Fallback to in-memory cursor if DB is unavailable.
  }
  return ptySessions.get(sessionId)?.nextOutputIndex || 0;
}

function persistTerminalOutput(sessionId: string, chunkIndex: number, data: string): void {
  try {
    terminalOutputInsert.run(sessionId, chunkIndex, data);
  } catch {
    // Session rows may not exist in test setup (FK/migration timing);
    // terminal output is still available in-memory for the active session.
  }
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
    const result = db.prepare(
      "INSERT OR IGNORE INTO resume_commands (id, session_id, cli, command, description, root_path) VALUES (?, ?, ?, ?, ?, ?)"
    ).run(id, sessionId, cli, command, description, rootPath);

    if (result.changes === 0) continue;

    const row = db.prepare("SELECT * FROM resume_commands WHERE id = ?").get(id) as DbResumeCommand;
    resumeListeners.forEach((listener) => listener(row));
  }
}

// ---------------------------------------------------------------------------
// dtach helpers
// ---------------------------------------------------------------------------

function dtachSocketPath(sessionId: string): string {
  return `${DTACH_SOCKET_DIR}/${DTACH_SOCKET_PREFIX}${sessionId}.sock`;
}

function dtachSessionExists(sessionId: string): boolean {
  return existsSync(dtachSocketPath(sessionId));
}

/** List all ANT-owned dtach socket files, returning session IDs. */
function listAntDtachSessions(): string[] {
  try {
    return readdirSync(DTACH_SOCKET_DIR)
      .filter((f) => f.startsWith(DTACH_SOCKET_PREFIX) && f.endsWith(".sock"))
      .map((f) => f.slice(DTACH_SOCKET_PREFIX.length, -5)); // strip prefix and .sock
  } catch {
    return [];
  }
}

function killDtachSession(sessionId: string): void {
  const socketPath = dtachSocketPath(sessionId);
  try {
    // Remove the socket file — dtach process will exit when socket disappears
    if (existsSync(socketPath)) unlinkSync(socketPath);
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
// PTY lifecycle — backed by dtach
// ---------------------------------------------------------------------------

/**
 * Create (or re-attach to) a dtach-backed PTY for the given session.
 *
 * `dtach -A` attaches if the socket exists, or creates it.
 * dtach provides zero terminal chrome — no status bar, no prefix key,
 * no alternate screen buffer. Just persistent PTY attachment.
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

  const socketPath = dtachSocketPath(sessionId);
  const resolvedShell = shell || defaultShell;

  let resolvedCwd = cwd || process.env.ANT_ROOT_DIR || process.env.HOME || process.cwd();
  if (resolvedCwd.startsWith("~/")) {
    resolvedCwd = resolvedCwd.replace(/^~/, process.env.HOME || "");
  }

  // -A = attach or create
  // -E = no detach character (prevent accidental detach)
  // -z = no suspend
  const ptyProcess = pty.spawn("dtach", ["-A", socketPath, "-Ez", resolvedShell], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: resolvedCwd,
    env: safeEnv(),
  });

  // Create headless terminal mirror — same dimensions as the PTY
  const headless = new HeadlessTerminalWrapper(120, 30);

  // Create command lifecycle tracker
  const commandTracker = new CommandTracker();

  // Persist command events to DB
  const insertCommandEvent = db.prepare(
    `INSERT INTO command_events (id, session_id, command, exit_code, output, started_at, completed_at, duration_ms, cwd, detection_method)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );

  commandTracker.on("command_end", (event: CommandEvent) => {
    try {
      // Get current cwd from session
      const sess = db.prepare("SELECT cwd FROM sessions WHERE id = ?").get(sessionId) as { cwd: string | null } | undefined;
      const truncatedOutput = event.output ? event.output.slice(0, 50000) : null;
      insertCommandEvent.run(
        nanoid(12),
        sessionId,
        event.command,
        event.exitCode ?? null,
        truncatedOutput,
        event.startedAt,
        event.completedAt ?? null,
        event.durationMs ?? null,
        sess?.cwd ?? null,
        event.detectionMethod,
      );
    } catch {
      // Non-fatal — command tracking is best-effort
    }
  });

  // Emit command lifecycle events for WebSocket consumers
  commandTracker.on("command_start", (event) => {
    commandListeners.forEach((listener) => listener("command_start", sessionId, event));
  });
  commandTracker.on("command_end", (event) => {
    commandListeners.forEach((listener) => listener("command_end", sessionId, event));
  });
  commandTracker.on("idle", () => {
    commandListeners.forEach((listener) => listener("idle", sessionId, {}));
  });

  const session: PtySession = {
    process: ptyProcess,
    sessionId,
    output: [],
    listeners: new Set(),
    resumeBuffer: "",
    resumeDebounce: null,
    nextOutputIndex: getTerminalOutputCursorFromDb(sessionId),
    headless,
    commandTracker,
  };
  ptySessions.set(sessionId, session);

  ptyProcess.onData((data: string) => {
    // Feed into headless terminal (must happen before any listeners)
    headless.write(data);

    // Feed into command tracker for lifecycle detection
    commandTracker.feed(data);
    const chunkIndex = session.nextOutputIndex;
    session.nextOutputIndex += 1;
    session.output.push(data);
    if (session.output.length > MAX_TERMINAL_OUTPUT_EVENTS) {
      session.output = session.output.slice(-MAX_TERMINAL_OUTPUT_EVENTS);
    }

    persistTerminalOutput(sessionId, chunkIndex, data);

    // Parse OSC 7 for working directory changes
    const osc7Match = OSC7_RE.exec(data);
    if (osc7Match) {
      try {
        const newCwd = decodeURIComponent(osc7Match[1]);
        db.prepare("UPDATE sessions SET cwd = ?, updated_at = datetime('now') WHERE id = ?")
          .run(newCwd, sessionId);
        
        // Notify listeners
        cwdUpdateListeners.forEach((listener) => listener(sessionId, newCwd));
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

    // Only clean up the node-pty wrapper — the dtach session lives on
    session.listeners.clear();
    session.headless.dispose();
    session.commandTracker.dispose();
    ptySessions.delete(sessionId);
  });

  return session.process;
}

export function getPty(sessionId: string): pty.IPty | undefined {
  return ptySessions.get(sessionId)?.process;
}

/**
 * Get the headless terminal wrapper for structured state access.
 * Returns undefined if no PTY is attached for this session.
 */
export function getHeadless(sessionId: string): HeadlessTerminalWrapper | undefined {
  return ptySessions.get(sessionId)?.headless;
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
  const safeLimit = clamp(
    typeof options?.limit === "number" ? options.limit : DEFAULT_OUTPUT_LIMIT,
    1,
    MAX_TERMINAL_OUTPUT_EVENTS,
  );

  let safeSince = 0;
  if (typeof options?.since === "number") {
    if (options.since < 0) {
      const maxIndexObj = terminalOutputCursor.get(sessionId) as { max_index: number } | undefined;
      const maxIndex = maxIndexObj?.max_index ?? -1;
      safeSince = Math.max(0, maxIndex - safeLimit + 1);
    } else {
      safeSince = Math.max(0, Math.floor(options.since));
    }
  } else {
    // If since is omitted, fetch the tail
    const maxIndexObj = terminalOutputCursor.get(sessionId) as { max_index: number } | undefined;
    const maxIndex = maxIndexObj?.max_index ?? -1;
    safeSince = Math.max(0, maxIndex - safeLimit + 1);
  }

  try {
    return terminalOutputByCursor.all(
      sessionId,
      safeSince,
      safeLimit,
    ) as TerminalOutputChunk[];
  } catch {
    const session = ptySessions.get(sessionId);
    if (!session) return [];

    const end = Math.min(session.output.length, safeSince + safeLimit);
    return session.output
      .slice(safeSince, end)
      .map((data, index): TerminalOutputChunk => ({ index: safeSince + index, data }));
  }
}

export function getTerminalOutputCursor(sessionId: string): number {
  return getTerminalOutputCursorFromDb(sessionId);
}

export function searchTerminalOutput(
  sessionId: string,
  query: string | undefined,
  options?: {
    limit?: number;
    start?: number;
    end?: number;
    padMinutes?: number;
  },
) {
  const safeLimit = clamp(typeof options?.limit === "number" ? options.limit : 40, 1, 500);

  const hasQuery = Boolean(query && query.trim());
  const hasTimeFilter = options?.start !== undefined && options?.end !== undefined;

  if (!hasQuery && !hasTimeFilter) return [];

  const ranges = hasTimeFilter
    ? buildPaddedTimeRanges(options!.start!, options!.end!, options?.padMinutes ?? 15)
    : null;

  const escaped = hasQuery ? escapeLikePattern(query!.trim()) : "";
  const likePattern = hasQuery ? `%${escaped}%` : null;

  try {
    if (hasTimeFilter && ranges) {
      if (ranges.length === 2) {
        if (hasQuery) {
          return db.prepare(`
            SELECT chunk_index AS "index", data, created_at
            FROM terminal_output_events
            WHERE session_id = ?
              AND (${TIME_OF_DAY_SECONDS_EXPR} BETWEEN ? AND ? OR ${TIME_OF_DAY_SECONDS_EXPR} BETWEEN ? AND ?)
              AND data LIKE ? ESCAPE '\\'
            ORDER BY chunk_index ASC
            LIMIT ?
          `).all(
            sessionId,
            ranges[0][0],
            ranges[0][1],
            ranges[1][0],
            ranges[1][1],
            likePattern,
            safeLimit,
          ) as TerminalOutputChunk[];
        }
        return terminalOutputByTimeRanges.all(
          sessionId,
          ranges[0][0],
          ranges[0][1],
          ranges[1][0],
          ranges[1][1],
          safeLimit,
        ) as TerminalOutputChunk[];
      }

      if (hasQuery) {
        return db.prepare(`
          SELECT chunk_index AS "index", data, created_at
          FROM terminal_output_events
          WHERE session_id = ?
            AND ${TIME_OF_DAY_SECONDS_EXPR} BETWEEN ? AND ?
            AND data LIKE ? ESCAPE '\\'
          ORDER BY chunk_index ASC
          LIMIT ?
        `).all(
          sessionId,
          ranges[0][0],
          ranges[0][1],
          likePattern,
          safeLimit,
        ) as TerminalOutputChunk[];
      }
      return terminalOutputByTime.all(
        sessionId,
        ranges[0][0],
        ranges[0][1],
        safeLimit,
      ) as TerminalOutputChunk[];
    }

    return terminalOutputSearch.all(
      sessionId,
      likePattern,
      safeLimit,
    ) as TerminalOutputChunk[];
  } catch {
    return [];
  }
}

/**
 * Detach the node-pty wrapper from a session.
 * The underlying dtach session remains alive for re-attachment.
 */
export function detachPty(sessionId: string): void {
  const session = ptySessions.get(sessionId);
  if (!session) return;

  session.process.kill();
  session.listeners.clear();
  session.headless.dispose();
  session.commandTracker.dispose();
  if (session.resumeDebounce) clearTimeout(session.resumeDebounce);
  ptySessions.delete(sessionId);
}

/**
 * Fully destroy a session — kill the dtach session and clean up.
 * Used when the user explicitly deletes a session or the kill timer fires.
 */
export function destroyPty(sessionId: string): void {
  detachPty(sessionId);
  killDtachSession(sessionId);
  cancelKillTimer(sessionId);
}

/**
 * Kill all ANT-owned dtach sessions. Nuclear option.
 */
export function destroyAllPtys(): number {
  let count = 0;

  // Destroy tracked sessions
  for (const sid of Array.from(ptySessions.keys())) {
    destroyPty(sid);
    count++;
  }

  // Also kill any orphaned dtach sessions from previous server runs
  for (const sessionId of listAntDtachSessions()) {
    if (!ptySessions.has(sessionId)) {
      killDtachSession(sessionId);
      count++;
    }
  }

  return count;
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const session = ptySessions.get(sessionId);
  if (!session) return;
  const safeCols = clamp(cols, 1, 500);
  const safeRows = clamp(rows, 1, 200);
  session.process.resize(safeCols, safeRows);
  session.headless.resize(safeCols, safeRows);
}

// ---------------------------------------------------------------------------
// Connection-based lifecycle
// ---------------------------------------------------------------------------

/**
 * Start a kill timer with a specific duration (ms).
 */
export function startKillTimerWithDuration(sessionId: string, durationMs: number): void {
  cancelKillTimer(sessionId);
  const safeDuration = Math.max(0, durationMs);
  const timer = setTimeout(() => {
    killTimers.delete(sessionId);
    console.log(`[pty-manager] Kill timer expired for session ${sessionId} — destroying dtach session`);
    destroyPty(sessionId);
  }, safeDuration);
  killTimers.set(sessionId, timer);
}

/**
 * Get the effective TTL for a session in milliseconds.
 * Returns null if the session is set to "always on" (ttl_minutes = 0).
 */
function getSessionTtlMs(sessionId: string): number | null {
  try {
    const session = db.prepare("SELECT ttl_minutes FROM sessions WHERE id = ?").get(sessionId) as { ttl_minutes: number | null } | undefined;
    if (session?.ttl_minutes === 0) return null; // Always on
    if (session?.ttl_minutes != null && session.ttl_minutes > 0) return session.ttl_minutes * 60 * 1000;
  } catch {
    // Fall through to default
  }
  return SESSION_TTL_MS;
}

/**
 * Called when the last WebSocket client disconnects from a terminal session.
 * Starts the grace-period countdown. Skips if session is "always on".
 */
export function startKillTimer(sessionId: string): void {
  const ttlMs = getSessionTtlMs(sessionId);
  if (ttlMs === null) {
    // Always on — no kill timer
    console.log(`[pty-manager] Session ${sessionId} is always-on — skipping kill timer`);
    return;
  }
  startKillTimerWithDuration(sessionId, ttlMs);
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
 * Returns true if a dtach session exists for this ANT session
 * (even if no node-pty wrapper is attached).
 */
export function hasSession(sessionId: string): boolean {
  return dtachSessionExists(sessionId);
}

/** @deprecated Use hasSession() — kept for backward compatibility */
export function hasTmuxSession(sessionId: string): boolean {
  return hasSession(sessionId);
}
// ---------------------------------------------------------------------------
// Command lifecycle listeners
// ---------------------------------------------------------------------------

type CommandLifecycleListener = (event: string, sessionId: string, data: any) => void;
const commandListeners = new Set<CommandLifecycleListener>();

export function onCommandLifecycle(listener: CommandLifecycleListener): () => void {
  commandListeners.add(listener);
  return () => { commandListeners.delete(listener); };
}

/**
 * Get the command tracker for a session.
 */
export function getCommandTracker(sessionId: string): CommandTracker | undefined {
  return ptySessions.get(sessionId)?.commandTracker;
}

type CwdUpdateListener = (sessionId: string, cwd: string) => void;
const cwdUpdateListeners = new Set<CwdUpdateListener>();

export function onCwdUpdate(listener: CwdUpdateListener): () => void {
  cwdUpdateListeners.add(listener);
  return () => {
    cwdUpdateListeners.delete(listener);
  };
}

/**
 * Check if a terminal session is alive.
 * Returns true if the dtach socket exists or a node-pty wrapper is active.
 */
export function checkSessionHealth(sessionId: string): boolean {
  return dtachSessionExists(sessionId) || ptySessions.has(sessionId);
}


// ---------------------------------------------------------------------------
// Startup reaping — re-adopt or kill orphaned dtach sessions
// ---------------------------------------------------------------------------

/**
 * Read how long the server has been down by checking shutdown/heartbeat
 * timestamps in the server_state table. Returns elapsed ms, or null if
 * no data exists (first run, or DB cleared).
 */
function getServerDowntime(): number | null {
  try {
    const shutdownRow = db.prepare(
      "SELECT value FROM server_state WHERE key = 'last_shutdown'"
    ).get() as { value: string } | undefined;

    const heartbeatRow = db.prepare(
      "SELECT value FROM server_state WHERE key = 'last_heartbeat'"
    ).get() as { value: string } | undefined;

    // Prefer last_shutdown (graceful). Fall back to last_heartbeat (crash).
    const timestamp = shutdownRow?.value || heartbeatRow?.value;
    if (!timestamp) return null;

    const downSince = new Date(timestamp).getTime();
    if (isNaN(downSince)) return null;

    return Date.now() - downSince;
  } catch {
    return null;
  }
}

/**
 * Called once at server startup. For each orphaned ANT dtach session,
 * calculate the remaining TTL based on how long the server was down.
 * If the server restarted quickly, sessions get the remaining time.
 * If it was down longer than TTL, sessions are killed immediately.
 */
export function reapOrphanedSessions(): void {
  const orphanedSessionIds = listAntDtachSessions();
  if (orphanedSessionIds.length === 0) return;

  const elapsed = getServerDowntime();

  for (const sessionId of orphanedSessionIds) {
    const ttlMs = getSessionTtlMs(sessionId);

    if (ttlMs === null) {
      // Always-on session — never kill
      console.log(`[pty-manager] Orphan ${sessionId} — always-on, skipping kill timer`);
      continue;
    }

    if (elapsed === null) {
      // No downtime data (first run or DB cleared) — full TTL
      console.log(`[pty-manager] Orphan ${sessionId} — no downtime data, full ${ttlMs / 1000}s timer`);
      startKillTimerWithDuration(sessionId, ttlMs);
    } else if (elapsed >= ttlMs) {
      // Server was down longer than TTL — kill immediately
      console.log(`[pty-manager] Orphan ${sessionId} — server was down ${Math.round(elapsed / 1000)}s (>TTL), destroying`);
      destroyPty(sessionId);
    } else {
      // Server was down less than TTL — use remaining time
      const remaining = ttlMs - elapsed;
      console.log(`[pty-manager] Orphan ${sessionId} — ${Math.round(remaining / 1000)}s remaining on kill timer`);
      startKillTimerWithDuration(sessionId, remaining);
    }
  }
}
