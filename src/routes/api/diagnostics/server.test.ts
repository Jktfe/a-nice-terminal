import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '$lib/server/db';
import { GET } from './+server';

const PREV_TOKEN = process.env.ANT_ADMIN_TOKEN;
const ADMIN_TOKEN = 'diag-admin-token';

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  delete process.env.ANT_FRESH_DB_PATH;
  if (PREV_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV_TOKEN;
});

function req(token?: string): Parameters<typeof GET>[0] {
  return {
    request: new Request('http://x/api/diagnostics', {
      headers: token ? { authorization: `Bearer ${token}` } : {}
    })
  } as Parameters<typeof GET>[0];
}

describe('GET /api/diagnostics', () => {
  it('is admin-gated', async () => {
    await expect(GET(req())).rejects.toMatchObject({ status: 401 });
  });

  it('returns runtime, db, retention, and table-count diagnostics without secrets', async () => {
    const res = await GET(req(ADMIN_TOKEN));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.process).toMatchObject({
      pid: expect.any(Number),
      nodeVersion: expect.stringMatching(/^v/)
    });
    expect(body.db).toMatchObject({
      path: expect.any(String),
      retention: expect.objectContaining({
        retentionDays: expect.any(Number),
        maxDbBytes: expect.any(Number)
      })
    });
    expect(body.counts).toMatchObject({
      terminalRecords: expect.any(Number),
      terminalRunEvents: expect.any(Number),
      chatRooms: expect.any(Number),
      chatMessages: expect.any(Number)
    });
    expect(JSON.stringify(body)).not.toContain(ADMIN_TOKEN);
  });
});
