import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { POST } from './+server';
import { pruneOperationalHistory } from '$lib/server/operationalRetention';

const ADMIN_TOKEN = 'maintenance-admin-token';
const PREV = process.env.ANT_ADMIN_TOKEN;

vi.mock('$lib/server/operationalRetention', () => ({
  pruneOperationalHistory: vi.fn(() => ({
    retentionDays: 7,
    cutoffMs: 123,
    terminalRunEventsDeleted: 10,
    cliHookEventsDeleted: 2,
    vacuumed: true
  }))
}));

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
  vi.mocked(pruneOperationalHistory).mockClear();
});

afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});

function req(token?: string, body?: unknown): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://x/api/maintenance/operational-retention', {
      method: 'POST',
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        'content-type': 'application/json'
      },
      body: body === undefined ? undefined : JSON.stringify(body)
    })
  } as Parameters<typeof POST>[0];
}

function rawReq(token: string, body: string): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://x/api/maintenance/operational-retention', {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json'
      },
      body
    })
  } as Parameters<typeof POST>[0];
}

describe('POST /api/maintenance/operational-retention', () => {
  it('401 without admin bearer', async () => {
    await expect(POST(req())).rejects.toMatchObject({ status: 401 });
  });

  it('runs prune with optional vacuum when authorised', async () => {
    const res = await POST(req(ADMIN_TOKEN, { vacuum: true }));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({
      retentionDays: 7,
      cutoffMs: 123,
      terminalRunEventsDeleted: 10,
      cliHookEventsDeleted: 2,
      vacuumed: true
    });
    expect(pruneOperationalHistory).toHaveBeenCalledWith({ vacuum: true });
  });

  it('forwards retentionDays and batchSize overrides', async () => {
    const res = await POST(req(ADMIN_TOKEN, { retentionDays: 3, batchSize: 1234 }));
    expect(res.status).toBe(200);
    expect(pruneOperationalHistory).toHaveBeenCalledWith({
      retentionDays: 3,
      batchSize: 1234,
      vacuum: false
    });
  });

  it('rejects invalid JSON and non-object bodies', async () => {
    await expect(POST(rawReq(ADMIN_TOKEN, '{'))).rejects.toMatchObject({ status: 400 });
    await expect(POST(req(ADMIN_TOKEN, []))).rejects.toMatchObject({ status: 400 });
  });

  it('rejects non-positive integer retention controls', async () => {
    await expect(POST(req(ADMIN_TOKEN, { retentionDays: 0 }))).rejects.toMatchObject({ status: 400 });
    await expect(POST(req(ADMIN_TOKEN, { batchSize: 1.5 }))).rejects.toMatchObject({ status: 400 });
    expect(pruneOperationalHistory).not.toHaveBeenCalled();
  });
});
