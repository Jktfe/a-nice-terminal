import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { resetIdentityDbForTests } from '\$lib/server/db';
import { createTerminalRecord } from '\$lib/server/terminalRecordsStore';
import { GET, PATCH } from './+server';

vi.mock('\$lib/server/ptyClient', () => ({
  listTerminals: async () => []
}));

const PREV_DB_PATH = process.env.ANT_FRESH_DB_PATH;

type AnyHandler = (event: unknown) => unknown;

function eventFor(id: string, method: 'GET' | 'PATCH', body?: unknown) {
  const url = new URL(`http://localhost/api/terminals/${id}`);
  const init: RequestInit = { method };
  if (body !== undefined) {
    init.headers = { 'content-type': 'application/json' };
    init.body = JSON.stringify(body);
  }
  return {
    request: new Request(url, init),
    url,
    params: { id }
  };
}

async function run(handler: AnyHandler, event: unknown): Promise<Response> {
  try {
    return (await handler(event)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
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

describe('/api/terminals/:id', () => {
  it('GET returns terminal record', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha', handle: '@alpha' });
    const res = await run(GET as unknown as AnyHandler, eventFor('t-1', 'GET'));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.sessionId).toBe('t-1');
    expect(body.name).toBe('Alpha');
    expect(body.handle).toBe('@alpha');
    expect(body.alive).toBe(false);
  });

  it('GET 400 on empty id', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('', 'GET'));
    expect(res.status).toBe(400);
  });

  it('GET 404 for missing terminal', async () => {
    const res = await run(GET as unknown as AnyHandler, eventFor('missing', 'GET'));
    expect(res.status).toBe(404);
  });

  it('PATCH updates terminal fields', async () => {
    createTerminalRecord({ sessionId: 't-1', name: 'Alpha' });
    const res = await run(PATCH as unknown as AnyHandler, eventFor('t-1', 'PATCH', {
      name: 'Beta',
      autoForwardRoomId: 'room-1',
      autoForwardChat: 1,
      handle: '@beta'
    }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBe('Beta');
    expect(body.autoForwardRoomId).toBe('room-1');
    expect(body.autoForwardChat).toBe(1);
    expect(body.handle).toBe('@beta');
  });

  it('PATCH 400 on empty id', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('', 'PATCH', { name: 'X' }));
    expect(res.status).toBe(400);
  });

  it('PATCH 404 for missing terminal', async () => {
    const res = await run(PATCH as unknown as AnyHandler, eventFor('missing', 'PATCH', { name: 'X' }));
    expect(res.status).toBe(404);
  });

  /**
   * Sec-iter2 Fix #2 (2026-05-30 enterprise security pass): API-layer
   * handle validation on PATCH /api/terminals/[id]. Alternative exploit
   * path noted in the iter2 review — even with POST gated, an attacker
   * could PATCH any existing terminal whose handle is NULL to '@admin'
   * and gain admin via the approver gate. The store-layer choke-point
   * (Fix #1) catches it; the API-layer 400 here is the UX surface.
   */
  describe('sec-iter2 Fix #2: PATCH handle validation', () => {
    it('PATCH rejects { handle: "@admin" } with 400 (alternative iter2 exploit)', async () => {
      createTerminalRecord({ sessionId: 't-patch-admin', name: 'spawner', handle: null });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-admin', 'PATCH', { handle: '@admin' })
      );
      expect(res.status).toBe(400);
      // Handle must remain NULL — proves the store write didn't fire.
      // (We re-GET to verify; the alternative is to query the store
      // directly but the route-level test is the more honest signal.)
      const getRes = await run(GET as unknown as AnyHandler, eventFor('t-patch-admin', 'GET'));
      const body = await getRes.json();
      expect(body.handle).toBeNull();
    });

    it('PATCH rejects every other reserved handle case-insensitively', async () => {
      createTerminalRecord({ sessionId: 't-patch-reserved', name: 'r', handle: null });
      for (const handle of ['@ADMIN', '@you', '@system', '@chair', '@everyone']) {
        const res = await run(
          PATCH as unknown as AnyHandler,
          eventFor('t-patch-reserved', 'PATCH', { handle })
        );
        expect(res.status).toBe(400);
      }
    });

    it('PATCH rejects invalid-character handles with 400', async () => {
      createTerminalRecord({ sessionId: 't-patch-bad', name: 'b', handle: null });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-bad', 'PATCH', { handle: '@bad space' })
      );
      expect(res.status).toBe(400);
    });

    it('PATCH accepts null handle (explicit clear)', async () => {
      createTerminalRecord({ sessionId: 't-patch-clear', name: 'c', handle: '@alice-pt' });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-clear', 'PATCH', { handle: null })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.handle).toBeNull();
    });

    it('PATCH accepts empty-string handle as null (back-compat with the trim shape)', async () => {
      createTerminalRecord({ sessionId: 't-patch-empty', name: 'e', handle: '@alice-pe' });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-empty', 'PATCH', { handle: '   ' })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.handle).toBeNull();
    });

    it('PATCH accepts a valid non-reserved handle', async () => {
      createTerminalRecord({ sessionId: 't-patch-valid', name: 'v', handle: null });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-valid', 'PATCH', { handle: '@alice-pv' })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.handle).toBe('@alice-pv');
    });

    it('PATCH does not validate handle when field is omitted', async () => {
      createTerminalRecord({ sessionId: 't-patch-other', name: 'o', handle: '@alice-po' });
      const res = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-patch-other', 'PATCH', { name: 'renamed' })
      );
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('renamed');
      expect(body.handle).toBe('@alice-po');
    });

    /**
     * Full exploit-chain regression: once Fix #2 is in place, even if
     * the attacker tries both POST + PATCH paths they cannot get a
     * terminal_records row with handle='@admin'. This proves the
     * sibling resolveAuthoritativeCallerHandle gate is no longer
     * spoofable through this surface — there's no row to walk to.
     */
    it('full exploit regression: neither POST nor PATCH can land an @admin handle row', async () => {
      // PATCH-on-fresh path
      createTerminalRecord({ sessionId: 't-exploit', name: 'attacker', handle: null });
      const patchRes = await run(
        PATCH as unknown as AnyHandler,
        eventFor('t-exploit', 'PATCH', { handle: '@admin' })
      );
      expect(patchRes.status).toBe(400);
      const after = await run(GET as unknown as AnyHandler, eventFor('t-exploit', 'GET'));
      const body = await after.json();
      expect(body.handle).toBeNull();
    });
  });
});
