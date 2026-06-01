// CLI tests for `ant invite join-url` subverb.
// JWPK msg_7i2h8klrtp: single-line "use this {cli link} with [password]
// and join the chatroom as [@handle]" for bash-only agents.
//
// Acceptance:
//   J1: parses /mcp/room/:roomId?invite=:inv URL, posts exchange + redeem
//       to the URL's origin (NOT the operator's local serverUrl).
//   J2: missing --password or --handle rejects before any network call.
//   J3: malformed URL rejects before any network call.
//   J4: exchange 4xx halts before redeem; password never echoed in error
//       output.
//   J5: --print-token surfaces tokenSecret on stdout; default hides it.
//   J6: parseJoinUrl recognises ant://, /r/, /room/, and /mcp/room/ shapes.

import { describe, expect, it } from 'vitest';
import { handleInviteVerb, parseJoinUrl } from './ant-cli-invites.mjs';

class CliInputError extends Error {}

function makeRuntime(responseBuilder) {
  const captured = { posts: [], gets: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET').toUpperCase() === 'POST') captured.posts.push({ url, init });
    else captured.gets.push({ url, init });
    return responseBuilder(url, init);
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://local-operator.example',
      writeOut: (l) => captured.stdout.push(l),
      writeErr: (l) => captured.stderr.push(l)
    },
    captured
  };
}
const okJson = (payload) => ({
  ok: true,
  status: 200,
  json: async () => payload,
  text: async () => JSON.stringify(payload)
});
const errJson = (status, payload) => ({
  ok: false,
  status,
  json: async () => payload,
  text: async () => JSON.stringify(payload)
});

const SHARE_HOST = 'https://your-hostname.ts.net';
const SHARE_URL = `${SHARE_HOST}/mcp/room/i6eslnpy9?invite=inv_577384505d024be7`;

describe('ant invite join-url', () => {
  it('J1: posts exchange + redeem against the URL origin, not operator serverUrl', async () => {
    const { runtime, captured } = makeRuntime((url) => {
      if (url.endsWith('/exchange')) return okJson({ tokenSecret: 'tok_abc' });
      if (url.endsWith('/join-with-token')) {
        return okJson({
          member: { handle: '@markcd' },
          room: { id: 'i6eslnpy9', name: 'Norman K Funding' }
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const rc = await handleInviteVerb(
      'join-url',
      [SHARE_URL, '--password', 'hello', '--handle', '@markcd', '--no-register'],
      runtime,
      { CliInputError }
    );
    expect(rc).toBe(0);
    expect(captured.posts).toHaveLength(2);
    expect(captured.posts[0].url).toBe(
      `${SHARE_HOST}/api/chat-invites/inv_577384505d024be7/exchange`
    );
    expect(JSON.parse(captured.posts[0].init.body)).toEqual({
      password: 'hello',
      kind: 'cli',
      handle: '@markcd'
    });
    expect(captured.posts[1].url).toBe(
      `${SHARE_HOST}/api/chat-rooms/i6eslnpy9/join-with-token`
    );
    expect(JSON.parse(captured.posts[1].init.body)).toMatchObject({ tokenSecret: 'tok_abc' });
    expect(captured.stdout[0]).toBe(`@markcd\tNorman K Funding\ti6eslnpy9\t${SHARE_HOST}`);
  });

  it('J2: missing --password rejects before any network call', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleInviteVerb('join-url', [SHARE_URL, '--handle', '@markcd'], runtime, { CliInputError })
    ).rejects.toThrow(/missing required flag --password/);
    expect(captured.posts).toHaveLength(0);
  });

  it('J2b: missing --handle rejects before any network call', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleInviteVerb('join-url', [SHARE_URL, '--password', 'hello'], runtime, { CliInputError })
    ).rejects.toThrow(/missing required flag --handle/);
    expect(captured.posts).toHaveLength(0);
  });

  it('J3: malformed URL rejects before any network call', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleInviteVerb(
        'join-url',
        ['https://example.com/not-an-invite', '--password', 'hello', '--handle', '@h'],
        runtime,
        { CliInputError }
      )
    ).rejects.toThrow(/could not parse invite URL/);
    expect(captured.posts).toHaveLength(0);
  });

  it('J3b: missing URL rejects before any network call', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(
      handleInviteVerb('join-url', ['--password', 'hello', '--handle', '@h'], runtime, { CliInputError })
    ).rejects.toThrow(/join-url requires a URL/);
    expect(captured.posts).toHaveLength(0);
  });

  it('J4: exchange 4xx halts before redeem and does not echo password', async () => {
    const { runtime, captured } = makeRuntime((url) => {
      if (url.endsWith('/exchange')) {
        return errJson(401, { message: 'invite cannot be used (password=hello)' });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const rc = await handleInviteVerb(
      'join-url',
      [SHARE_URL, '--password', 'hello', '--handle', '@markcd'],
      runtime,
      { CliInputError }
    );
    expect(rc).toBe(1);
    expect(captured.posts).toHaveLength(1);
    const errLine = captured.stderr.join('\n');
    expect(errLine).toMatch(/Exchange failed/);
    expect(errLine).not.toMatch(/hello/);
    expect(errLine).toMatch(/\*\*\*REDACTED\*\*\*/);
  });

  it('J5: --print-token prints tokenSecret on a second stdout line', async () => {
    const { runtime, captured } = makeRuntime((url) => {
      if (url.endsWith('/exchange')) return okJson({ tokenSecret: 'tok_xyz' });
      if (url.endsWith('/join-with-token')) {
        return okJson({ member: { handle: '@h' }, room: { id: 'i6eslnpy9', name: 'r' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    const rc = await handleInviteVerb(
      'join-url',
      [SHARE_URL, '--password', 'hello', '--handle', '@h', '--print-token', '--no-register'],
      runtime,
      { CliInputError }
    );
    expect(rc).toBe(0);
    // stdout = [handle-line, token (because --print-token), auto-register-skipped]
    expect(captured.stdout).toHaveLength(3);
    expect(captured.stdout[1]).toBe('tok_xyz');
  });

  it('J5b: default omits tokenSecret from stdout entirely', async () => {
    const { runtime, captured } = makeRuntime((url) => {
      if (url.endsWith('/exchange')) return okJson({ tokenSecret: 'tok_xyz' });
      if (url.endsWith('/join-with-token')) {
        return okJson({ member: { handle: '@h' }, room: { id: 'i6eslnpy9', name: 'r' } });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
    await handleInviteVerb(
      'join-url',
      [SHARE_URL, '--password', 'hello', '--handle', '@h', '--no-register'],
      runtime,
      { CliInputError }
    );
    // stdout = [handle-line, auto-register-skipped] (no token because no --print-token)
    expect(captured.stdout).toHaveLength(2);
    expect(captured.stdout.join('\n')).not.toMatch(/tok_xyz/);
  });
});

describe('parseJoinUrl', () => {
  it('J6a: parses /mcp/room/<id>?invite=<inv>', () => {
    expect(parseJoinUrl(`${SHARE_HOST}/mcp/room/i6eslnpy9?invite=inv_1`)).toEqual({
      origin: SHARE_HOST,
      roomId: 'i6eslnpy9',
      inviteId: 'inv_1'
    });
  });

  it('J6b: parses /r/<id>?invite=<inv>', () => {
    expect(parseJoinUrl(`${SHARE_HOST}/r/fjv3tmd6ku?invite=inv_x`)).toEqual({
      origin: SHARE_HOST,
      roomId: 'fjv3tmd6ku',
      inviteId: 'inv_x'
    });
  });

  it('J6c: parses /room/<id>?invite=<inv>', () => {
    expect(parseJoinUrl(`${SHARE_HOST}/room/r1?invite=i1`)).toEqual({
      origin: SHARE_HOST,
      roomId: 'r1',
      inviteId: 'i1'
    });
  });

  it('J6d: ant:// scheme normalises to https origin', () => {
    expect(parseJoinUrl('ant://mac.example/room/r1?invite=i1')).toEqual({
      origin: 'https://mac.example',
      roomId: 'r1',
      inviteId: 'i1'
    });
  });

  it('J6e: returns null for non-room paths', () => {
    expect(parseJoinUrl(`${SHARE_HOST}/login?invite=x`)).toBeNull();
  });

  it('J6f: returns null when invite query is missing', () => {
    expect(parseJoinUrl(`${SHARE_HOST}/mcp/room/i6eslnpy9`)).toBeNull();
  });

  it('J6g: returns null for non-URL input', () => {
    expect(parseJoinUrl('not-a-url')).toBeNull();
    expect(parseJoinUrl('')).toBeNull();
  });
});
