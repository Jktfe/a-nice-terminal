import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { POST } from './+server';

const ADMIN_TOKEN = 'maintenance-admin-token';
const PREV = process.env.ANT_ADMIN_TOKEN;

vi.mock('$lib/server/linkedRoomAgentGuffPurge', () => ({
  dedupHistoricalTranscriptRows: vi.fn(() => 7)
}));

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});

function req(token?: string): Parameters<typeof POST>[0] {
  return {
    request: new Request('http://x/api/maintenance/dedup-transcript-history', {
      method: 'POST',
      headers: token ? { authorization: `Bearer ${token}` } : undefined
    })
  } as Parameters<typeof POST>[0];
}

describe('POST /api/maintenance/dedup-transcript-history', () => {
  it('401 without admin bearer', async () => {
    await expect(POST(req())).rejects.toMatchObject({ status: 401 });
  });

  it('401 with wrong admin bearer', async () => {
    await expect(POST(req('wrong'))).rejects.toMatchObject({ status: 401 });
  });

  it('runs dedup only with admin bearer', async () => {
    const res = await POST(req(ADMIN_TOKEN));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ softDeleted: 7 });
  });
});
