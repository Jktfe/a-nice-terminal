// ANT v3 — PTY Manager
// Manages terminal sessions via node-pty with WebSocket bridging

import * as pty from 'node-pty';
import { nanoid } from 'nanoid';
import stripAnsi from 'strip-ansi';

const SCROLLBACK_LIMIT = 256 * 1024; // 256 KB per session

export interface PTYSession {
  id: string;
  sessionId: string;  // DB session ID
  pty: pty.IPty;
  cwd: string;
  alive: boolean;
  createdAt: Date;
  scrollback: string; // raw ANSI output ring buffer
}

type DataCallback = (sessionId: string, data: string) => void;

class PTYManager {
  private sessions = new Map<string, PTYSession>();
  private dataListeners: DataCallback[] = [];

  /** Register a listener for all terminal output (for WebSocket broadcast) */
  onData(callback: DataCallback): () => void {
    this.dataListeners.push(callback);
    return () => {
      this.dataListeners = this.dataListeners.filter(cb => cb !== callback);
    };
  }

  /** Spawn a new PTY session */
  spawn(sessionId: string, cwd: string = process.env.HOME || '/tmp'): PTYSession {
    const shell = process.env.SHELL || '/bin/zsh';

    const terminal = pty.spawn(shell, [], {
      name: 'xterm-256color',
      cols: 120,
      rows: 30,
      cwd,
      env: {
        ...process.env,
        TERM: 'xterm-256color',
        COLORTERM: 'truecolor',
      } as Record<string, string>,
    });

    const session: PTYSession = {
      id: nanoid(),
      sessionId,
      pty: terminal,
      cwd,
      alive: true,
      createdAt: new Date(),
      scrollback: '',
    };

    // Forward output to all listeners and accumulate scrollback
    terminal.onData((data: string) => {
      // Append to scrollback, trim oldest bytes if over limit
      session.scrollback += data;
      if (session.scrollback.length > SCROLLBACK_LIMIT) {
        session.scrollback = session.scrollback.slice(session.scrollback.length - SCROLLBACK_LIMIT);
      }
      for (const cb of this.dataListeners) {
        try { cb(sessionId, data); } catch {}
      }
    });

    terminal.onExit(() => {
      session.alive = false;
    });

    this.sessions.set(sessionId, session);
    return session;
  }

  /** Write data to a terminal (user input) */
  write(sessionId: string, data: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.alive) return false;
    session.pty.write(data);
    return true;
  }

  /** Resize a terminal */
  resize(sessionId: string, cols: number, rows: number): boolean {
    const session = this.sessions.get(sessionId);
    if (!session?.alive) return false;
    session.pty.resize(cols, rows);
    return true;
  }

  /** Kill a terminal session */
  kill(sessionId: string): boolean {
    const session = this.sessions.get(sessionId);
    if (!session) return false;
    session.pty.kill();
    session.alive = false;
    this.sessions.delete(sessionId);
    return true;
  }

  /** Get session info */
  get(sessionId: string): PTYSession | undefined {
    return this.sessions.get(sessionId);
  }

  /** Get buffered output for replay to a reconnecting client */
  getScrollback(sessionId: string): string {
    return this.sessions.get(sessionId)?.scrollback ?? '';
  }

  /** Check if a session is alive */
  isAlive(sessionId: string): boolean {
    return this.sessions.get(sessionId)?.alive ?? false;
  }

  /** Get all active session IDs */
  activeSessions(): string[] {
    return Array.from(this.sessions.entries())
      .filter(([_, s]) => s.alive)
      .map(([id]) => id);
  }

  /** Kill all sessions (for graceful shutdown) */
  killAll(): void {
    for (const [id] of this.sessions) {
      this.kill(id);
    }
  }
}

// Singleton instance
export const ptyManager = new PTYManager();
