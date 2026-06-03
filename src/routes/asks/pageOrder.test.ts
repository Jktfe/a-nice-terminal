import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/asks page ordering', () => {
  it('renders definite open asks before potential ask candidates', () => {
    const source = readFileSync('src/routes/asks/+page.svelte', 'utf8');

    const openAskListIndex = source.indexOf('<ul class="ask-list" aria-label="Open asks queue">');
    const candidateReviewIndex = source.indexOf('<section class="candidate-section" aria-labelledby="ask-candidates-heading">');

    expect(openAskListIndex).toBeGreaterThan(-1);
    expect(candidateReviewIndex).toBeGreaterThan(-1);
    expect(openAskListIndex).toBeLessThan(candidateReviewIndex);
  });

  it('loads the server operator handle for ask actions', async () => {
    const fetch = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === '/api/asks') {
        return jsonResponse({ asks: [], recentlyAnswered: [], candidates: [] });
      }
      if (url === '/api/chair') {
        return jsonResponse({ chairDigest: [] });
      }
      if (url === '/api/capabilities') {
        return jsonResponse({ operatorHandle: '@JWPK' });
      }
      return jsonResponse({}, 404);
    });

    const data = await load({ fetch } as unknown as Parameters<typeof load>[0]) as { operatorHandle: string };

    expect(fetch).toHaveBeenCalledWith('/api/capabilities');
    expect(data.operatorHandle).toBe('@JWPK');
  });

  it('does not hardcode the legacy @you handle for ask actions', () => {
    const source = readFileSync('src/routes/asks/+page.svelte', 'utf8');

    expect(source).not.toContain("const ACTOR_HANDLE = '@you'");
    expect(source).toContain('operatorHandle');
    expect(source).toContain('actorHandle: operatorHandle');
  });
});
