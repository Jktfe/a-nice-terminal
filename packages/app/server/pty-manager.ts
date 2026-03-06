import * as pty from "node-pty";
import os from "os";

interface PtySession {
  process: pty.IPty;
  sessionId: string;
}

const ptySessions = new Map<string, PtySession>();

const defaultShell =
  process.env.SHELL || (os.platform() === "win32" ? "powershell.exe" : "bash");

const ALLOWED_SHELLS = [
  "bash", "zsh", "sh", "fish", "dash", "ksh", "tcsh", "powershell.exe", "cmd.exe",
  "/bin/bash", "/bin/zsh", "/bin/sh", "/bin/fish", "/bin/dash", "/bin/ksh", "/bin/tcsh",
  "/usr/bin/bash", "/usr/bin/zsh", "/usr/bin/fish", "/usr/local/bin/bash", "/usr/local/bin/zsh", "/usr/local/bin/fish",
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

export function createPty(sessionId: string, shell?: string): pty.IPty {
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

  ptySessions.set(sessionId, { process: ptyProcess, sessionId });

  ptyProcess.onExit(() => {
    ptySessions.delete(sessionId);
  });

  return ptyProcess;
}

export function getPty(sessionId: string): pty.IPty | undefined {
  return ptySessions.get(sessionId)?.process;
}

export function destroyPty(sessionId: string): void {
  const session = ptySessions.get(sessionId);
  if (session) {
    session.process.kill();
    ptySessions.delete(sessionId);
  }
}

export function resizePty(
  sessionId: string,
  cols: number,
  rows: number
): void {
  const session = ptySessions.get(sessionId);
  if (session) {
    session.process.resize(cols, rows);
  }
}