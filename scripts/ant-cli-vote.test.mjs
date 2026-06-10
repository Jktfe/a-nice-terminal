import { describe, expect, it } from 'vitest';
import { handleVoteVerb } from './ant-cli-vote.mjs';

class CliInputError extends Error {}

function makeRuntime(handlers) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    const parsed = new URL(url);
    const key = parsed.pathname + parsed.search;
    const handler = handlers[key] ?? handlers[parsed.pathname];
    if (!handler) return response(404, { message: 'no handler' });
    return typeof handler === 'function' ? handler({ url, init }) : handler;
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

function response(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

const rooms = response(200, {
  chatRooms: [
    { id: 'room-a', name: 'Alpha' },
    { id: 'room-b', name: 'Beta' }
  ]
});

const vote = {
  id: 'vote_1',
  title: 'Pick one',
  state: 'open',
  open: true,
  complete: false,
  roomIds: ['room-a', 'room-b'],
  eligibleVoters: ['@a', '@b'],
  missingVoters: ['@a'],
  options: [
    { id: 'opt_1', label: 'yes', sortOrder: 0 },
    { id: 'opt_2', label: 'no', sortOrder: 1 }
  ],
  tally: [
    { optionId: 'opt_1', label: 'yes', count: 1 },
    { optionId: 'opt_2', label: 'no', count: 0 }
  ],
  ballots: []
};

describe('ant vote CLI', () => {
  it('create resolves rooms and posts variables required for a durable vote', async () => {
    const posts = [];
    const { runtime, captured } = makeRuntime({
      '/api/chat-rooms': rooms,
      '/api/votes': ({ init }) => {
        posts.push(JSON.parse(init.body));
        return response(201, { vote });
      }
    });

    const code = await handleVoteVerb(
      'create',
      ['--room', 'Alpha', '--rooms', 'Beta', '--title', 'Pick one', '--options', 'yes,no', '--voters', '@a,@b'],
      runtime,
      { CliInputError }
    );

    expect(code).toBe(0);
    expect(posts).toHaveLength(1);
    expect(posts[0].roomId).toBe('room-a');
    expect(posts[0].roomIds).toEqual(['room-b']);
    expect(posts[0].eligibleVoters).toEqual(['@a', '@b']);
    expect(Array.isArray(posts[0].pidChain)).toBe(true);
    expect(captured.stdout.join('\n')).toContain('vote_1');
  });

  it('list resolves the room and prints vote state', async () => {
    const { runtime, captured } = makeRuntime({
      '/api/chat-rooms': rooms,
      '/api/votes': ({ url }) => {
        const parsed = new URL(url);
        expect(parsed.searchParams.get('roomId')).toBe('room-a');
        expect(parsed.searchParams.get('pidChain')).toBeTruthy();
        return response(200, { votes: [vote] });
      }
    });

    const code = await handleVoteVerb('list', ['--room', 'Alpha'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(captured.stdout[0]).toMatch(/vote_1\s+open\s+Pick one/);
  });

  it('cast posts option, room, reason, and pidChain', async () => {
    const posts = [];
    const { runtime } = makeRuntime({
      '/api/chat-rooms': rooms,
      // cast now fetches the room-scoped vote first to resolve --option.
      '/api/votes/vote_1': () => response(200, { vote, history: [] }),
      '/api/votes/vote_1/cast': ({ init }) => {
        posts.push(JSON.parse(init.body));
        return response(200, { vote: { ...vote, state: 'complete', complete: true, missingVoters: [] } });
      }
    });

    const code = await handleVoteVerb(
      'cast',
      ['vote_1', '--room', 'Alpha', '--option', 'opt_1', '--reason', 'green'],
      runtime,
      { CliInputError }
    );

    expect(code).toBe(0);
    expect(posts[0]).toMatchObject({ roomId: 'room-a', optionId: 'opt_1', reason: 'green' });
    expect(Array.isArray(posts[0].pidChain)).toBe(true);
  });

  it('cast resolves --option by label to the matching option id (id path preserved)', async () => {
    const posts = [];
    const { runtime } = makeRuntime({
      '/api/chat-rooms': rooms,
      '/api/votes/vote_1': () => response(200, { vote, history: [] }),
      '/api/votes/vote_1/cast': ({ init }) => {
        posts.push(JSON.parse(init.body));
        return response(200, { vote: { ...vote, state: 'complete', complete: true, missingVoters: [] } });
      }
    });

    // --option by LABEL ("yes") resolves through the room-scoped vote to opt_1.
    const byLabel = await handleVoteVerb('cast', ['vote_1', '--room', 'Alpha', '--option', 'yes'], runtime, {
      CliInputError
    });
    expect(byLabel).toBe(0);
    expect(posts[0]).toMatchObject({ roomId: 'room-a', optionId: 'opt_1' });

    // --option by ID ("opt_2") still posts that id unchanged.
    const byId = await handleVoteVerb('cast', ['vote_1', '--room', 'Alpha', '--option', 'opt_2'], runtime, {
      CliInputError
    });
    expect(byId).toBe(0);
    expect(posts[1]).toMatchObject({ roomId: 'room-a', optionId: 'opt_2' });
  });

  it('cast rejects an unknown --option with a helpful error', async () => {
    const { runtime } = makeRuntime({
      '/api/chat-rooms': rooms,
      '/api/votes/vote_1': () => response(200, { vote, history: [] })
    });
    await expect(
      handleVoteVerb('cast', ['vote_1', '--room', 'Alpha', '--option', 'maybe'], runtime, { CliInputError })
    ).rejects.toThrow(/not found/);
  });

  it('show --json prints the raw server payload', async () => {
    const { runtime, captured } = makeRuntime({
      '/api/chat-rooms': rooms,
      '/api/votes/vote_1': ({ url }) => {
        const parsed = new URL(url);
        expect(parsed.searchParams.get('roomId')).toBe('room-a');
        expect(parsed.searchParams.get('pidChain')).toBeTruthy();
        return response(200, { vote });
      }
    });

    const code = await handleVoteVerb('show', ['vote_1', '--room', 'Alpha', '--json'], runtime, { CliInputError });

    expect(code).toBe(0);
    expect(JSON.parse(captured.stdout[0]).vote.id).toBe('vote_1');
  });
});
