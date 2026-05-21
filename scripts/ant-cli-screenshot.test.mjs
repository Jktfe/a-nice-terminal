import { describe, expect, it } from 'vitest';
import { handleScreenshotVerb } from './ant-cli-screenshot.mjs';

class CliInputError extends Error {}

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return responseBuilder(captured.requests.length, { url, init });
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

const okJson = (body, status = 200) => ({ ok: true, status, json: async () => body, text: async () => JSON.stringify(body) });
const bodyAt = (captured, index = 0) => JSON.parse(captured.requests[index].init.body);

describe('ant screenshot CLI', () => {
  it('enable: PUT /api/chat-rooms/<room>/screenshots/enable with {enabled:true, pidChain}', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ enabled: true }));
    await handleScreenshotVerb('enable', ['room-a'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/screenshots/enable');
    expect(captured.requests[0].init.method).toBe('PUT');
    const body = bodyAt(captured);
    expect(body.enabled).toBe(true);
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join(' ')).toMatch(/enabled for room-a/);
  });

  it('disable: PUT with {enabled:false}', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ enabled: false }));
    await handleScreenshotVerb('disable', ['room-a'], runtime, { CliInputError });
    expect(bodyAt(captured).enabled).toBe(false);
    expect(captured.stdout.join(' ')).toMatch(/disabled for room-a/);
  });

  it('list: GET + renders rows + handles empty list', async () => {
    const rows = [
      { sha: 'a'.repeat(64), taken_at_ms: 1700000000000, taken_by: '@you', bytes: 1024 },
      { sha: 'b'.repeat(64), taken_at_ms: 1700000001000, taken_by: '@codex', bytes: 2048 }
    ];
    const { runtime, captured } = makeRuntime(() => okJson({ screenshots: rows }));
    await handleScreenshotVerb('list', ['room-a'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/screenshots');
    const out = captured.stdout.join('\n');
    expect(out).toMatch(/2 screenshot\(s\)/);
    expect(out).toContain('aaaaaaaaaaaa');
    expect(out).toContain('@you');
  });

  it('list: empty list prints "No screenshots in <room>"', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ screenshots: [] }));
    await handleScreenshotVerb('list', ['room-empty'], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toMatch(/No screenshots in room-empty/);
  });

  it('throws CliInputError when room positional missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleScreenshotVerb('enable', [], runtime, { CliInputError }))
      .rejects.toThrow(/missing required flag --room/);
  });

  it('--json on list emits raw envelope', async () => {
    const payload = { screenshots: [{ sha: 'x'.repeat(64), bytes: 100 }] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleScreenshotVerb('list', ['room-a', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('unknown verb throws CliInputError', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleScreenshotVerb('frobnicate', [], runtime, { CliInputError }))
      .rejects.toThrow(/unknown screenshot verb/);
  });

  it('prune: POST + pidChain body + soft-delete summary on changed=true', async () => {
    const sha = 'a'.repeat(64);
    const { runtime, captured } = makeRuntime(() => okJson({ sha, changed: true }));
    await handleScreenshotVerb('prune', ['room-a', '--sha', sha], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe(`http://test.local/api/chat-rooms/room-a/screenshots/${sha}/prune`);
    expect(captured.requests[0].init.method).toBe('POST');
    const body = bodyAt(captured);
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join(' ')).toMatch(/Soft-deleted aaaaaaaaaaaa/);
  });

  it('prune: idempotent — "Already pruned" on changed=false', async () => {
    const sha = 'b'.repeat(64);
    const { runtime, captured } = makeRuntime(() => okJson({ sha, changed: false }));
    await handleScreenshotVerb('prune', ['room-a', '--sha', sha], runtime, { CliInputError });
    expect(captured.stdout.join(' ')).toMatch(/Already pruned: bbbbbbbbbbbb/);
  });

  it('prune: requires --sha flag', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleScreenshotVerb('prune', ['room-a'], runtime, { CliInputError }))
      .rejects.toThrow(/missing required flag --sha/);
  });

  it('take: reads --file, POSTs base64 + pidChain, prints canonical-path on inserted', async () => {
    const fakeFs = {
      readFile: async () => Buffer.from([0x89, 0x50, 0x4e, 0x47]) // PNG magic
    };
    const sha = 'a'.repeat(64);
    const { runtime, captured } = makeRuntime(() =>
      okJson({ kind: 'inserted', sha, canonicalPath: '/uploads/rooms/room-a/screenshots/' + sha + '.png', row: {} })
    );
    await handleScreenshotVerb('take', ['room-a', '--file', '/tmp/cap.png'], runtime, { CliInputError, fs: fakeFs });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/screenshots');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = bodyAt(captured);
    expect(body.bytes).toBe(Buffer.from([0x89, 0x50, 0x4e, 0x47]).toString('base64'));
    expect(body.takenBy).toBe('@cli');
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join(' ')).toMatch(/Captured aaaaaaaaaaaa/);
  });

  it('take: kind=existing prints "Already-seen"', async () => {
    const fakeFs = { readFile: async () => Buffer.from([0x89]) };
    const { runtime, captured } = makeRuntime(() =>
      okJson({ kind: 'existing', sha: 'b'.repeat(64), canonicalPath: '/x.png', row: {} })
    );
    await handleScreenshotVerb('take', ['room-a', '--file', '/tmp/d.png'], runtime, { CliInputError, fs: fakeFs });
    expect(captured.stdout.join(' ')).toMatch(/Already-seen bbbbbbbbbbbb/);
  });

  it('take: requires --file flag', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleScreenshotVerb('take', ['room-a'], runtime, { CliInputError }))
      .rejects.toThrow(/missing required flag --file/);
  });
});
