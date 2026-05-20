import { describe, expect, it } from 'vitest';
import { handleChairVerb } from './ant-cli-chair.mjs';

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

describe('ant chair CLI', () => {
  it('enable: PUT /api/chair-enabled with body {enabled:true, pidChain}', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ enabled: true }));
    await handleChairVerb('enable', [], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chair-enabled');
    expect(captured.requests[0].init.method).toBe('PUT');
    const body = bodyAt(captured);
    expect(body.enabled).toBe(true);
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join(' ')).toMatch(/Chair enabled/);
  });

  it('disable: PUT /api/chair-enabled with body {enabled:false, pidChain}', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ enabled: false }));
    await handleChairVerb('disable', [], runtime, { CliInputError });
    expect(bodyAt(captured).enabled).toBe(false);
    expect(captured.stdout.join(' ')).toMatch(/Chair disabled/);
  });

  it('handoff: POST /api/chat-rooms/<room>/chair/handoff with toHandle + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ currentChairHandle: '@codex', changed: true }));
    await handleChairVerb('handoff', ['room-a', '--to', '@codex'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/chair/handoff');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = bodyAt(captured);
    expect(body.toHandle).toBe('@codex');
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join(' ')).toMatch(/Chair in room-a handed to @codex/);
  });

  it('handoff: throws CliInputError when --to missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleChairVerb('handoff', ['room-a'], runtime, { CliInputError }))
      .rejects.toThrow(/missing required flag --to/);
  });

  it('handoff: throws CliInputError when room-id positional missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleChairVerb('handoff', ['--to', '@codex'], runtime, { CliInputError }))
      .rejects.toThrow(/missing room-id positional/);
  });

  it('board: GET /api/chair + client-filter by roomId; prints digest fields', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      chairDigest: [
        { roomId: 'room-a', messageCount: 7, attentionState: 'ready' },
        { roomId: 'room-b', messageCount: 2, attentionState: 'idle' }
      ]
    }));
    await handleChairVerb('board', ['room-a'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chair');
    const out = captured.stdout.join('\n');
    expect(out).toMatch(/Chair board for room-a/);
    expect(out).toMatch(/messageCount.*7/);
    expect(out).not.toMatch(/room-b/);
  });

  it('board: missing room digest prints "No chair digest for room <id>"', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ chairDigest: [] }));
    await handleChairVerb('board', ['room-z'], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toMatch(/No chair digest for room room-z/);
  });

  it('--json on board emits raw envelope for the matched row', async () => {
    const digest = { roomId: 'room-a', messageCount: 5 };
    const { runtime, captured } = makeRuntime(() => okJson({ chairDigest: [digest] }));
    await handleChairVerb('board', ['room-a', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(digest);
  });

  it('unknown verb throws CliInputError', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleChairVerb('unknown', [], runtime, { CliInputError }))
      .rejects.toThrow(/unknown chair verb/);
  });
});
