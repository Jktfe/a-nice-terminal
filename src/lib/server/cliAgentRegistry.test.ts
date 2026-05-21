/**
 * cliAgentRegistry tests — Phase 5 (2026-05-15).
 *
 * Uses `registerCliAgentForTests` to inject fake handles so we never
 * spawn real codex / pi binaries.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  getCliAgent,
  listCliAgents,
  registerCliAgentForTests,
  resetCliAgentRegistryForTests,
  type CliAgentHandle,
  type CliAgentKind
} from './cliAgentRegistry';

function fakeHandle(opts: { cli: CliAgentKind; handleId?: string; spawnedAtMs?: number; sessionId?: string | null }): CliAgentHandle {
  return {
    handleId: opts.handleId ?? `agent_${opts.cli}_fake_${Date.now()}`,
    cli: opts.cli,
    cwd: null,
    spawnedAtMs: opts.spawnedAtMs ?? Date.now(),
    getSessionId: () => opts.sessionId ?? null,
    async sendCommand<TResult = unknown>(payload: Record<string, unknown>): Promise<TResult> {
      return { echoed: payload } as unknown as TResult;
    },
    async stop() { /* no-op for these registry-shape tests */ }
  };
}

describe('cliAgentRegistry', () => {
  beforeEach(() => resetCliAgentRegistryForTests());
  afterEach(() => resetCliAgentRegistryForTests());

  it('listCliAgents returns registered handles sorted by spawnedAtMs', () => {
    registerCliAgentForTests(fakeHandle({ cli: 'codex', handleId: 'a', spawnedAtMs: 2000 }));
    registerCliAgentForTests(fakeHandle({ cli: 'pi', handleId: 'b', spawnedAtMs: 1000 }));
    registerCliAgentForTests(fakeHandle({ cli: 'codex', handleId: 'c', spawnedAtMs: 3000 }));
    const all = listCliAgents();
    expect(all.map((h) => h.handleId)).toEqual(['b', 'a', 'c']);
  });

  it('getCliAgent returns the right entry by id', () => {
    const handle = fakeHandle({ cli: 'pi', handleId: 'lookup', sessionId: 'pi-sess-x' });
    registerCliAgentForTests(handle);
    expect(getCliAgent('lookup')?.cli).toBe('pi');
    expect(getCliAgent('lookup')?.getSessionId()).toBe('pi-sess-x');
  });

  it('getCliAgent returns undefined for unknown id', () => {
    expect(getCliAgent('phantom')).toBeUndefined();
  });

  it('reset clears the registry', () => {
    registerCliAgentForTests(fakeHandle({ cli: 'codex', handleId: 'a' }));
    registerCliAgentForTests(fakeHandle({ cli: 'pi', handleId: 'b' }));
    expect(listCliAgents()).toHaveLength(2);
    resetCliAgentRegistryForTests();
    expect(listCliAgents()).toHaveLength(0);
  });
});
