import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { GET } from './+server';

type AnyHandler = (event: unknown) => unknown;

function eventFor(path: string, params: Record<string, string>): unknown {
  const url = new URL(`http://localhost${path}`);
  const request = new Request(url.toString(), { method: 'GET' });
  return { request, params, url };
}

async function runHandler(handler: AnyHandler, event: unknown): Promise<Response> {
  try { return (await handler(event)) as Response; }
  catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const httpFailure = thrown as { status?: number; body?: { message?: string } };
    if (typeof httpFailure?.status === 'number') {
      return new Response(JSON.stringify(httpFailure.body ?? {}), { status: httpFailure.status });
    }
    throw thrown;
  }
}

describe('GET /api/skills/[skillId]/protocol', () => {
  it('SP1: returns skill protocol files for create-verification-lens', async () => {
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor('/api/skills/create-verification-lens/protocol', { skillId: 'create-verification-lens' }));
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.skill_id).toBe('create-verification-lens');
    expect(body.description).toContain('verification lens');
    expect(body.files).toBeInstanceOf(Array);
    expect(body.files.length).toBeGreaterThanOrEqual(2);
    // Each file has path + content
    for (const f of body.files) {
      expect(f.path).toMatch(/^docs\/specs\//);
      expect(typeof f.content).toBe('string');
      expect(f.content.length).toBeGreaterThan(100);
    }
  });

  it('SP2: returns 404 for unknown skill', async () => {
    const response = await runHandler(GET as unknown as AnyHandler,
      eventFor('/api/skills/no-such-skill/protocol', { skillId: 'no-such-skill' }));
    expect(response.status).toBe(404);
  });
});
