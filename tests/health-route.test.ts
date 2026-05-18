import { afterEach, describe, expect, it } from 'vitest';
import { GET } from '../src/routes/api/health/+server.js';

const WATCHDOG_KEY = '__ant_watchdog__';

function setWatchdogState(state: unknown): void {
  (globalThis as Record<string, unknown>)[WATCHDOG_KEY] = state;
}

afterEach(() => {
  delete (globalThis as Record<string, unknown>)[WATCHDOG_KEY];
  delete process.env.ANT_MAX_ACTIVE_AGENTS;
});

describe('/api/health', () => {
  it('returns the default health payload shape', async () => {
    const response = GET();
    expect(response.status).toBe(200);

    const body = await response.json();
    expect(body).toMatchObject({
      status: 'ok',
      version: '3.0.0-alpha',
      resources: {
        totalCpuPct: 0,
        totalRssMb: 0,
        activeSessionCount: 0,
        maxActiveSessions: 0,
        atCap: false,
        canSpawn: true,
        stalledSessions: [],
        sessions: [],
        sampledAt: null,
      },
    });
  });

  it('projects watchdog resources and spawn-cap status for native smoke checks', async () => {
    process.env.ANT_MAX_ACTIVE_AGENTS = '1';
    setWatchdogState({
      resources: new Map([
        ['term-a', {
          sessionId: 'term-a',
          pid: 1234,
          cpuPct: 12.34,
          rssKb: 2048,
          sampledAt: Date.UTC(2026, 4, 18, 12, 0, 0),
        }],
      ]),
      stalls: new Map([
        ['term-a', {
          sessionId: 'term-a',
          detectedAt: Date.UTC(2026, 4, 18, 12, 0, 0),
          cpuPct: 91,
          silentSinceMs: 120_000,
        }],
      ]),
      lastPoll: Date.UTC(2026, 4, 18, 12, 0, 0),
      timer: null,
    });

    const response = GET();
    const body = await response.json();

    expect(body.resources).toMatchObject({
      totalCpuPct: 12.3,
      totalRssMb: 2,
      activeSessionCount: 1,
      maxActiveSessions: 1,
      atCap: true,
      canSpawn: false,
      stalledSessions: ['term-a'],
      sampledAt: '2026-05-18T12:00:00.000Z',
    });
    expect(body.resources.sessions).toEqual([
      {
        sessionId: 'term-a',
        pid: 1234,
        cpuPct: 12.34,
        rssMb: 2,
      },
    ]);
  });
});
