// ANT PTY Client — connects to the persistent pty-daemon via Unix socket
// The web server uses this instead of managing PTYs directly, so server
// restarts don't kill running terminal sessions.

import * as net from 'net';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const SOCK_PATH = join(process.env.HOME || '/tmp', '.ant', 'pty.sock');
const DAEMON_BIN = join(process.cwd(), 'src/lib/server/pty-daemon.ts');

type DataCallback    = (sessionId: string, data: string) => void;
type SilenceCallback = (sessionId: string, isPrompt: boolean, text: string) => void;
export type TerminalEvent = {
  sessionId: string;
  ts: number;
  kind: string;
  data: Record<string, unknown>;
};
type EventCallback = (event: TerminalEvent) => void;
type LineCallback = (sessionId: string, text: string) => void;
type StatusSampleCallback = (sessionId: string, text: string) => void;

class PTYClient {
  private socket: net.Socket | null = null;
  private connected = false;
  private queue: string[] = [];
  private buf = '';
  private dataListeners: DataCallback[] = [];
  private silenceListeners: SilenceCallback[] = [];
  private eventListeners: EventCallback[] = [];
  private lineListeners: LineCallback[] = [];
  private statusSampleListeners: StatusSampleCallback[] = [];
  // Keyed by "sessionId:callId" to prevent concurrent callers clobbering each other
  private pendingSpawns   = new Map<string, (result: any) => void>();
  private pendingCaptures = new Map<string, (result: any) => void>();
  private pendingTitles   = new Map<string, (result: any) => void>();
  private spawnCallCounter   = 0;
  private captureCallCounter = 0;
  private titleCallCounter   = 0;

  async ensureDaemon(): Promise<void> {
    // Quick ping to see if daemon is up
    const alive = await this.ping();
    if (alive) return;

    console.log('[pty-client] daemon not running — starting it');
    // Use node + tsx — node-pty's native addon works correctly under Node but not Bun
    const tsxLoader = join(process.cwd(), 'node_modules/tsx/dist/esm/index.mjs');
    // Strip $TMUX from the daemon's env. If we're nested inside an existing
    // tmux session, the daemon and every tmux it spawns will inherit $TMUX
    // and refuse to nest, killing newly-created sessions silently.
    const daemonEnv: Record<string, string> = { ...process.env } as Record<string, string>;
    delete daemonEnv.TMUX;
    delete daemonEnv.TMUX_PANE;
    const proc = spawn('node', ['--import', tsxLoader, DAEMON_BIN], {
      detached: true,
      stdio: 'ignore',
      env: daemonEnv,
    });
    proc.unref(); // Let it outlive this process

    // Wait for socket to appear
    for (let i = 0; i < 20; i++) {
      await new Promise(r => setTimeout(r, 150));
      if (existsSync(SOCK_PATH) && await this.ping()) return;
    }
    console.warn('[pty-client] daemon did not start in time');
  }

  private ping(): Promise<boolean> {
    return new Promise((resolve) => {
      if (!existsSync(SOCK_PATH)) { resolve(false); return; }
      const s = net.createConnection(SOCK_PATH);
      s.on('connect', () => { s.write(JSON.stringify({ type: 'ping' }) + '\n'); });
      s.on('data', (d) => {
        try {
          const msg = JSON.parse(d.toString().trim().split('\n')[0]);
          if (msg.type === 'pong') { s.destroy(); resolve(true); }
        } catch { s.destroy(); resolve(false); }
      });
      s.on('error', () => resolve(false));
      setTimeout(() => { s.destroy(); resolve(false); }, 1000);
    });
  }

  connect(): void {
    if (this.socket) return;
    const s = net.createConnection(SOCK_PATH);
    this.socket = s;

    s.on('connect', () => {
      this.connected = true;
      console.log('[pty-client] connected to daemon');
      for (const msg of this.queue) s.write(msg);
      this.queue = [];
    });

    s.on('data', (chunk) => {
      this.buf += chunk.toString();
      const lines = this.buf.split('\n');
      this.buf = lines.pop()!;
      for (const line of lines) {
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (msg.type === 'output') {
            for (const cb of this.dataListeners) {
              try { cb(msg.sessionId, msg.data); } catch {}
            }
          } else if (msg.type === 'terminal_silence') {
            for (const cb of this.silenceListeners) {
              try { cb(msg.sessionId, msg.isPrompt, msg.text); } catch {}
            }
          } else if (msg.type === 'terminal_line') {
            for (const cb of this.lineListeners) {
              try { cb(msg.sessionId, msg.text); } catch {}
            }
          } else if (msg.type === 'terminal_status_sample') {
            for (const cb of this.statusSampleListeners) {
              try { cb(msg.sessionId, msg.text); } catch {}
            }
          } else if (msg.type === 'terminal_event') {
            const event: TerminalEvent = {
              sessionId: msg.sessionId,
              ts: msg.ts ?? Date.now(),
              kind: msg.kind ?? 'unknown',
              data: msg.data ?? {},
            };
            for (const cb of this.eventListeners) {
              try { cb(event); } catch {}
            }
          } else if (msg.type === 'spawned') {
            // callId is echoed back so we resolve exactly the right pending spawn
            const key = `${msg.sessionId}:${msg.callId}`;
            this.pendingSpawns.get(key)?.(msg);
            this.pendingSpawns.delete(key);
          } else if (msg.type === 'captured') {
            const key = `${msg.sessionId}:${msg.callId}`;
            this.pendingCaptures.get(key)?.(msg);
            this.pendingCaptures.delete(key);
          } else if (msg.type === 'title') {
            const key = `${msg.sessionId}:${msg.callId}`;
            this.pendingTitles.get(key)?.(msg);
            this.pendingTitles.delete(key);
          }
        } catch {}
      }
    });

    s.on('close', () => {
      this.connected = false;
      this.socket = null;
      console.log('[pty-client] daemon disconnected — reconnecting in 1s');
      setTimeout(() => this.connect(), 1000);
    });

    s.on('error', () => {
      this.connected = false;
      this.socket = null;
      setTimeout(() => this.connect(), 1000);
    });
  }

  private send(msg: any): void {
    const line = JSON.stringify(msg) + '\n';
    if (this.connected && this.socket) {
      this.socket.write(line);
    } else {
      this.queue.push(line);
      // Auto-connect on first use. SvelteKit route handlers get a separate
      // module instance from server.ts (compiled chunk vs tsx source), so
      // their ptyClient singleton was never .connect()'d. This ensures the
      // first write triggers a connection and the queued message drains.
      if (!this.socket) this.connect();
    }
  }

  onData(callback: DataCallback): () => void {
    this.dataListeners.push(callback);
    return () => { this.dataListeners = this.dataListeners.filter(cb => cb !== callback); };
  }

  onSilence(callback: SilenceCallback): () => void {
    this.silenceListeners.push(callback);
    return () => { this.silenceListeners = this.silenceListeners.filter(cb => cb !== callback); };
  }

  onEvent(callback: EventCallback): () => void {
    this.eventListeners.push(callback);
    return () => { this.eventListeners = this.eventListeners.filter(cb => cb !== callback); };
  }

  /** Settled terminal output lines from tmux control mode (debounced, ANSI-stripped). */
  onLine(callback: LineCallback): () => void {
    this.lineListeners.push(callback);
    return () => { this.lineListeners = this.lineListeners.filter(cb => cb !== callback); };
  }

  /** Bottom pane sample before chrome stripping, used for CLI status telemetry. */
  onStatusSample(callback: StatusSampleCallback): () => void {
    this.statusSampleListeners.push(callback);
    return () => { this.statusSampleListeners = this.statusSampleListeners.filter(cb => cb !== callback); };
  }

  capture(sessionId: string, lines = 50): Promise<string> {
    const callId = ++this.captureCallCounter;
    const key = `${sessionId}:${callId}`;
    return new Promise((resolve) => {
      this.pendingCaptures.set(key, (result) => resolve(result.text ?? ''));
      this.send({ type: 'capture', sessionId, lines, callId });
      setTimeout(() => {
        if (this.pendingCaptures.has(key)) {
          this.pendingCaptures.delete(key);
          resolve('');
        }
      }, 5000);
    });
  }

  // Read the current pane_title for a session. Returns '' on timeout/no-title.
  // Used by the server's polling loop (2s) to detect OSC title updates from
  // CLIs that emit OSC 0/1/2 (claude, gemini). For CLIs that don't, we fall
  // back to the silence-hook path — this just catches the fast lane.
  title(sessionId: string): Promise<string> {
    const callId = ++this.titleCallCounter;
    const key = `${sessionId}:${callId}`;
    return new Promise((resolve) => {
      this.pendingTitles.set(key, (result) => resolve(result.title ?? ''));
      this.send({ type: 'title', sessionId, callId });
      setTimeout(() => {
        if (this.pendingTitles.has(key)) {
          this.pendingTitles.delete(key);
          resolve('');
        }
      }, 2000);
    });
  }

  spawn(sessionId: string, cwd: string, cols = 120, rows = 30): Promise<{ alive: boolean; scrollback: string }> {
    const callId = ++this.spawnCallCounter;
    const key = `${sessionId}:${callId}`;
    return new Promise((resolve) => {
      this.pendingSpawns.set(key, resolve);
      this.send({ type: 'spawn', sessionId, cwd, cols, rows, callId });
      setTimeout(() => {
        if (this.pendingSpawns.has(key)) {
          this.pendingSpawns.delete(key);
          resolve({ alive: false, scrollback: '' });
        }
      }, 5000);
    });
  }

  write(sessionId: string, data: string): void {
    this.send({ type: 'write', sessionId, data });
  }

  /** Write raw bytes to the daemon socket (used for IPC responses like is_chrome_result). */
  writeRaw(data: string): void {
    if (this.connected && this.socket) {
      this.socket.write(data);
    }
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'resize', sessionId, cols, rows });
  }

  /** Notify the daemon of a session's CLI flag so it can apply per-model line stripping. */
  setCliFlag(sessionId: string, cliFlag: string | null, stripLines = 15): void {
    this.send({ type: 'set_cli_flag', sessionId, cliFlag, stripLines });
  }

  kill(sessionId: string): void {
    this.send({ type: 'kill', sessionId });
  }

  killAll(): void {
    // For graceful server shutdown — we deliberately do NOT kill all sessions
    // The daemon keeps them alive. Only disconnect.
    this.socket?.destroy();
  }

  // Compatibility shim for code that checks isAlive synchronously
  // (returns true optimistically — daemon is the source of truth)
  isAlive(sessionId: string): boolean {
    return true;
  }

  activeSessions(): string[] {
    return []; // Not tracked client-side; ask daemon via 'list' if needed
  }
}

export const ptyClient = new PTYClient();
