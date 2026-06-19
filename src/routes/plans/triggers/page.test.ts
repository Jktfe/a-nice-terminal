import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/plans/triggers load', () => {
  it('marks trigger and plan fetch failures instead of treating them as empty data', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/plan-triggers') {
        return jsonResponse({ message: 'trigger read failed' }, 500);
      }
      if (url === '/api/plans?state=all') {
        return jsonResponse({ message: 'plans auth failed' }, 401);
      }
      return jsonResponse({}, 404);
    });

    const result = await load({
      fetch,
      data: { events: ['plan.completed'], actions: ['room.message'] }
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      triggers: [],
      plans: [],
      triggersFetchFailed: true,
      plansFetchFailed: true,
      events: ['plan.completed'],
      actions: ['room.message']
    });
  });

  it('does not mark successful empty reads as failures', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/plan-triggers') return jsonResponse({ triggers: [] });
      if (url === '/api/plans?state=all') return jsonResponse({ plans: [] });
      return jsonResponse({}, 404);
    });

    const result = await load({
      fetch,
      data: { events: [], actions: [] }
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      triggers: [],
      plans: [],
      triggersFetchFailed: false,
      plansFetchFailed: false
    });
  });

  it('renders explicit alerts for trigger and plan read failures', () => {
    const source = readFileSync('src/routes/plans/triggers/+page.svelte', 'utf8');
    expect(source).toContain('data.triggersFetchFailed');
    expect(source).toContain('Could not load plan triggers');
    expect(source).toContain('data.plansFetchFailed');
    expect(source).toContain('Could not load plans for the trigger builder');
    expect(source).toContain('role="alert"');
  });
});
