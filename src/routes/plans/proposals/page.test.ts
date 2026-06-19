import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

describe('/plans/proposals load', () => {
  it('marks proposal evidence fetch failures instead of treating them as no proposals', async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: 'operator session required' }, 401));

    const result = await load({
      fetch
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      proposals: [],
      total: 0,
      proposalsFetchFailed: true,
      proposalsFetchMessage: 'operator session required'
    });
  });

  it('does not mark a successful empty proposal read as a failure', async () => {
    const fetch = vi.fn(async () => jsonResponse({ evidence: [], stats: { total: 0 } }));

    const result = await load({
      fetch
    } as unknown as Parameters<typeof load>[0]);

    expect(result).toMatchObject({
      proposals: [],
      total: 0,
      proposalsFetchFailed: false,
      proposalsFetchMessage: ''
    });
  });

  it('renders explicit failure states and safe proposal links', () => {
    const source = readFileSync('src/routes/plans/proposals/+page.svelte', 'utf8');
    expect(source).toContain('data.proposalsFetchFailed');
    expect(source).toContain('Could not load Proposal Tracks');
    expect(source).toContain("await responseMessage(res, 'Adopt failed')");
    expect(source).toContain('safeUrlForTrackerLink(p.ref)');
    expect(source).toContain("href={safeUrlForTrackerLink(p.ref) ?? ''}");
    expect(source).not.toContain('href={p.ref}');
  });
});
