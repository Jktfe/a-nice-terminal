import * as pty from "node-pty";
import os from "os";

interface PtySession {
  process: pty.IPty;
  sessionId: string;
  output: string[];
  listeners: Set<(data: string) => void>;
}

type TerminalOutputListener = (data: string) => void;

interface TerminalOutputChunk {
  index: number;
  data: string;
}

const ptySessions = new Map<string, PtySession>();
const MAX_TERMINAL_OUTPUT_EVENTS = 5000;
const DEFAULT_OUTPUT_LIMIT = 250;

const defaultShell =
  process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");

const ALLOWED_SHELLS = [
  "bash",
  "zsh",
  "sh",
  "fish",
  "dash",
  "ksh",
  "tcsh",
  "powershell.exe",
  "cmd.exe",
  "/bin/bash",
  "/bin/zsh",
  "/bin/sh",
  "/bin/fish",
  "/bin/dash",
  "/usr/bin/bash",
  "/usr/bin/zsh",
  "/usr/bin/fish",
  "/usr/local/bin/bash",
  "/usr/local/bin/zsh",
  "/usr/local/bin/fish",
];

function safeEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  const passthrough = ["PATH", "HOME", "SHELL", "USER", "LOGNAME", "LANG", "LC_ALL", "LC_CTYPE", "TERM_PROGRAM", "COLORTERM"];
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

export function createPty(sessionId: string, shell?: string | null): pty.IPty {
  if (ptySessions.has(sessionId)) {
    return ptySessions.get(sessionId)!.process;
  }

  if (shell && !ALLOWED_SHELLS.includes(shell)) {
    throw new Error(`Shell not allowed: ${shell}`);
  }

  const ptyProcess = pty.spawn(shell || defaultShell, [], {
    name: "xterm-256color",
    cols: 120,
    rows: 30,
    cwd: process.env.HOME || process.cwd(),
    env: safeEnv(),
  });

  const session: PtySession = {
    process: ptyProcess,
    sessionId,
    output: [],
    listeners: new Set(),
  };
  ptySessions.set(sessionId, session);

  ptyProcess.onData((data: string) => {
    session.output.push(data);
    if (session.output.length > MAX_TERMINAL_OUTPUT_EVENTS) {
      session.output = session.output.slice(-MAX_TERMINAL_OUTPUT_EVENTS);
    }
    session.listeners.forEach((listener) => listener(data));
  });

  ptyProcess.onExit(() => {
    destroyPty(sessionId);
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
  listener: TerminalOutputListener
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
  options?: { since?: number; limit?: number }
) {
  const session = ptySessions.get(sessionId);
  if (!session) return [];

  const safeSince = Math.max(0, Math.floor(options?.since || 0));
  const safeLimit = clamp(
    typeof options?.limit === "number" ? options.limit : DEFAULT_OUTPUT_LIMIT,
    1,
    MAX_TERMINAL_OUTPUT_EVENTS
  );

  const end = Math.min(session.output.length, safeSince + safeLimit);
  return session.output
    .slice(safeSince, end)
    .map((data, index): TerminalOutputChunk => ({ index: safeSince + index, data }));
}

export function getTerminalOutputCursor(sessionId: string): number {
  return ptySessions.get(sessionId)?.output.length || 0;
}

export function destroyPty(sessionId: string): void {
  const session = ptySessions.get(sessionId);
  if (!session) return;

  session.process.kill();
  session.listeners.clear();
  ptySessions.delete(sessionId);
}

export function resizePty(sessionId: string, cols: number, rows: number): void {
  const session = ptySessions.get(sessionId);
  if (!session) return;
  session.process.resize(clamp(cols, 1, 500), clamp(rows, 1, 200));
}
