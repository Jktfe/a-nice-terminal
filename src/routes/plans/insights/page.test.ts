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
      if (String(input) === '/api/capabilities') {
        return jsonResponse({ operatorHandle: '@JWPK', viewerHandle: '@JWPK' });
      }
      if (String(input) === '/api/plans/insights') {
        return jsonResponse({ message: 'Authentication required.' }, 401);
      }
      return jsonResponse({}, 404);
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans/insights')
    } as unknown as Parameters<typeof load>[0]);

    expect(fetch).toHaveBeenCalledWith('/api/plans/insights');
    expect(result).toMatchObject({
      insights: null,
      insightsLocked: false,
      insightsFetchFailed: true,
      insightsFetchStatus: 401,
      insightsFetchMessage:
        'Could not load plan insights because this dashboard needs an authenticated operator session.'
    });
  });

  it('does not call the global insights endpoint for a non-operator browser viewer', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/capabilities') {
        return jsonResponse({ operatorHandle: '@JWPK', viewerHandle: '@newantcodexfixer' });
      }
      if (String(input) === '/api/plans/insights') {
        return jsonResponse({ message: 'should not be called' }, 500);
      }
      return jsonResponse({}, 404);
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans/insights')
    } as unknown as Parameters<typeof load>[0]);

    expect(fetch).not.toHaveBeenCalledWith('/api/plans/insights');
    expect(result).toMatchObject({
      insights: null,
      insightsLocked: true,
      insightsFetchFailed: false,
      insightsFetchStatus: null,
      insightsFetchMessage: null
    });
  });

  it('surfaces endpoint failures for an operator browser viewer with actionable retry copy', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/capabilities') {
        return jsonResponse({ operatorHandle: '@JWPK', viewerHandle: '@JWPK' });
      }
      if (String(input) === '/api/plans/insights') {
        throw new TypeError('network down');
      }
      return jsonResponse({}, 404);
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans/insights')
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      insights: null,
      insightsLocked: false,
      insightsFetchFailed: true,
      insightsFetchStatus: null,
      insightsFetchMessage: 'Could not load plan insights. Check the connection and try again.'
    });
  });

  it('keeps transport failures quiet when the viewer is not the operator', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      if (String(input) === '/api/capabilities') {
        return jsonResponse({ operatorHandle: '@JWPK', viewerHandle: '@agent' });
      }
      return jsonResponse({ message: 'Authentication required.' }, 401);
    });

    const result = await load({
      fetch,
      url: new URL('http://localhost/plans/insights')
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      insights: null,
      insightsLocked: true,
      insightsFetchFailed: false,
      insightsFetchStatus: null,
      insightsFetchMessage: null
    });
  });

  it('renders an explicit alert for insights fetch failures', () => {
    const source = readFileSync('src/routes/plans/insights/+page.svelte', 'utf8');
    expect(source).toContain('data.insightsLocked');
    expect(source).toContain('data.insightsFetchFailed');
    expect(source).toContain('role="alert"');
    expect(source).toContain('Insights did not load.');
    expect(source).toContain('data.insightsFetchMessage');
  });
});
