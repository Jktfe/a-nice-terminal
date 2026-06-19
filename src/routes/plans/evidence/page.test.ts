import { readFileSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { load } from './+page';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function loadArgs(fetch: typeof globalThis.fetch, href = 'http://x/plans/evidence') {
  return {
    fetch,
    url: new URL(href)
  } as unknown as Parameters<typeof load>[0];
}

describe('/plans/evidence load', () => {
  it('marks evidence fetch failures instead of treating them as no evidence', async () => {
    const fetch = vi.fn(async () => jsonResponse({ message: 'Authentication required.' }, 401));

    const result = await load(loadArgs(fetch));

    expect(result).toMatchObject({
      evidence: [],
      evidenceFetchFailed: true,
      evidenceFetchMessage: 'Authentication required.',
      stats: {
        total: 0,
        withLabel: 0
      }
    });
  });

  it('keeps successful empty evidence reads distinct from failures', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        evidence: [],
        stats: {
          total: 0,
          withLabel: 0,
          byKind: {
            run_event: 0,
            task: 0,
            url: 0,
            file: 0,
            chat_message: 0,
            proposal: 0,
            stage_focus: 0,
            stage_pause_context: 0,
            stage_feedback: 0,
            stage_alternative: 0,
            stage_alternative_decision: 0
          }
        }
      })
    );

    const result = await load(loadArgs(fetch));

    expect(result).toMatchObject({
      evidence: [],
      evidenceFetchFailed: false,
      evidenceFetchMessage: ''
    });
  });

  it('preserves valid URL filters while calling the evidence API', async () => {
    const fetch = vi.fn(async () =>
      jsonResponse({
        evidence: [],
        stats: {
          total: 0,
          withLabel: 0,
          byKind: {
            run_event: 0,
            task: 0,
            url: 0,
            file: 0,
            chat_message: 0,
            proposal: 0,
            stage_focus: 0,
            stage_pause_context: 0,
            stage_feedback: 0,
            stage_alternative: 0,
            stage_alternative_decision: 0
          }
        }
      })
    );

    await load(loadArgs(fetch, 'http://x/plans/evidence?kind=url&planId=plan_1&q=demo'));

    expect(fetch).toHaveBeenCalledWith('/api/plans/evidence?kind=url&planId=plan_1&q=demo');
  });

  it('renders explicit failure states and safe evidence URL links', () => {
    const source = readFileSync('src/routes/plans/evidence/+page.svelte', 'utf8');
    expect(source).toContain('data.evidenceFetchFailed');
    expect(source).toContain('Could not load evidence');
    expect(source).toContain('safeUrlForTrackerLink(row.ref)');
    expect(source).toContain("href={safeUrlForTrackerLink(row.ref) ?? ''}");
    expect(source).not.toContain('href={row.ref}');
  });
});
