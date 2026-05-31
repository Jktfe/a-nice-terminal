import { describe, expect, it } from 'vitest';
import { runRegister } from './ant-cli-register.mjs';

class CliInputError extends Error {}

function fakeRuntime(overrides = {}) {
  const out = [];
  const err = [];
  return {
    serverUrl: 'http://localhost:6174',
    flags: { name: 'terminal3' },
    CliInputError,
    writeOut: (s) => out.push(s),
    writeErr: (s) => err.push(s),
    isInteractive: false,
    promptImpl: async () => 'f',
    // Provide a stable processPpid so processIdentityChain doesn't rely solely
    // on process.ppid (which is fine, but this makes intent explicit).
    processPpid: process.pid,
    out, err,
    ...overrides
  };
}

const ARCHIVED_409 = {
  status: 409,
  ok: false,
  json: async () => ({
    error: 'archived_name_matches',
    candidates: [{ id: 'term-a', name: '[A] terminal3', base: 'terminal3', handle: '@v4', last_seen: 1 }]
  }),
  text: async () => ''
};

describe('register archived_name_matches handling', () => {
  it('non-interactive: prints recovery list and throws (fail loud, no silent fresh)', async () => {
    const rt = fakeRuntime({ isInteractive: false, fetchImpl: async () => ARCHIVED_409 });
    await expect(runRegister(rt)).rejects.toThrow(/archived/i);
    expect(rt.err.join('\n')).toMatch(/--revive|--fresh/);
    expect(rt.err.join('\n')).toMatch(/term-a/);
  });

  it('interactive + choose fresh: re-POSTs with fresh:true', async () => {
    const bodies = [];
    const rt = fakeRuntime({
      isInteractive: true,
      promptImpl: async () => 'f',
      fetchImpl: async (_url, opts) => {
        const body = JSON.parse(opts.body);
        bodies.push(body);
        if (!body.fresh && !body.revive) return ARCHIVED_409;
        return { status: 201, ok: true, json: async () => ({ name: 'terminal3', terminal_id: 'new-1' }), text: async () => '' };
      }
    });
    await runRegister(rt);
    expect(bodies.at(-1).fresh).toBe(true);
  });

  it('interactive + choose revive: re-POSTs with revive:<id>', async () => {
    const bodies = [];
    const rt = fakeRuntime({
      isInteractive: true,
      promptImpl: async () => '1',
      fetchImpl: async (_url, opts) => {
        const body = JSON.parse(opts.body);
        bodies.push(body);
        if (!body.fresh && !body.revive) return ARCHIVED_409;
        return { status: 201, ok: true, json: async () => ({ name: 'terminal3', terminal_id: 'term-a' }), text: async () => '' };
      }
    });
    await runRegister(rt);
    expect(bodies.at(-1).revive).toBe('term-a');
  });
});
