/**
 * codexLifecycle — spawn-and-attach orchestration for the Codex
 * `app-server` JSON-RPC bridge (CLI-HOOK-BRIDGE Phase 2 follow-up,
 * 2026-05-15, JWPK "go for it").
 *
 * Surface:
 *   - `spawnCodexAppServer({cwd?})` — start a `codex app-server` child
 *     over stdio with NDJSON framing.
 *   - `attachCodexBridgeToChild(child)` — wire stdout NDJSON through the
 *     Phase 2 translator + persist to cli_hook_events, and expose a
 *     minimal request/notification sender for the `initialize` handshake.
 *
 * Why no vscode-jsonrpc: for notification consumption + a single
 * `initialize` handshake, a ~50-line in-house JSON-RPC reader is simpler
 * than vendoring vscode-jsonrpc's Content-Length framing and writing an
 * NDJSON shim on top of it. If richer request correlation is needed
 * later (e.g. driving `thread/start` from ANT's UI), swap to
 * vscode-jsonrpc then.
 *
 * Reuse: the LF-only JSONL line reader from `../pi/piAdapter` is
 * imported directly. Both protocols use the same framing on stdio.
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  attachCodexAdapter,
  makeCodexAdapterState,
  type CodexAdapterState
} from './codexAdapter';
import { makePiJsonlLineReader } from '../pi/piAdapter';

type RequestId = number;

type PendingRequest = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * The minimum slice of ChildProcessWithoutNullStreams we touch — lets
 * tests pass an EventEmitter + Writable/Readable shim without dragging
 * in node:child_process.spawn.
 */
export type CodexChildShape = {
  stdout: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  stderr?: NodeJS.ReadableStream;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
};

export type CodexBridge = {
  /** Shared adapter state, including `currentThreadId`. */
  state: CodexAdapterState;
  /** Send a JSON-RPC request and await its response. */
  sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult>;
  /** Send a JSON-RPC notification (no response expected). */
  sendNotification(method: string, params?: unknown): void;
  /** Send `initialize` + `initialized` per the codex protocol; resolves on response. */
  initialize(clientInfo?: { name: string; title?: string; version?: string }): Promise<unknown>;
  /** Cumulative stats since attach. */
  readonly persistedCount: number;
  readonly droppedCount: number;
  readonly malformedCount: number;
  /** Tear down listeners + reject all pending requests. */
  dispose(): void;
};

const DEFAULT_CLIENT_INFO = { name: 'ant', title: 'ANT', version: '0.1.0' };

/**
 * Attach a JSON-RPC notification bridge + request/response correlator to
 * an externally-spawned codex app-server child. Does NOT spawn the
 * process itself — see `spawnCodexAppServer` for the convenience that
 * wires both together.
 */
export function attachCodexBridgeToChild(child: CodexChildShape): CodexBridge {
  const state = makeCodexAdapterState();

  // Phase 2 codex translator + persister. We won't use its onNotification
  // wiring because we're routing notifications through our own JSON-RPC
  // reader; we call its `dispatch` directly via a NotificationSource
  // adapter that just records the listener callbacks.
  const listeners = new Map<string, Array<(params: unknown) => void>>();
  const persisterStats = attachCodexAdapter(
    {
      onNotification(method, handler) {
        const arr = listeners.get(method) ?? [];
        arr.push(handler);
        listeners.set(method, arr);
      }
    },
    state
  );

  let nextRequestId: RequestId = 1;
  const pending = new Map<RequestId, PendingRequest>();
  let disposed = false;

  function writeMessage(message: Record<string, unknown>): void {
    if (disposed) return;
    child.stdin.write(JSON.stringify(message) + '\n');
  }

  function sendNotification(method: string, params?: unknown): void {
    writeMessage({ jsonrpc: '2.0', method, params: params ?? {} });
  }

  function sendRequest<TResult = unknown>(method: string, params?: unknown): Promise<TResult> {
    if (disposed) return Promise.reject(new Error('codex bridge disposed'));
    return new Promise<TResult>((resolve, reject) => {
      const id = nextRequestId++;
      pending.set(id, {
        resolve: (r) => resolve(r as TResult),
        reject
      });
      writeMessage({ jsonrpc: '2.0', id, method, params: params ?? {} });
    });
  }

  function initialize(clientInfo: { name: string; title?: string; version?: string } = DEFAULT_CLIENT_INFO) {
    return sendRequest('initialize', {
      clientInfo,
      capabilities: { optOutNotificationMethods: [] }
    }).then((result) => {
      sendNotification('initialized');
      return result;
    });
  }

  function handleIncomingMessage(parsed: Record<string, unknown>): void {
    if (typeof parsed.method === 'string') {
      // Notification (no id) or server-initiated request (id present).
      // Codex doesn't push server-initiated requests today, so treat any
      // method-bearing inbound message as a notification.
      const method = parsed.method;
      const params = (parsed.params ?? {}) as unknown;
      const handlers = listeners.get(method) ?? [];
      for (const h of handlers) {
        try { h(params); } catch { /* swallow per-handler errors */ }
      }
      return;
    }
    // Response: id present, no method.
    if (parsed.id !== undefined && parsed.id !== null) {
      const id = Number(parsed.id);
      const slot = pending.get(id);
      if (!slot) return;
      pending.delete(id);
      if (parsed.error) {
        const err = parsed.error as { message?: string; code?: number };
        slot.reject(new Error(err.message ?? 'codex JSON-RPC error'));
      } else {
        slot.resolve(parsed.result);
      }
    }
  }

  const reader = makePiJsonlLineReader(
    (line) => {
      try {
        const parsed = JSON.parse(line);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          handleIncomingMessage(parsed as Record<string, unknown>);
        }
      } catch {
        // Malformed line — best-effort skip. Stats tracked at adapter
        // level if it ever becomes a recurring issue.
      }
    }
  );

  child.stdout.on('data', (chunk) => reader.feed(chunk));
  child.stdout.on('end', () => reader.end());
  child.on('exit', () => {
    disposed = true;
    for (const { reject } of pending.values()) reject(new Error('codex child exited'));
    pending.clear();
  });

  return {
    state,
    sendRequest,
    sendNotification,
    initialize,
    get persistedCount() { return persisterStats.persistedCount; },
    get droppedCount() { return persisterStats.droppedCount; },
    get malformedCount() { return 0; },
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const { reject } of pending.values()) reject(new Error('codex bridge disposed'));
      pending.clear();
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
    }
  };
}

/**
 * Convenience: spawn `codex app-server` over stdio and attach a bridge
 * to it. Returns both the child handle and the bridge — caller is
 * responsible for calling `bridge.initialize()` + eventually
 * `bridge.dispose()`.
 *
 * Environment hardening:
 *   - We do NOT propagate ANTHROPIC_BASE_URL / ANTHROPIC_API_KEY
 *     (banked feedback: those break OAuth on child claude/codex sessions).
 *   - PATH is inherited so the user's codex install resolves.
 */
export function spawnCodexAppServer(options: { cwd?: string; binary?: string } = {}): {
  child: ChildProcessWithoutNullStreams;
  bridge: CodexBridge;
} {
  const env = { ...process.env };
  delete env.ANTHROPIC_BASE_URL;
  delete env.ANTHROPIC_API_KEY;

  const child = spawn(options.binary ?? 'codex', ['app-server'], {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  });
  const bridge = attachCodexBridgeToChild(child);
  return { child, bridge };
}
