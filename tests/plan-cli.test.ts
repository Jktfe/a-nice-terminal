import { afterEach, describe, expect, it, vi } from 'vitest';
import { plan } from '../cli/commands/plan';

const ctx = { serverUrl: 'http://ant.test', apiKey: '', json: false };
const originalFetch = globalThis.fetch;

function stubFetch(fetchMock: typeof fetch) {
  globalThis.fetch = fetchMock;
}

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

function milestoneEvent(
  overrides: Record<string, unknown> = {},
  id = 'milestone-1',
  tsMs = 1_710_000_000_001,
) {
  return {
    id,
    session_id: 'room-1',
    ts_ms: tsMs,
    kind: 'plan_milestone',
    text: 'Milestone',
    payload: {
      plan_id: 'old-plan',
      parent_id: 'old-plan',
      milestone_id: 'm1',
      title: 'Milestone one',
      order: 1,
      status: 'planned',
      ...overrides,
    },
  };
}

describe('ant plan CLI archive management', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
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
    stubFetch(fetchMock as unknown as typeof fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['list'], { 'include-archived': true }, ctx);

    expect(log.mock.calls.flat().join('\n')).toContain('[archived]');
  });

  // Lifecycle verbs (archive/unarchive/delete/restore-delete) target the v4
  // plans entity at /api/plans/<id> with {action} — they no longer mutate
  // individual plan_section events. The section-archive flow was retired
  // when plans gained first-class lifecycle timestamps server-side.
  function lifecycleFetchMock(planId: string, calls: Array<{ url: string; options: any }>): typeof fetch {
    return vi.fn(async (url: string | URL | Request, options: any = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(String(url));
      if (parsed.pathname === `/api/plans/${planId}` && options.method === 'PATCH') {
        return Response.json({ plan: { id: planId, title: 'Old plan' } });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    }) as unknown as typeof fetch;
  }

  it('archive PATCHes /api/plans/<id> with action=archive', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    stubFetch(lifecycleFetchMock('old-plan', calls));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['archive', 'old-plan'], {}, ctx);

    expect(calls).toHaveLength(1);
    expect(calls[0].options.method).toBe('PATCH');
    expect(new URL(calls[0].url).pathname).toBe('/api/plans/old-plan');
    expect(JSON.parse(calls[0].options.body)).toEqual({ action: 'archive' });
  });

  it('unarchive PATCHes /api/plans/<id> with action=unarchive', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    stubFetch(lifecycleFetchMock('old-plan', calls));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['unarchive', 'old-plan'], {}, ctx);

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].options.body)).toEqual({ action: 'unarchive' });
  });

  it('delete PATCHes /api/plans/<id> with action=delete (soft)', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    stubFetch(lifecycleFetchMock('old-plan', calls));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['delete', 'old-plan'], {}, ctx);

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].options.body)).toEqual({ action: 'delete' });
  });

  it('restore-delete PATCHes /api/plans/<id> with action=restore', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    stubFetch(lifecycleFetchMock('old-plan', calls));
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['restore-delete', 'old-plan'], {}, ctx);

    expect(calls).toHaveLength(1);
    expect(JSON.parse(calls[0].options.body)).toEqual({ action: 'restore' });
  });

  it('updates a milestone by PATCHing the latest matching plan_milestone event', async () => {
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
          events: [
            milestoneEvent({ status: 'planned' }, 'milestone-old', 1_710_000_000_001),
            milestoneEvent({ status: 'active' }, 'milestone-new', 1_710_000_000_010),
          ],
          errors: [],
        });
      }
      if (parsed.pathname === '/api/plan/events/milestone-new') {
        return Response.json({ event: milestoneEvent({ status: 'done' }, 'milestone-new') });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    stubFetch(fetchMock as unknown as typeof fetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['update', 'old-plan'], { session: 'room-1', milestone: 'm1', status: 'done' }, ctx);

    expect(calls).toHaveLength(2);
    expect(new URL(calls[1].url).pathname).toBe('/api/plan/events/milestone-new');
    expect(calls[1].options.method).toBe('PATCH');
    expect(JSON.parse(calls[1].options.body)).toMatchObject({ status: 'done' });
  });

  it('requires --session for plan update so duplicate plan ids do not drift rooms', async () => {
    const fetchMock = vi.fn(async () => Response.json({ error: 'should not fetch' }, { status: 500 }));
    stubFetch(fetchMock as unknown as typeof fetch);

    await expect(plan(['update', 'old-plan'], { milestone: 'm1', status: 'done' }, ctx))
      .rejects.toThrow('--session <id>');

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('appends evidence and sends a note as plan event text when updating', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, options: any = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/plan') {
        return Response.json({
          session_id: 'room-1',
          plan_id: 'old-plan',
          events: [
            milestoneEvent({
              evidence: [{ kind: 'file', ref: 'docs/original.md', label: 'original' }],
            }),
          ],
          errors: [],
        });
      }
      if (parsed.pathname === '/api/plan/events/milestone-1') {
        return Response.json({ event: milestoneEvent({ status: 'active' }) });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    stubFetch(fetchMock as unknown as typeof fetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['update', 'old-plan'], {
      session: 'room-1',
      milestone: 'm1',
      status: 'active',
      evidence: 'file:docs/evidence.md:focused test',
      note: 'Focused test passed',
    }, ctx);

    expect(JSON.parse(calls[1].options.body)).toMatchObject({
      status: 'active',
      text: 'Focused test passed',
      evidence: [
        { kind: 'file', ref: 'docs/original.md', label: 'original' },
        { kind: 'file', ref: 'docs/evidence.md', label: 'focused test' },
      ],
    });
  });

  it('keeps source_url evidence refs intact when they contain URL separators', async () => {
    const calls: Array<{ url: string; options: any }> = [];
    const fetchMock = vi.fn(async (url: string | URL | Request, options: any = {}) => {
      calls.push({ url: String(url), options });
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/plan') {
        return Response.json({
          session_id: 'room-1',
          plan_id: 'old-plan',
          events: [milestoneEvent()],
          errors: [],
        });
      }
      if (parsed.pathname === '/api/plan/events/milestone-1') {
        return Response.json({ event: milestoneEvent({ status: 'passing' }) });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    stubFetch(fetchMock as unknown as typeof fetch);
    vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['update', 'old-plan'], {
      session: 'room-1',
      milestone: 'm1',
      status: 'passing',
      evidence: 'source_url:https://example.com/path?x=1#anchor',
    }, ctx);

    expect(JSON.parse(calls[1].options.body)).toMatchObject({
      status: 'passing',
      evidence: [
        { kind: 'source_url', ref: 'https://example.com/path?x=1#anchor' },
      ],
    });
  });

  it('supports --json output for plan update', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      if (parsed.pathname === '/api/plan') {
        return Response.json({
          session_id: 'room-1',
          plan_id: 'old-plan',
          events: [milestoneEvent()],
          errors: [],
        });
      }
      if (parsed.pathname === '/api/plan/events/milestone-1') {
        return Response.json({
          event: milestoneEvent({ status: 'done' }),
          ok: true,
        });
      }
      return Response.json({ error: `unexpected ${parsed.pathname}` }, { status: 500 });
    });
    stubFetch(fetchMock as unknown as typeof fetch);
    const log = vi.spyOn(console, 'log').mockImplementation(() => {});

    await plan(['update', 'old-plan'], {
      session: 'room-1',
      milestone: 'm1',
      status: 'done',
    }, { ...ctx, json: true });

    expect(JSON.parse(String(log.mock.calls[0][0]))).toMatchObject({
      ok: true,
      event: {
        id: 'milestone-1',
        payload: { status: 'done' },
      },
    });
  });

  it('surfaces invalid --session failures from the server', async () => {
    const fetchMock = vi.fn(async (url: string | URL | Request) => {
      const parsed = new URL(String(url));
      expect(parsed.searchParams.get('session_id')).toBe('missing-room');
      return Response.json({ error: 'No plan events found for session' }, { status: 404 });
    });
    stubFetch(fetchMock as unknown as typeof fetch);

    await expect(plan(['update', 'old-plan'], {
      session: 'missing-room',
      milestone: 'm1',
      status: 'done',
    }, ctx)).rejects.toThrow('No plan events found for session');

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
