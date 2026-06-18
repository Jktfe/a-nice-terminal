import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/plans load', () => {
  it('marks standalone task fetch failures instead of treating them as no unfiled tasks', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/plans/completions?active=1') {
        return jsonResponse({ plans: [] });
      }
      if (url === '/api/tasks') {
        return jsonResponse({ message: 'Authentication required.' }, 401);
      }
      return jsonResponse({}, 404);
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans')
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      plans: [],
      unfiled: { total: 0, completed: 0 },
      taskFetchFailed: true,
      plansFetchFailed: false
    });
  });

  it('marks plan completion fetch failures separately from empty plan lists', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/plans/completions?active=1') {
        return jsonResponse({ message: 'server down' }, 500);
      }
      if (url === '/api/tasks') {
        return jsonResponse({ tasks: [{ planId: null, status: 'completed' }] });
      }
      return jsonResponse({}, 404);
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans')
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      plans: [],
      unfiled: { total: 1, completed: 1 },
      taskFetchFailed: false,
      plansFetchFailed: true
    });
  });

  it('renders explicit alerts for missing plan or standalone task data', () => {
    const source = readFileSync('src/routes/plans/+page.svelte', 'utf8');
    expect(source).toContain('data.plansFetchFailed');
    expect(source).toContain('Could not load plan completion data');
    expect(source).toContain('data.taskFetchFailed');
    expect(source).toContain('Could not load standalone tasks');
  });
});
