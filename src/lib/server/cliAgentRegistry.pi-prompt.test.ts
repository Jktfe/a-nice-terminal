/**
 * Pi sendPrompt glue test (2026-05-25). The shape-level registry tests
 * in `cliAgentRegistry.test.ts` use injected fake handles by design, so
 * the buildPiHandle code path doesn't get exercised there. piLifecycle's
 * own tests cover `bridge.sendCommand({type:'prompt', message})`, but
 * NOTHING covers that buildPiHandle's sendPrompt forms the right command.
 *
 * This file fills that gap with a tiny vi.mock-based test of just the
 * pi-glue: spawnPiRpc is replaced with a stub that records sendCommand
 * calls; we verify the registry-level sendPrompt resolves into the
 * canonical PiRpcCommand shape (`{type:'prompt', message:<text>}`).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sendCommandSpy = vi.fn(async (_cmd: { type: string; [k: string]: unknown }) => ({ ok: true }));
const disposeSpy = vi.fn(async () => {});
let lastBridgeState: { currentSessionId: string | null } | null = null;

vi.mock('./pi/piLifecycle', () => ({
  spawnPiRpc: () => {
    lastBridgeState = { currentSessionId: 'pi-sess-stub' };
    return {
      bridge: {
        state: lastBridgeState,
        sendCommand: sendCommandSpy,
        dispose: disposeSpy
      },
      // child only needs `on('exit', ...)` for the registry cleanup wire;
      // we never fire the exit so the listener doesn't run.
      child: { on: () => undefined }
    };
  }
}));

// Codex is also imported by cliAgentRegistry; stub it so the module
// loads even though this test only exercises the pi branch.
vi.mock('./codex/codexLifecycle', () => ({
  spawnCodexAppServer: () => ({
    bridge: {
      state: { currentThreadId: null },
      sendRequest: vi.fn(async () => ({})),
      sendNotification: vi.fn(),
      initialize: vi.fn(async () => ({})),
      dispose: vi.fn()
    },
    child: { on: () => undefined }
  })
}));

const {
  startCliAgent,
  resetCliAgentRegistryForTests
} = await import('./cliAgentRegistry');

describe('buildPiHandle.sendPrompt', () => {
  beforeEach(() => {
    resetCliAgentRegistryForTests();
    sendCommandSpy.mockClear();
    disposeSpy.mockClear();
  });

  afterEach(() => resetCliAgentRegistryForTests());

  it('PP1: sends `{type:"prompt", message}` to the pi bridge', async () => {
    const handle = startCliAgent({ cli: 'pi' });
    const result = await handle.sendPrompt('explain this codepath');
    expect(sendCommandSpy).toHaveBeenCalledTimes(1);
    expect(sendCommandSpy).toHaveBeenCalledWith({
      type: 'prompt',
      message: 'explain this codepath'
    });
    expect(result.threadId).toBe('pi-sess-stub');
  });

  it('PP2: forwards the operator text verbatim — no trimming, no transformations', async () => {
    const handle = startCliAgent({ cli: 'pi' });
    const longText = '  ## Brief\n\nThree-line\nprompt with leading spaces.  ';
    await handle.sendPrompt(longText);
    const call = sendCommandSpy.mock.calls[0]?.[0] as unknown as { message: string } | undefined;
    expect(call?.message).toBe(longText);
  });

  it('PP3: returns current sessionId as threadId for caller correlation', async () => {
    const handle = startCliAgent({ cli: 'pi' });
    const { threadId } = await handle.sendPrompt('hi');
    expect(threadId).toBe('pi-sess-stub');
  });
});
