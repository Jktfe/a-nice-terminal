import { describe, expect, it } from 'vitest';
import { handleInterviewVerb } from './ant-cli-interview.mjs';

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

describe('ant interview CLI', () => {
  it('start: POST /api/chat-rooms/<room>/interviews + subjectHandle + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ interview: { id: 'iv_abc', interviewer: '@you', subject_handle: '@kimi' } }, 201));
    await handleInterviewVerb('start', ['--room', 'room-a', '--with', '@kimi'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/chat-rooms/room-a/interviews');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = bodyAt(captured);
    expect(body.subjectHandle).toBe('@kimi');
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join(' ')).toMatch(/Interview started: iv_abc/);
  });

  it('start: throws CliInputError when --room missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleInterviewVerb('start', ['--with', '@kimi'], runtime, { CliInputError }))
      .rejects.toThrow(/missing required flag --room/);
  });

  it('start: throws CliInputError when --with missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleInterviewVerb('start', ['--room', 'room-a'], runtime, { CliInputError }))
      .rejects.toThrow(/missing required flag --with/);
  });

  it('end: PATCH /api/interviews/<id>/end + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ interview: { id: 'iv_abc' }, changed: true }));
    await handleInterviewVerb('end', ['iv_abc'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/interviews/iv_abc/end');
    expect(captured.requests[0].init.method).toBe('PATCH');
    const body = bodyAt(captured);
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(body.reason).toBeUndefined();
    expect(captured.stdout.join(' ')).toMatch(/Interview iv_abc ended/);
  });

  it('end: --reason persists into body', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ changed: true }));
    await handleInterviewVerb('end', ['iv_x', '--reason', 'wrap-up'], runtime, { CliInputError });
    expect(bodyAt(captured).reason).toBe('wrap-up');
  });

  it('end: throws CliInputError when interview-id positional missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleInterviewVerb('end', [], runtime, { CliInputError }))
      .rejects.toThrow(/missing interview-id positional/);
  });

  it('--json emits raw envelope on both start and end', async () => {
    const payload = { interview: { id: 'iv_j', subject_handle: '@k' } };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleInterviewVerb('start', ['--room', 'r', '--with', '@k', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('unknown verb throws CliInputError', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleInterviewVerb('unknown', [], runtime, { CliInputError }))
      .rejects.toThrow(/unknown interview verb/);
  });

  it('send: POST /api/interviews/<id>/messages + body + pidChain', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ message: { id: 'msg_abc' } }, 201));
    await handleInterviewVerb('send', ['iv_abc', '--msg', 'hello there'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/interviews/iv_abc/messages');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = bodyAt(captured);
    expect(body.body).toBe('hello there');
    expect(Array.isArray(body.pidChain)).toBe(true);
    expect(captured.stdout.join(' ')).toMatch(/Sent into interview iv_abc: msg_abc/);
  });

  it('send: throws CliInputError when --msg missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleInterviewVerb('send', ['iv_abc'], runtime, { CliInputError }))
      .rejects.toThrow(/missing required flag --msg/);
  });

  it('send: throws CliInputError when interview-id positional missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleInterviewVerb('send', ['--msg', 'hi'], runtime, { CliInputError }))
      .rejects.toThrow(/missing interview-id positional/);
  });

  it('summary: GET /api/interviews/<id>/summary + renders headline', async () => {
    const summaryPayload = {
      summary: {
        interview: { id: 'iv_s', room_id: 'r1', interviewer: '@i', subject_handle: '@s' },
        status: 'ended',
        durationMs: 65000,
        messageCountTotal: 3,
        messageCountByAuthor: [{ authorHandle: '@i', count: 2 }, { authorHandle: '@s', count: 1 }],
        firstMessage: { id: 'm1', authorHandle: '@i', kind: 'human', postedAt: 't1', summary: 'opener' },
        middleMessage: { id: 'm2', authorHandle: '@s', kind: 'human', postedAt: 't2', summary: 'mid' },
        lastMessage: { id: 'm3', authorHandle: '@i', kind: 'human', postedAt: 't3', summary: 'wrap' }
      }
    };
    const { runtime, captured } = makeRuntime(() => okJson(summaryPayload));
    await handleInterviewVerb('summary', ['iv_s'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/interviews/iv_s/summary');
    const text = captured.stdout.join('\n');
    expect(text).toMatch(/Interview iv_s \(ended\)/);
    expect(text).toMatch(/Messages: +3/);
    expect(text).toMatch(/@i: 2/);
    expect(text).toMatch(/First: +@i: opener/);
  });

  it('summary: --json emits raw envelope', async () => {
    const payload = { summary: { interview: { id: 'iv_j' }, messageCountTotal: 0 } };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleInterviewVerb('summary', ['iv_j', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('summary: throws CliInputError when interview-id positional missing', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(handleInterviewVerb('summary', [], runtime, { CliInputError }))
      .rejects.toThrow(/missing interview-id positional/);
  });
});
