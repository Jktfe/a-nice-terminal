/**
 * ptyClient — Unix-socket client for the v3 pty-daemon at ~/.ant/pty.sock.
 * fresh-ANT terminals are HOSTED by v3's daemon (Option A per
 * terminals-backend-design-contract 2026-05-14 Q1) so server restarts
 * don't kill running tmux sessions. globalThis singleton survives HMR.
 *
 * Protocol mirrors v3 src/lib/server/pty-client.ts: newline-delimited JSON
 * over Unix socket. Outgoing verbs: spawn, write, resize, kill, list, ping.
 * Incoming events: spawned (callId), output, list (callId).
 */

import * as net from 'net';
import { join } from 'node:path';

const SOCK_PATH = join(process.env.HOME || '/tmp', '.ant', 'pty.sock');

type OutputCb = (sessionId: string, data: string) => void;
type SpawnResult = { alive: boolean; scrollback?: string };

type State = {
  socket: net.Socket | null;
  connected: boolean;
  queue: string[];
  buf: string;
  outputCbs: Set<OutputCb>;
  pendingSpawns: Map<string, (r: SpawnResult) => void>;
  // v3 daemon's `list` response does NOT echo callId, so match FIFO.
  pendingLists: Array<(r: string[]) => void>;
  spawnCounter: number;
};

function getStore(): State {
  const g = globalThis as unknown as { __antPtyClient?: State };
  if (!g.__antPtyClient) {
    g.__antPtyClient = {
      socket: null, connected: false, queue: [], buf: '',
      outputCbs: new Set(), pendingSpawns: new Map(), pendingLists: [],
      spawnCounter: 0
    };
  }
  return g.__antPtyClient;
}

function ensureConnected(): void {
  const s = getStore();
  if (s.socket) return;
  const sock = net.createConnection(SOCK_PATH);
  s.socket = sock;
  sock.on('connect', () => {
    s.connected = true;
    for (const msg of s.queue) sock.write(msg);
    s.queue = [];
  });
  sock.on('data', (chunk) => {
    s.buf += chunk.toString();
    const lines = s.buf.split('\n');
    s.buf = lines.pop()!;
    for (const line of lines) {
      if (!line.trim()) continue;
      try {
        const msg = JSON.parse(line);
        if (msg.type === 'output' && typeof msg.sessionId === 'string') {
          for (const cb of s.outputCbs) { try { cb(msg.sessionId, String(msg.data ?? '')); } catch { /* swallow */ } }
        } else if (msg.type === 'spawned') {
          const key = `${msg.sessionId}:${msg.callId}`;
          s.pendingSpawns.get(key)?.({ alive: !!msg.alive, scrollback: msg.scrollback ?? '' });
          s.pendingSpawns.delete(key);
        } else if (msg.type === 'list') {
          // v3 daemon doesn't echo callId on list — resolve oldest pending FIFO.
          const sessions = Array.isArray(msg.sessions) ? msg.sessions : [];
          const resolver = s.pendingLists.shift();
          resolver?.(sessions);
        }
      } catch { /* malformed line */ }
    }
  });
  sock.on('close', () => { s.connected = false; s.socket = null; setTimeout(ensureConnected, 1000); });
  sock.on('error', () => { s.connected = false; s.socket = null; });
}

function send(msg: object): void {
  const line = JSON.stringify(msg) + '\n';
  const s = getStore();
  if (s.connected && s.socket) s.socket.write(line);
  else { s.queue.push(line); ensureConnected(); }
}

export function spawnTerminal(sessionId: string, opts: { cwd?: string; cols?: number; rows?: number } = {}): Promise<SpawnResult> {
  const s = getStore();
  const callId = ++s.spawnCounter;
  const key = `${sessionId}:${callId}`;
  return new Promise((resolve) => {
    s.pendingSpawns.set(key, resolve);
    send({ type: 'spawn', sessionId, cwd: opts.cwd ?? process.env.HOME, cols: opts.cols ?? 120, rows: opts.rows ?? 30, callId });
    setTimeout(() => { if (s.pendingSpawns.delete(key)) resolve({ alive: false }); }, 5000);
  });
}

export function writeInput(sessionId: string, data: string): void { send({ type: 'write', sessionId, data }); }
export function resizeTerminal(sessionId: string, cols: number, rows: number): void { send({ type: 'resize', sessionId, cols, rows }); }
export function killTerminal(sessionId: string): void { send({ type: 'kill', sessionId }); }

export function listTerminals(): Promise<string[]> {
  const s = getStore();
  return new Promise((resolve) => {
    s.pendingLists.push(resolve);
    send({ type: 'list' });
    setTimeout(() => {
      const idx = s.pendingLists.indexOf(resolve);
      if (idx >= 0) { s.pendingLists.splice(idx, 1); resolve([]); }
    }, 2000);
  });
}

export function subscribeOutput(cb: OutputCb): () => void {
  const s = getStore();
  s.outputCbs.add(cb);
  ensureConnected();
  return () => { s.outputCbs.delete(cb); };
}
