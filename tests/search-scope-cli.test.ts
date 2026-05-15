/**
 * Unit tests for `ant search <query> --scope <kinds>` CLI extension.
 *
 * Backs M2.2 in DELIVERY-PLAN.md (Phase 2). Server-side scope dispatch
 * is exercised by stubbing fetch with a controlled response that
 * mirrors the new aggregated `{ results: [{ kind, ...row }] }` envelope.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { search } from '../cli/commands/search';

const originalFetch = globalThis.fetch;
const originalLog = console.log;
const originalErr = console.error;

let stdout: string[] = [];
let stderr: string[] = [];
let capturedRequests: Array<{ url: string }> = [];

beforeEach(() => {
  stdout = [];
  stderr = [];
  capturedRequests = [];
  console.log = (...parts: unknown[]) => { stdout.push(parts.map(String).join(' ')); };
  console.error = (...parts: unknown[]) => { stderr.push(parts.map(String).join(' ')); };
});

afterEach(() => {
  console.log = originalLog;
  console.error = originalErr;
  globalThis.fetch = originalFetch;
});

function stubFetch(handler: (url: string) => unknown) {
  globalThis.fetch = (async (url: string) => {
    capturedRequests.push({ url: String(url) });
    const body = handler(String(url));
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });
  }) as typeof fetch;
}

const ctx = { serverUrl: 'http://ant.test', apiKey: '', json: false };

describe('ant search <query> --scope', () => {
  it('default (no --scope) hits server without scope param + renders [messages] rows', async () => {
    stubFetch(() => ({
      results: [
        { kind: 'messages', session_id: 'sess-1', role: 'user', content: 'hello world', created_at: '2026-05-14T05:00:00Z', snippet: 'hello <mark>world</mark>' }
      ]
    }));
    await search(['hello'], {}, ctx);
    expect(capturedRequests[0].url).not.toMatch(/scope=/);
    expect(capturedRequests[0].url).toMatch(/q=hello/);
    expect(stdout.join('\n')).toMatch(/\[messages\]/);
    expect(stdout.join('\n')).toMatch(/sess-1/);
  });

  it('--scope plans propagates scope=plans + renders [plans] rows', async () => {
    stubFetch(() => ({
      results: [
        { kind: 'plans', session_id: 'O393IH1zFgd_nujpQgnof', text: 'M2.2 search scope kinds shipped', created_at: '2026-05-14T07:00:00Z' }
      ]
    }));
    await search(['M2.2'], { scope: 'plans' }, ctx);
    expect(capturedRequests[0].url).toMatch(/scope=plans/);
    expect(stdout.join('\n')).toMatch(/\[plans\]/);
    expect(stdout.join('\n')).toMatch(/M2.2 search scope kinds shipped/);
  });

  it('--scope tasks renders [tasks] rows with status + title + description', async () => {
    stubFetch(() => ({
      results: [
        { kind: 'tasks', id: 'task-42', status: 'proposed', title: 'extend scope kinds', description: 'add plans/tasks/docs to /api/search' }
      ]
    }));
    await search(['scope'], { scope: 'tasks' }, ctx);
    const out = stdout.join('\n');
    expect(out).toMatch(/\[tasks\]/);
    expect(out).toMatch(/task-42 status=proposed/);
    expect(out).toMatch(/add plans\/tasks\/docs/);
  });

  it('--scope docs renders [docs] rows with key + updated_at', async () => {
    stubFetch(() => ({
      results: [
        { kind: 'docs', key: 'docs/rooms-persistence-a', value: 'shipped 2026-05-14', updated_at: '2026-05-14T07:00:00Z' }
      ]
    }));
    await search(['persistence'], { scope: 'docs' }, ctx);
    const out = stdout.join('\n');
    expect(out).toMatch(/\[docs\]/);
    expect(out).toMatch(/docs\/rooms-persistence-a/);
    expect(out).toMatch(/shipped 2026-05-14/);
  });

  it('multi-scope --scope messages,plans CSV preserves order + renders both kinds', async () => {
    stubFetch(() => ({
      results: [
        { kind: 'messages', session_id: 's-a', role: 'user', content: 'hi', created_at: 't1', snippet: 'hi' },
        { kind: 'plans', session_id: 's-b', text: 'plan body', created_at: 't2' }
      ]
    }));
    await search(['mixed'], { scope: 'messages,plans' }, ctx);
    expect(capturedRequests[0].url).toMatch(/scope=messages%2Cplans/);
    const out = stdout.join('\n');
    expect(out).toMatch(/\[messages\]/);
    expect(out).toMatch(/\[plans\]/);
  });

  it('--json emits raw aggregated results envelope unchanged', async () => {
    const payload = {
      results: [
        { kind: 'tasks', id: 'task-1', status: 'done', title: 't1' },
        { kind: 'docs', key: 'docs/x', value: 'y', updated_at: 't' }
      ]
    };
    stubFetch(() => payload);
    await search(['anything'], { scope: 'tasks,docs' }, { ...ctx, json: true });
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0])).toEqual(payload.results);
  });

  it('empty results prints "No results found."', async () => {
    stubFetch(() => ({ results: [] }));
    await search(['nothingmatches'], {}, ctx);
    expect(stdout.join('\n')).toMatch(/No results found/);
  });

  it('missing query prints usage hint to stderr', async () => {
    stubFetch(() => ({ results: [] }));
    await search([], {}, ctx);
    expect(stderr.join('\n')).toMatch(/Usage: ant search/);
    expect(capturedRequests).toHaveLength(0);
  });

  // M2.2b artefacts scope: fans out across deck/sheet/tunnel/grant stores
  // server-side; each row carries sub_kind discriminator (deck/sheet/tunnel/grant).
  it('--scope artefacts renders [artefacts/<sub_kind>] rows for each sub-kind', async () => {
    stubFetch(() => ({
      results: [
        { kind: 'artefacts', sub_kind: 'deck', slug: 'rooms-persistence', title: 'Phase 5 deck', updated_at: 't1' },
        { kind: 'artefacts', sub_kind: 'sheet', slug: 'finance-q2', title: 'Q2 sheet', updated_at: 't2' },
        { kind: 'artefacts', sub_kind: 'tunnel', slug: 'demo', title: 'Demo tunnel', public_url: 'https://x.trycloudflare.com' },
        { kind: 'artefacts', sub_kind: 'grant', id: 'grant-7', topic: 'file-read', granted_to: '@viewer', status: 'active' }
      ]
    }));
    await search(['demo'], { scope: 'artefacts' }, ctx);
    const out = stdout.join('\n');
    expect(out).toContain('[artefacts/deck]');
    expect(out).toContain('rooms-persistence');
    expect(out).toContain('Phase 5 deck');
    expect(out).toContain('[artefacts/sheet]');
    expect(out).toContain('finance-q2');
    expect(out).toContain('Q2 sheet');
    expect(out).toContain('[artefacts/tunnel]');
    expect(out).toContain('https://x.trycloudflare.com');
    expect(out).toContain('[artefacts/grant]');
    expect(out).toContain('grant-7');
    expect(out).toContain('topic=file-read');
    expect(out).toContain('@viewer');
  });

  it('multi-scope --scope docs,artefacts CSV passes through + renders both kinds', async () => {
    stubFetch(() => ({
      results: [
        { kind: 'docs', key: 'docs/m2-2b', value: 'artefacts scope', updated_at: 't1' },
        { kind: 'artefacts', sub_kind: 'deck', slug: 'sl', title: 'Slice deck', updated_at: 't2' }
      ]
    }));
    await search(['m2.2b'], { scope: 'docs,artefacts' }, ctx);
    expect(capturedRequests[0].url).toMatch(/scope=docs%2Cartefacts/);
    const out = stdout.join('\n');
    expect(out).toMatch(/\[docs\]/);
    expect(out).toMatch(/\[artefacts\/deck\]/);
  });
});
