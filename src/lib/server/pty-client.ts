// ANT PTY Client — connects to the persistent pty-daemon via Unix socket
// The web server uses this instead of managing PTYs directly, so server
// restarts don't kill running terminal sessions.

import * as net from 'net';
import { join } from 'path';
import { spawn } from 'child_process';
import { existsSync } from 'fs';

const SOCK_PATH = join(process.env.HOME || '/tmp', '.ant', 'pty.sock');
const DAEMON_BIN = join(process.cwd(), 'src/lib/server/pty-daemon.ts');

type DataCallback = (sessionId: string, data: string) => void;

class PTYClient {
  private socket: net.Socket | null = null;
  private connected = false;
  private queue: string[] = [];
  private buf = '';
  private dataListeners: DataCallback[] = [];
  private pendingSpawns = new Map<string, (result: any) => void>();

  async ensureDaemon(): Promise<void> {
    // Quick ping to see if daemon is up
    const alive = await this.ping();
    if (alive) return;

    console.log('[pty-client] daemon not running — starting it');
    // Use node + tsx — node-pty's native addon works correctly under Node but not Bun
    const tsxLoader = join(process.cwd(), 'node_modules/tsx/dist/esm/index.mjs');
    const proc = spawn('node', ['--import', tsxLoader, DAEMON_BIN], {
      detached: true,
      stdio: 'ignore',
      env: { ...process.env },
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
          } else if (msg.type === 'spawned') {
            this.pendingSpawns.get(msg.sessionId)?.(msg);
            this.pendingSpawns.delete(msg.sessionId);
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
    }
  }

  onData(callback: DataCallback): () => void {
    this.dataListeners.push(callback);
    return () => { this.dataListeners = this.dataListeners.filter(cb => cb !== callback); };
  }

  spawn(sessionId: string, cwd: string, cols = 120, rows = 30): Promise<{ alive: boolean; scrollback: string }> {
    return new Promise((resolve) => {
      this.pendingSpawns.set(sessionId, resolve);
      this.send({ type: 'spawn', sessionId, cwd, cols, rows });
      // Timeout after 5s
      setTimeout(() => {
        if (this.pendingSpawns.has(sessionId)) {
          this.pendingSpawns.delete(sessionId);
          resolve({ alive: false, scrollback: '' });
        }
      }, 5000);
    });
  }

  write(sessionId: string, data: string): void {
    this.send({ type: 'write', sessionId, data });
  }

  resize(sessionId: string, cols: number, rows: number): void {
    this.send({ type: 'resize', sessionId, cols, rows });
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
