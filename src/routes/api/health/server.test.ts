import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;
const BOOT_FLAGS = [
  '__antRunEventsBooted',
  '__antTranscriptTailBooted',
  '__antCodexTranscriptTailBooted',
  '__antPiTranscriptTailBooted',
  '__antGeminiTranscriptTailBooted',
  '__antQwenTranscriptTailBooted',
  '__antCopilotTranscriptTailBooted',
  '__antLinkedRoomGuffPurged'
] as const;

function clearBootFlags() {
  const g = globalThis as unknown as Record<string, boolean | undefined>;
  for (const flag of BOOT_FLAGS) delete g[flag];
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
  clearBootFlags();
});

afterEach(() => {
  vi.doUnmock('$lib/server/db');
  vi.resetModules();
  resetIdentityDbForTests();
  clearBootFlags();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

async function loadHealthRoute() {
  vi.resetModules();
  return import('./+server');
}

describe('GET /api/health', () => {
  it('returns readiness status, DB reachability, and boot flags', async () => {
    (globalThis as unknown as Record<string, boolean>).__antRunEventsBooted = true;
    const { GET } = await loadHealthRoute();

    const res = await GET({} as Parameters<typeof GET>[0]);
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body).toMatchObject({
      status: 'ok',
      uptimeSeconds: expect.any(Number),
      pid: process.pid,
      db: { reachable: true, error: null },
      booted: expect.objectContaining({
        __antRunEventsBooted: true,
        __antTranscriptTailBooted: false
      }),
      sampledAt: expect.any(String)
    });
    expect(new Date(body.sampledAt).toString()).not.toBe('Invalid Date');
  });

  it('returns degraded readiness when the DB probe fails', async () => {
    vi.doMock('$lib/server/db', () => ({
      getIdentityDb: () => ({
        prepare: () => {
          throw new Error('db down');
        }
      })
    }));
    const { GET } = await loadHealthRoute();

    const res = await GET({} as Parameters<typeof GET>[0]);
    expect(res.status).toBe(503);
    const body = await res.json();

    expect(body).toMatchObject({
      status: 'degraded',
      db: { reachable: false, error: 'db down' },
      booted: expect.objectContaining({
        __antRunEventsBooted: false,
        __antLinkedRoomGuffPurged: false
      })
    });
  });
});
