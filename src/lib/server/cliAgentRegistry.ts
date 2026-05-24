/**
 * cliAgentRegistry — in-memory registry of active ANT-spawned CLI
 * bridges (Codex app-server + Pi --mode rpc).
 *
 * CLI-HOOK-BRIDGE Phase 5 (2026-05-15, JWPK "keep going").
 *
 * Why in-memory: bridges are child processes of the ANT server. They
 * die when the server dies. There's nothing to persist across restart;
 * a SQLite-backed registry would just be lying about durability.
 *
 * Why globalThis: per the banked "globalThis is mandatory" rule, all
 * server-side singletons share state via a globalThis slot so
 * dev-hot-reload + tests + production all see one registry.
 *
 * Handle id shape: `agent_<random>_<unix-ms>` — sortable, unique enough
 * for a per-process registry, doesn't depend on uuid library.
 */

import { spawnCodexAppServer, type CodexBridge } from './codex/codexLifecycle';
import { spawnPiRpc, type PiBridge } from './pi/piLifecycle';

export type CliAgentKind = 'codex' | 'pi';

export type CliAgentHandle = {
  handleId: string;
  cli: CliAgentKind;
  cwd: string | null;
  spawnedAtMs: number;
  /** Resolved at handshake time (codex thread id, pi session id). */
  getSessionId(): string | null;
  /** Send an RPC command. Forwards to the underlying bridge. */
  sendCommand<TResult = unknown>(payload: Record<string, unknown>): Promise<TResult>;
  /**
   * Deliver an operator-authored text prompt to the running agent.
   * For codex this is `thread/start` (lazy, first call) + `turn/start`.
   * Closes dogfood finding #6 (2026-05-24): no operator-facing input channel.
   */
  sendPrompt(text: string): Promise<{ threadId: string | null }>;
  /** Tear down the bridge. Idempotent. */
  stop(): Promise<void>;
};

type RegistrySlot = {
  handles: Map<string, CliAgentHandle>;
};

const REGISTRY_GLOBAL_KEY = '__antCliAgentRegistry';

function getRegistry(): RegistrySlot {
  const slot = globalThis as Record<string, unknown>;
  let existing = slot[REGISTRY_GLOBAL_KEY] as RegistrySlot | undefined;
  if (!existing) {
    existing = { handles: new Map() };
    slot[REGISTRY_GLOBAL_KEY] = existing;
  }
  return existing;
}

function makeHandleId(cli: CliAgentKind): string {
  const random = Math.random().toString(36).slice(2, 10);
  return `agent_${cli}_${random}_${Date.now()}`;
}

function buildCodexHandle(options: { cwd?: string; binary?: string }): CliAgentHandle {
  const { bridge, child } = spawnCodexAppServer({ cwd: options.cwd, binary: options.binary });
  const handleId = makeHandleId('codex');
  const spawnedAtMs = Date.now();
  let disposed = false;

  // Fire-and-forget initialize handshake — we don't block the registry
  // entry on this. Callers can read state.currentThreadId after it
  // resolves (small delay; UI can poll).
  void bridge.initialize().catch(() => { /* surface via state */ });

  // Make sure registry entry is removed if codex exits unexpectedly.
  child.on('exit', () => {
    disposed = true;
    getRegistry().handles.delete(handleId);
  });

  return {
    handleId,
    cli: 'codex',
    cwd: options.cwd ?? null,
    spawnedAtMs,
    getSessionId: () => bridge.state.currentThreadId,
    async sendCommand(payload) {
      const method = typeof payload.method === 'string' ? payload.method : null;
      if (!method) throw new Error('codex commands require a `method` field');
      const params = payload.params as unknown;
      return bridge.sendRequest(method, params);
    },
    async sendPrompt(text: string) {
      // codex protocol (verified against `codex app-server generate-json-schema`,
      // 2026-05-24): turn/start needs a threadId. thread/start mints one and
      // returns { thread: { id, ... } }. We lazy-start on first prompt so the
      // spawn endpoint can stay parameterless.
      let threadId = bridge.state.currentThreadId;
      if (!threadId) {
        const startResult = await bridge.sendRequest<{ thread?: { id?: string } }>(
          'thread/start',
          {}
        );
        threadId = startResult?.thread?.id ?? null;
        if (!threadId) throw new Error('codex thread/start did not return a thread id');
        // The adapter usually sets state.currentThreadId via the `thread/started`
        // notification; do it eagerly here too so an immediate second
        // sendPrompt call reuses the same thread without racing the notif.
        bridge.state.currentThreadId = threadId;
      }
      await bridge.sendRequest('turn/start', {
        threadId,
        input: [{ type: 'text', text }]
      });
      return { threadId };
    },
    async stop() {
      if (disposed) return;
      disposed = true;
      bridge.dispose();
      getRegistry().handles.delete(handleId);
    }
  };
}

function buildPiHandle(options: { cwd?: string; sessionDir?: string; binary?: string }): CliAgentHandle {
  const { bridge, child } = spawnPiRpc({
    cwd: options.cwd,
    sessionDir: options.sessionDir,
    binary: options.binary
  });
  const handleId = makeHandleId('pi');
  const spawnedAtMs = Date.now();
  let disposed = false;

  child.on('exit', () => {
    disposed = true;
    getRegistry().handles.delete(handleId);
  });

  return {
    handleId,
    cli: 'pi',
    cwd: options.cwd ?? null,
    spawnedAtMs,
    getSessionId: () => bridge.state.currentSessionId,
    async sendCommand(payload) {
      if (typeof payload.type !== 'string') {
        throw new Error('pi commands require a `type` field');
      }
      return bridge.sendCommand(payload as Parameters<PiBridge['sendCommand']>[0]);
    },
    async sendPrompt(_text: string) {
      // pi prompt-delivery not yet supported through this surface. The pi
      // bridge has its own sendCommand shape (typed messages, not JSON-RPC).
      // Add a `{type:'userMessage', ...}` variant here when the pi schema
      // clarifies its prompt verb.
      throw new Error('pi sendPrompt not yet implemented');
    },
    async stop() {
      if (disposed) return;
      disposed = true;
      await bridge.dispose();
      getRegistry().handles.delete(handleId);
    }
  };
}

export function startCliAgent(input: {
  cli: CliAgentKind;
  cwd?: string;
  sessionDir?: string;
  binary?: string;
}): CliAgentHandle {
  let handle: CliAgentHandle;
  if (input.cli === 'codex') {
    handle = buildCodexHandle({ cwd: input.cwd, binary: input.binary });
  } else if (input.cli === 'pi') {
    handle = buildPiHandle({ cwd: input.cwd, sessionDir: input.sessionDir, binary: input.binary });
  } else {
    throw new Error(`unknown cli kind: ${(input as { cli: string }).cli}`);
  }
  getRegistry().handles.set(handle.handleId, handle);
  return handle;
}

export function getCliAgent(handleId: string): CliAgentHandle | undefined {
  return getRegistry().handles.get(handleId);
}

export function listCliAgents(): CliAgentHandle[] {
  return Array.from(getRegistry().handles.values()).sort((a, b) => a.spawnedAtMs - b.spawnedAtMs);
}

/**
 * Test seam: register a handle that bypasses real spawn. The handle's
 * shape matches CliAgentHandle exactly so callers can't tell. Returns
 * the registered handle so tests can assert on its callbacks.
 */
export function registerCliAgentForTests(handle: CliAgentHandle): void {
  getRegistry().handles.set(handle.handleId, handle);
}

export function resetCliAgentRegistryForTests(): void {
  getRegistry().handles.clear();
}
