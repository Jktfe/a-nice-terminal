import { describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';

const okJson = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });

describe('ant queue dispatcher', () => {
  it('routes ant queue list through the top-level CLI dispatcher', async () => {
    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => {
        calls.push({ url, init });
        return okJson({ items: [] });
      },
      writeOut: () => {},
      writeErr: () => {}
    });

    const code = await runner.run(['queue', 'list', '--room', 'room-a']);

    expect(code).toBe(0);
    expect(calls[0].url).toBe('http://test.local/api/chat-rooms/room-a/queue');
  });
});
