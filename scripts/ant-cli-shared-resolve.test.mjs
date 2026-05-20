import { describe, expect, it } from 'vitest';
import {
  resolveTerminalIdentifier,
  resolveChatRoomIdentifier,
  makeStandardSendJson
} from './ant-cli-shared-resolve.mjs';

class TestError extends Error {}

function mockRuntime(response) {
  return {
    serverUrl: 'http://test.local',
    fetchImpl: async () => ({
      ok: response.ok ?? true,
      status: response.status ?? 200,
      json: async () => response.body,
      text: async () => response.text ?? ''
    })
  };
}

describe('resolveTerminalIdentifier', () => {
  it('throws for blank identifier', async () => {
    await expect(resolveTerminalIdentifier(mockRuntime({}), '', TestError)).rejects.toThrow('terminal identifier');
  });

  it('matches by sessionId', async () => {
    const term = { sessionId: 'sess-1', name: 't1', handle: null, derivedHandle: null };
    const runtime = mockRuntime({ body: { terminals: [term] } });
    const result = await resolveTerminalIdentifier(runtime, 'sess-1', TestError);
    expect(result).toEqual(term);
  });

  it('matches by name', async () => {
    const term = { sessionId: 's', name: 'my-term', handle: null, derivedHandle: null };
    const runtime = mockRuntime({ body: { terminals: [term] } });
    const result = await resolveTerminalIdentifier(runtime, 'my-term', TestError);
    expect(result).toEqual(term);
  });

  it('matches by handle with @ prefix normalisation', async () => {
    const term = { sessionId: 's', name: 'n', handle: null, derivedHandle: '@codex' };
    const runtime = mockRuntime({ body: { terminals: [term] } });
    const result = await resolveTerminalIdentifier(runtime, 'codex', TestError);
    expect(result).toEqual(term);
  });

  it('throws when no match', async () => {
    const runtime = mockRuntime({ body: { terminals: [] } });
    await expect(resolveTerminalIdentifier(runtime, 'missing', TestError)).rejects.toThrow('no terminal matching');
  });

  it('throws on fetch failure', async () => {
    const runtime = mockRuntime({ ok: false, status: 503 });
    await expect(resolveTerminalIdentifier(runtime, 'any', TestError)).rejects.toThrow('could not list terminals');
  });

  it('throws on malformed response', async () => {
    const runtime = mockRuntime({ body: { terminals: 'not-array' } });
    await expect(resolveTerminalIdentifier(runtime, 'any', TestError)).rejects.toThrow('malformed');
  });
});

describe('resolveChatRoomIdentifier', () => {
  it('throws for blank identifier', async () => {
    await expect(resolveChatRoomIdentifier(mockRuntime({}), '', TestError)).rejects.toThrow('chat room identifier');
  });

  it('matches by id first', async () => {
    const room = { id: 'room-1', name: 'Room One' };
    const runtime = mockRuntime({ body: { chatRooms: [room] } });
    const result = await resolveChatRoomIdentifier(runtime, 'room-1', TestError);
    expect(result).toEqual(room);
  });

  it('matches by exact name', async () => {
    const room = { id: 'r', name: 'Exact Name' };
    const runtime = mockRuntime({ body: { chatRooms: [room] } });
    const result = await resolveChatRoomIdentifier(runtime, 'Exact Name', TestError);
    expect(result).toEqual(room);
  });

  it('matches by case-insensitive name', async () => {
    const room = { id: 'r', name: 'Mixed Case' };
    const runtime = mockRuntime({ body: { chatRooms: [room] } });
    const result = await resolveChatRoomIdentifier(runtime, 'mixed case', TestError);
    expect(result).toEqual(room);
  });

  it('prefers exact id over case-insensitive name', async () => {
    const a = { id: 'b', name: 'A' };
    const b = { id: 'a', name: 'B' };
    const runtime = mockRuntime({ body: { chatRooms: [a, b] } });
    const result = await resolveChatRoomIdentifier(runtime, 'a', TestError);
    expect(result).toEqual(b);
  });

  it('throws when no match', async () => {
    const runtime = mockRuntime({ body: { chatRooms: [] } });
    await expect(resolveChatRoomIdentifier(runtime, 'missing', TestError)).rejects.toThrow('no chat room matching');
  });

  it('throws on fetch failure', async () => {
    const runtime = mockRuntime({ ok: false, status: 500 });
    await expect(resolveChatRoomIdentifier(runtime, 'any', TestError)).rejects.toThrow('could not list chat-rooms');
  });

  it('throws on malformed response', async () => {
    const runtime = mockRuntime({ body: { chatRooms: 'not-array' } });
    await expect(resolveChatRoomIdentifier(runtime, 'any', TestError)).rejects.toThrow('malformed');
  });
});

describe('makeStandardSendJson', () => {
  it('GETs without body', async () => {
    const runtime = mockRuntime({ body: { ok: true } });
    const send = makeStandardSendJson(runtime);
    const result = await send('/test', 'GET');
    expect(result).toEqual({ ok: true });
  });

  it('POSTs with JSON body', async () => {
    let captured;
    const runtime = {
      serverUrl: 'http://test.local',
      fetchImpl: async (_url, init) => {
        captured = init;
        return { ok: true, status: 200, json: async () => ({ sent: true }), text: async () => '' };
      }
    };
    const send = makeStandardSendJson(runtime);
    await send('/test', 'POST', { foo: 'bar' });
    expect(captured.body).toBe(JSON.stringify({ foo: 'bar' }));
    expect(captured.headers['content-type']).toBe('application/json');
  });

  it('returns empty object on 204', async () => {
    const runtime = mockRuntime({ status: 204, body: {} });
    const send = makeStandardSendJson(runtime);
    const result = await send('/test', 'DELETE');
    expect(result).toEqual({});
  });

  it('throws on error response', async () => {
    const runtime = {
      serverUrl: 'http://test.local',
      fetchImpl: async () => ({
        ok: false,
        status: 400,
        json: async () => ({}),
        text: async () => 'bad request'
      })
    };
    const send = makeStandardSendJson(runtime);
    await expect(send('/test', 'GET')).rejects.toThrow('Request failed (400)');
  });
});
