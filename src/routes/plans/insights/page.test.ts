import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/plans/insights load', () => {
  it('surfaces operator auth failures instead of rendering an empty dashboard shell', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      expect(String(input)).toBe('/api/plans/insights');
      return jsonResponse({ message: 'Authentication required.' }, 401);
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans/insights')
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      insights: null,
      insightsFetchFailed: true,
      insightsFetchStatus: 401,
      insightsFetchMessage:
        'Could not load plan insights because this dashboard needs an authenticated operator session.'
    });
  });

  it('surfaces transport failures with actionable retry copy', async () => {
    const fetch = vi.fn(async () => {
      throw new TypeError('network down');
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans/insights')
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      insights: null,
      insightsFetchFailed: true,
      insightsFetchStatus: null,
      insightsFetchMessage: 'Could not load plan insights. Check the connection and try again.'
    });
  });

  it('renders an explicit alert for insights fetch failures', () => {
    const source = readFileSync('src/routes/plans/insights/+page.svelte', 'utf8');
    expect(source).toContain('data.insightsFetchFailed');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Insights did not load.');
    expect(source).toContain('data.insightsFetchMessage');
  });
});
