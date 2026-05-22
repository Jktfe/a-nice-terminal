import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleDecksVerb } from './ant-cli-decks.mjs';
import * as identityChain from './ant-cli-identity-chain.mjs';

class CliInputError extends Error {}

function okJson(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

function makeRuntime(responseBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url: String(url), init });
    return responseBuilder(captured.requests.length, { url: String(url), init });
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

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ant decks', () => {
  it('list sends pidChain query auth so agents can discover room decks', async () => {
    vi.spyOn(identityChain, 'processIdentityChain').mockReturnValue([{ pid: 77, pid_start: 'deck-reader' }]);
    const { runtime, captured } = makeRuntime(() => okJson({
      decks: [{ id: 'deck-1', title: 'Stage Deck', slides: [{ title: 'One' }] }]
    }));

    const code = await handleDecksVerb('list', ['--room', 'room-1', '--json'], runtime, { CliInputError });

    expect(code).toBe(0);
    const url = new URL(captured.requests[0].url);
    expect(`${url.origin}${url.pathname}`).toBe('http://test.local/api/chat-rooms/room-1/decks');
    expect(JSON.parse(url.searchParams.get('pidChain'))).toEqual([{ pid: 77, pid_start: 'deck-reader' }]);
    expect(JSON.parse(captured.stdout[0])[0]).toMatchObject({ id: 'deck-1', title: 'Stage Deck' });
  });
});
