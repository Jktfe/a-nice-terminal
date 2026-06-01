import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTerminalRecord } from '\$lib/server/terminalRecordsStore';
import { GET } from './+server';

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

function eventFor() {
  return { request: new Request('http://localhost/api/terminals/handles') };
}

beforeEach(() => {
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  if (PREV_DB_PATH === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = PREV_DB_PATH;
});

describe('/api/terminals/handles', () => {
  it('GET returns empty arrays when no terminals exist', async () => {
    const res = await GET(eventFor() as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.handles).toEqual([]);
    expect(body.explicit).toEqual([]);
  });

  it('GET returns explicit + derived handles', async () => {
    createTerminalRecord({ sessionId: 's-1', name: 'alpha', handle: '@alpha' });
    createTerminalRecord({ sessionId: 's-2', name: 'beta', handle: null });
    const res = await GET(eventFor() as any);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.explicit).toContain('@alpha');
    expect(body.handles).toContain('@alpha');
    expect(body.handles).toContain('@beta');
  });
});
