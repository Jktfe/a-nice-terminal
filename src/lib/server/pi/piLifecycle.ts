/**
 * piLifecycle — spawn-and-attach orchestration for `pi --mode rpc`
 * (CLI-HOOK-BRIDGE Phase 3 follow-up, 2026-05-15, JWPK "go for it").
 *
 * Surface:
 *   - `spawnPiRpc({cwd, sessionDir?})` — spawn pi as a child with the
 *     ANT-recommended flag set, environment-isolated.
 *   - `attachPiBridgeToChild(child)` — wire stdout LF-JSONL through the
 *     Phase 3 translator + persist to cli_hook_events, expose a small
 *     stdin sender for RPC commands like `get_state`.
 *
 * `get_state` is the canonical way to discover Pi's session id (events
 * themselves don't carry one — pi assumes 1:1 process : session). The
 * bridge calls `get_state` automatically on attach and stamps the
 * resolved sessionId onto the adapter state.
 *
 * Min pi version: 0.16.0 (the v0.16 release introduced the current
 * `--mode rpc` JSON protocol; pre-0.16 has an incompatible older shape).
 */

import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process';
import {
  attachPiAdapter,
  makePiAdapterState,
  makePiJsonlLineReader,
  type PiAdapterState,
  type PiRpcEvent
} from './piAdapter';

let rpcRequestCounter = 0;

function nextRpcRequestId(): string {
  rpcRequestCounter += 1;
  return `ant_${Date.now()}_${rpcRequestCounter}`;
}

export type PiChildShape = {
  stdout: NodeJS.ReadableStream;
  stdin: NodeJS.WritableStream;
  stderr?: NodeJS.ReadableStream;
  on(event: 'exit', listener: (code: number | null, signal: NodeJS.Signals | null) => void): unknown;
  kill(signal?: NodeJS.Signals): boolean;
};

export type PiRpcCommand =
  | { type: 'get_state' }
  | { type: 'prompt'; message: string; streamingBehavior?: 'steer' | 'followUp' }
  | { type: 'abort' }
  | { type: 'compact'; customInstructions?: string }
  | { type: 'new_session'; parentSession?: string }
  | { type: string; [key: string]: unknown };

export type PiBridge = {
  state: PiAdapterState;
  /** Send an RPC command. Returns a promise that resolves with pi's response. */
  sendCommand<TResult = unknown>(command: PiRpcCommand): Promise<TResult>;
  /** Tear down the bridge and SIGTERM the child. */
  dispose(): Promise<void>;
  readonly persistedCount: number;
  readonly droppedCount: number;
  readonly malformedCount: number;
};

type PendingResponse = {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
};

/**
 * Attach the bridge to an already-spawned pi --mode rpc child. Caller
 * is responsible for spawning + eventual dispose.
 *
 * On attach we kick off a `get_state` RPC to fetch pi's sessionId; once
 * resolved, the adapter starts persisting events. Events received BEFORE
 * sessionId resolves are dropped (the translator returns null for a
 * blank session id by design).
 */
export function attachPiBridgeToChild(child: PiChildShape): PiBridge {
  const state = makePiAdapterState();
  const adapter = attachPiAdapter(state);

  const pendingResponses = new Map<string, PendingResponse>();
  let disposed = false;

  function writeStdinLine(payload: Record<string, unknown>): void {
    if (disposed) return;
    child.stdin.write(JSON.stringify(payload) + '\n');
  }

  function sendCommand<TResult = unknown>(command: PiRpcCommand): Promise<TResult> {
    if (disposed) return Promise.reject(new Error('pi bridge disposed'));
    return new Promise<TResult>((resolve, reject) => {
      const id = nextRpcRequestId();
      pendingResponses.set(id, {
        resolve: (r) => resolve(r as TResult),
        reject
      });
      writeStdinLine({ id, ...command });
    });
  }

  function handleStdoutLine(line: string): void {
    try {
      const parsed = JSON.parse(line);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return;
      const message = parsed as Record<string, unknown>;
      if ('id' in message) {
        // RPC response (correlated by id).
        const id = String(message.id);
        const slot = pendingResponses.get(id);
        if (!slot) return;
        pendingResponses.delete(id);
        if (message.error) {
          const err = message.error as { message?: string };
          slot.reject(new Error(err.message ?? 'pi RPC error'));
        } else {
          slot.resolve((message as { result?: unknown }).result);
        }
        return;
      }
      // Event push.
      adapter.dispatchEvent(message as PiRpcEvent);
    } catch {
      // Skip malformed lines.
    }
  }

  const reader = makePiJsonlLineReader(handleStdoutLine);
  child.stdout.on('data', (chunk) => reader.feed(chunk));
  child.stdout.on('end', () => reader.end());
  child.on('exit', () => {
    disposed = true;
    for (const slot of pendingResponses.values()) slot.reject(new Error('pi child exited'));
    pendingResponses.clear();
  });

  // Kick off get_state to resolve sessionId — fire-and-forget; failures
  // just leave state.currentSessionId = null and events stay dropped
  // until a subsequent successful resolution.
  void (async () => {
    try {
      const result = await sendCommand<{ sessionId?: string }>({ type: 'get_state' });
      if (result && typeof result.sessionId === 'string' && result.sessionId.length > 0) {
        state.currentSessionId = result.sessionId;
      }
    } catch {
      // Pi may not be running --mode rpc, or version may be too old.
      // No-op — caller can inspect state.currentSessionId to confirm.
    }
  })();

  return {
    state,
    sendCommand,
    dispose: () => new Promise<void>((resolve) => {
      if (disposed) { resolve(); return; }
      const handleExit = () => { disposed = true; resolve(); };
      child.on('exit', handleExit);
      try {
        writeStdinLine({ id: nextRpcRequestId(), type: 'abort' });
      } catch { /* already gone */ }
      try { child.kill('SIGTERM'); } catch { /* already gone */ }
      // Failsafe: if exit never fires, resolve after a short grace period.
      setTimeout(() => { disposed = true; resolve(); }, 5000);
    }),
    get persistedCount() { return adapter.persistedCount; },
    get droppedCount() { return adapter.droppedCount; },
    get malformedCount() { return adapter.malformedCount; }
  };
}

/**
 * Spawn `pi --mode rpc` with the ANT-recommended flag set.
 *
 * Flags chosen for an ANT-managed session:
 *   --mode rpc           bidirectional JSONL protocol on stdio (required)
 *   --no-context-files   skip auto-loading AGENTS.md from cwd
 *   --offline            skip network startup probes (faster spawn)
 *
 * Env:
 *   PI_TELEMETRY=0           disable install telemetry
 *   PI_SKIP_VERSION_CHECK=1  skip update check
 *   PI_CODING_AGENT_SESSION_DIR  optional override for session storage
 */
export function spawnPiRpc(options: {
  cwd?: string;
  sessionDir?: string;
  binary?: string;
} = {}): {
  child: ChildProcessWithoutNullStreams;
  bridge: PiBridge;
} {
  const env: Record<string, string> = {
    ...process.env,
    PI_TELEMETRY: '0',
    PI_SKIP_VERSION_CHECK: '1'
  };
  if (options.sessionDir) env.PI_CODING_AGENT_SESSION_DIR = options.sessionDir;

  const child = spawn(options.binary ?? 'pi', [
    '--mode', 'rpc',
    '--no-context-files',
    '--offline'
  ], {
    cwd: options.cwd,
    stdio: ['pipe', 'pipe', 'pipe'],
    env
  });
  const bridge = attachPiBridgeToChild(child);
  return { child, bridge };
}
