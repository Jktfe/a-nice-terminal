/**
 * MCP thin-index endpoint tests.
 *
 * Covers: resource list, single-verb detail, summary, error cases.
 *
 * Phase 1 / Lane C / evolveantdeep
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { manifestData } from '$lib/cli-manifest/manifest';

// We test the handler logic directly rather than spinning up a full server.
// This is the pattern used by other API tests in this codebase.
import { GET } from './+server';

function makeUrl(path: string): URL {
  return new URL(`http://localhost${path}`);
}

describe('GET /api/mcp/cli-verbs', () => {
  it('returns resource list with all verbs plus summary', async () => {
    const response = await GET({ url: makeUrl('/api/mcp/cli-verbs') } as any);
    const body = await response.json();

    expect(body.resources).toBeDefined();
    // First entry is the summary resource
    expect(body.resources[0].uri).toBe('ant://cli-verbs/_summary');
    expect(body.resources[0].name).toBe('CLI verb summary');
    // Remaining entries are verb resources
    expect(body.resources.length).toBe(manifestData.length + 1);
  });

  it('each verb resource has required MCP fields', async () => {
    const response = await GET({ url: makeUrl('/api/mcp/cli-verbs') } as any);
    const body = await response.json();

    for (const resource of body.resources.slice(1)) {
      expect(resource.uri).toMatch(/^ant:\/\/cli-verbs\//);
      expect(resource.name).toBeTruthy();
      expect(resource.description).toBeTruthy();
      expect(resource.mimeType).toBe('application/json');
    }
  });

  it('returns single verb detail when ?verb= is provided', async () => {
    const firstVerb = manifestData[0];
    const response = await GET({ url: makeUrl(`/api/mcp/cli-verbs?verb=${firstVerb.id}`) } as any);
    const body = await response.json();

    expect(body.contents).toBeDefined();
    expect(body.contents.length).toBe(1);
    expect(body.contents[0].uri).toBe(`ant://cli-verbs/${firstVerb.id}`);
    expect(body.contents[0].mimeType).toBe('application/json');

    const parsed = JSON.parse(body.contents[0].text);
    expect(parsed.id).toBe(firstVerb.id);
    expect(parsed.usage).toBe(firstVerb.usage);
    expect(parsed.summary).toBe(firstVerb.summary);
    expect(parsed.status).toBe(firstVerb.status);
  });

  it('returns 404 for unknown verb id', async () => {
    const response = await GET({ url: makeUrl('/api/mcp/cli-verbs?verb=nonexistent-verb-id') } as any);
    expect(response.status).toBe(404);
    const body = await response.json();
    expect(body.error).toContain('not found');
  });

  it('verb detail includes flags when present', async () => {
    const verbWithFlags = manifestData.find((v) => v.flags.length > 0);
    if (!verbWithFlags) return; // skip if no verbs have flags

    const response = await GET({ url: makeUrl(`/api/mcp/cli-verbs?verb=${verbWithFlags.id}`) } as any);
    const body = await response.json();
    const parsed = JSON.parse(body.contents[0].text);

    expect(parsed.flags).toBeDefined();
    expect(parsed.flags.length).toBeGreaterThan(0);
    expect(parsed.flags[0].name).toBeTruthy();
    expect(parsed.flags[0].type).toBeTruthy();
  });
});

describe('GET /api/mcp/cli-verbs/_summary', () => {
  it('returns flat verb list with counts', async () => {
    const { GET: summaryGet } = await import('./_summary/+server');
    const response = await summaryGet();
    const body = await response.json();

    expect(body.total).toBe(manifestData.length);
    expect(body.verbs).toBeDefined();
    expect(body.verbs.length).toBe(manifestData.length);
    expect(typeof body.available).toBe('number');
    expect(typeof body.needsWrapper).toBe('number');
    expect(typeof body.planned).toBe('number');
  });

  it('each summary verb has minimal fields', async () => {
    const { GET: summaryGet } = await import('./_summary/+server');
    const response = await summaryGet();
    const body = await response.json();

    for (const verb of body.verbs) {
      expect(verb.id).toBeTruthy();
      expect(verb.usage).toBeTruthy();
      expect(verb.summary).toBeTruthy();
      expect(['available', 'needs-wrapper', 'planned']).toContain(verb.status);
    }
  });
});
