// Route test for /discover.md — asserts content-type and that the body
// includes manifest-derived markers so the route stays in sync with the
// renderer.
import { describe, expect, it } from 'vitest';
import { GET } from './+server';
import { manifestData } from '$lib/cli-manifest/manifest';

describe('GET /discover.md', () => {
  it('responds 200 with text/markdown content-type', async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toContain('text/markdown');
  });

  it('disables caching so the manifest source-of-truth always wins', async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    expect(response.headers.get('cache-control')).toBe('no-store');
  });

  it('body contains the H1 title and total verb count', async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    const body = await response.text();
    expect(body).toContain('# ant CLI verbs');
    expect(body).toContain(`**Total verbs:** ${manifestData.length}`);
  });

  it('body contains every verb id as an anchor', async () => {
    const response = await GET({} as Parameters<typeof GET>[0]);
    const body = await response.text();
    for (const verb of manifestData) {
      expect(body, `verb ${verb.id} anchor missing`).toContain(`<a id="verb-${verb.id}"></a>`);
    }
  });
});
