import { afterEach, describe, expect, it, vi } from 'vitest';
import { plan } from '../cli/commands/plan';

const ctx = { serverUrl: 'http://ant.test', apiKey: '', json: false };

function sectionEvent(
  overrides: Record<string, unknown> = {},
  id = 'section-1',
  tsMs = 1_710_000_000_001,
) {
  return {
    id,
    session_id: 'room-1',
    ts_ms: tsMs,
    kind: 'plan_section',
    text: 'Old plan',
    payload: {
      plan_id: 'old-plan',
      title: 'Old plan',
      order: 0,
      ...overrides,
    },
  };
}

describe('ant plan CLI archive management', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes include_archived through to plan list and renders archived tags', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      expect(parsed.pathname).toBe('/api/plans');
      expect(parsed.searchParams.get('include_archived')).toBe('1');
      return Response.json({
        count: 1,
        include_archived: true,
        plans: [{
          session_id: 'room-1',
          plan_id: 'old-plan',
          event_count: 3,
          updated_ts_ms: 1_710_000_000_001,
          archived: true,
        }],
      });
    });
    vi.stubGlobal('fetch', fetchMock);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['list'], { 'include-archived': true }, ctx);

    expect(log.mock.calls.flat().join('\n')).toContain('[archived]');
  });

  it('archives by PATCHing the first plan_section status to archived', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, options: any = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/plan') {
        expect(parsed.searchParams.get('include_archived')).toBe('1');
        expect(parsed.searchParams.get('session_id')).toBe('room-1');
        return Response.json({
          session_id: 'room-1',
          plan_id: 'old-plan',
          events: [sectionEvent()],
          errors: [],
        });
      }
      if (parsed.pathname === '/api/plan/events/section-1') {
        return Response.json({ event: sectionEvent({ status: 'archived' }) });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['archive', 'old-plan'], { session: 'room-1' }, ctx);

    expect(calls).toHaveLength(2);
    expect(calls[1].options.method).toBe('PATCH');
    expect(JSON.parse(calls[1].options.body)).toMatchObject({ status: 'archived' });
  });

  it('archives the latest same-order section when section title identity drifted', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, options: any = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/plan') {
        return Response.json({
          session_id: 'room-1',
          plan_id: 'old-plan',
          events: [
            sectionEvent({ title: 'Original title' }, 'section-old', 1_710_000_000_001),
            sectionEvent({ title: 'Renamed title' }, 'section-new', 1_710_000_000_010),
          ],
          errors: [],
        });
      }
      if (parsed.pathname === '/api/plan/events/section-new') {
        return Response.json({ event: sectionEvent({ title: 'Renamed title', status: 'archived' }, 'section-new') });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['archive', 'old-plan'], { session: 'room-1' }, ctx);

    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).pathname).toBe('/api/plan/events/section-new');
    expect(JSON.parse(calls[1].options.body)).toMatchObject({ status: 'archived' });
  });

  it('unarchives by PATCHing the first plan_section status back to planned', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, options: any = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/plan') {
        return Response.json({
          session_id: 'room-1',
          plan_id: 'old-plan',
          events: [sectionEvent({ status: 'archived' })],
          errors: [],
        });
      }
      if (parsed.pathname === '/api/plan/events/section-1') {
        return Response.json({ event: sectionEvent({ status: 'planned' }) });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['unarchive', 'old-plan'], { session: 'room-1' }, ctx);

    expect(calls).toHaveLength(2);
    expect(calls[1].options.method).toBe('PATCH');
    expect(JSON.parse(calls[1].options.body)).toMatchObject({ status: 'planned' });
  });

  it('unarchives every archived section identity left by title drift', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, options: any = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/plan') {
        return Response.json({
          session_id: 'room-1',
          plan_id: 'old-plan',
          events: [
            sectionEvent({ title: 'Original title', status: 'archived' }, 'section-old', 1_710_000_000_001),
            sectionEvent({ title: 'Renamed title', status: 'planned' }, 'section-new', 1_710_000_000_010),
            sectionEvent({ title: 'Other stale title', status: 'archived' }, 'section-other', 1_710_000_000_011),
          ],
          errors: [],
        });
      }
      if (parsed.pathname.startsWith('/api/plan/events/')) {
        return Response.json({ event: { ok: true } });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['unarchive', 'old-plan'], { session: 'room-1' }, ctx);

    const patchCalls = calls.slice(1);
    expect(patchCalls.map((call) => new URL(call.url).pathname).sort()).toEqual([
      '/api/plan/events/section-old',
      '/api/plan/events/section-other',
    ]);
    expect(patchCalls.map((call) => JSON.parse(call.options.body).status)).toEqual(['planned', 'planned']);
  });
});
