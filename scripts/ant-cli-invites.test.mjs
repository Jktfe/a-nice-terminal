import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleInviteVerb } from './ant-cli-invites.mjs';

class CliInputError extends Error {}

const ADMIN_TOKEN = 'admin-token-very-secret';
const SECRET_PASSWORD = 'correct-horse-battery-staple';
const TOKEN_SECRET = 'a'.repeat(64);

function makeRuntime(responseBuilder) {
  const captured = { posts: [], gets: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    if ((init.method ?? 'GET').toUpperCase() === 'POST') {
      captured.posts.push({ url, init, body: init.body });
    } else {
      captured.gets.push({ url, init });
    }
    return responseBuilder(url, init);
  };
  const runtime = {
    fetchImpl,
    serverUrl: 'http://test.local',
    writeOut: (line) => captured.stdout.push(line),
    writeErr: (line) => captured.stderr.push(line)
  };
  return { runtime, captured };
}

function okJson(payload) {
  return { ok: true, status: 200, json: async () => payload, text: async () => JSON.stringify(payload) };
}

function failure(status, bodyText) {
  return { ok: false, status, json: async () => ({}), text: async () => bodyText };
}

beforeEach(() => {
  delete process.env.ANT_ADMIN_TOKEN;
  // F slice: redeem + join-url now auto-register the calling pane when
  // $TMUX_PANE is set. Scrub it from the test env so the existing
  // assertions (which expect ONLY the tab-separated success line on
  // stdout) keep passing — the auto-register path is exercised in
  // ant-cli-redeem-autoregister.test.mjs against the pure helper.
  delete process.env.TMUX_PANE;
});

afterEach(() => {
  delete process.env.ANT_ADMIN_TOKEN;
  delete process.env.TMUX_PANE;
});

function assertNoSecretsInOutput(captured, ...secretValues) {
  const haystack = `${captured.stdout.join('\n')}\n${captured.stderr.join('\n')}`;
  for (const secret of secretValues) {
    expect(haystack.includes(secret)).toBe(false);
  }
}

function assertNoSecretsInStdoutOrStderr(captured, ...secretValues) {
  assertNoSecretsInOutput(captured, ...secretValues);
}

describe('ant invite CLI verbs', () => {
  it('I1: create POSTs the right body shape, prints inviteId+roomId+label, never prints password', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ invite: { id: 'inv_abc', room_id: 'room-a', label: 'Team' } }));
    const code = await handleInviteVerb('create', [
      '--room', 'room-a', '--label', 'Team', '--password', SECRET_PASSWORD, '--kinds', 'cli,mcp', '--admin-token', ADMIN_TOKEN
    ], runtime, { CliInputError });
    expect(code).toBe(0);
    const sent = JSON.parse(captured.posts[0].body);
    expect(sent.roomId).toBe('room-a');
    expect(sent.kinds).toEqual(['cli', 'mcp']);
    expect(captured.stdout[0]).toContain('inv_abc');
    assertNoSecretsInOutput(captured, SECRET_PASSWORD);
  });

  it('I2: create without admin-token or env exits non-zero before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ invite: { id: 'should-not-happen' } }));
    let captured_err = null;
    try {
      await handleInviteVerb('create', ['--room', 'r', '--label', 'L', '--password', SECRET_PASSWORD, '--kinds', 'cli'], runtime, { CliInputError });
    } catch (failure) {
      captured_err = failure;
    }
    expect(captured_err).toBeInstanceOf(CliInputError);
    expect(captured_err.message).toContain('admin token required');
    expect(captured.posts).toHaveLength(0);
  });

  it('I3: create with --admin-token uses it as Authorization Bearer', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ invite: { id: 'inv_1', room_id: 'r', label: 'L' } }));
    await handleInviteVerb('create', ['--room', 'r', '--label', 'L', '--password', SECRET_PASSWORD, '--kinds', 'cli', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(captured.posts[0].init.headers.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    assertNoSecretsInOutput(captured, ADMIN_TOKEN, SECRET_PASSWORD);
  });

  it('I4: create with ANT_ADMIN_TOKEN env (no flag) uses env as Authorization Bearer', async () => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    const { runtime, captured } = makeRuntime(() => okJson({ invite: { id: 'inv_1', room_id: 'r', label: 'L' } }));
    await handleInviteVerb('create', ['--room', 'r', '--label', 'L', '--password', SECRET_PASSWORD, '--kinds', 'cli'], runtime, { CliInputError });
    expect(captured.posts[0].init.headers.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    assertNoSecretsInOutput(captured, ADMIN_TOKEN, SECRET_PASSWORD);
  });

  it('I5: list calls GET with bearer + prints invites', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ invites: [{ id: 'inv_x', label: 'Team', kinds: ['cli'] }] }));
    await handleInviteVerb('list', ['--room', 'room-a', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(captured.gets[0].init.headers.authorization).toBe(`Bearer ${ADMIN_TOKEN}`);
    expect(captured.stdout[0]).toContain('inv_x');
    expect(captured.stdout[0]).toContain('Team');
    assertNoSecretsInOutput(captured, ADMIN_TOKEN);
  });

  it('I6: exchange prints tokenSecret on success, exits 0', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tokenId: 'tok_1', tokenSecret: TOKEN_SECRET }));
    const code = await handleInviteVerb('exchange', ['--invite-id', 'inv_x', '--password', SECRET_PASSWORD, '--kind', 'cli'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout[0]).toBe(TOKEN_SECRET);
  });

  it('I7: exchange never echoes the password to stdout/stderr', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tokenId: 'tok_1', tokenSecret: TOKEN_SECRET }));
    await handleInviteVerb('exchange', ['--invite-id', 'inv_x', '--password', SECRET_PASSWORD, '--kind', 'cli'], runtime, { CliInputError });
    assertNoSecretsInOutput(captured, SECRET_PASSWORD);
  });

  it('I8: exchange exits 1 on 401 + surfaces server error string', async () => {
    const { runtime, captured } = makeRuntime(() => failure(401, '{"message":"invite cannot be used"}'));
    const code = await handleInviteVerb('exchange', ['--invite-id', 'inv_x', '--password', SECRET_PASSWORD, '--kind', 'cli'], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('Exchange failed (401)');
    assertNoSecretsInOutput(captured, SECRET_PASSWORD);
  });

  it('I9: missing required flag surfaces as CliInputError', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    let captured_err = null;
    try {
      await handleInviteVerb('create', ['--room', 'r', '--label', 'L', '--password', SECRET_PASSWORD, '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    } catch (failure) {
      captured_err = failure;
    }
    expect(captured_err).toBeInstanceOf(CliInputError);
    expect(captured_err.message).toContain('--kinds');
  });

  it('I10: bad --kind enum is rejected before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    let captured_err = null;
    try {
      await handleInviteVerb('exchange', ['--invite-id', 'inv_x', '--password', SECRET_PASSWORD, '--kind', 'notakind'], runtime, { CliInputError });
    } catch (failure) {
      captured_err = failure;
    }
    expect(captured_err).toBeInstanceOf(CliInputError);
    expect(captured.posts).toHaveLength(0);
  });

  it('I11: server 500 surfaces as exit 1', async () => {
    const { runtime, captured } = makeRuntime(() => failure(500, 'boom'));
    const code = await handleInviteVerb('create', ['--room', 'r', '--label', 'L', '--password', SECRET_PASSWORD, '--kinds', 'cli', '--admin-token', ADMIN_TOKEN], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('Create failed (500)');
    assertNoSecretsInOutput(captured, ADMIN_TOKEN, SECRET_PASSWORD);
  });

  it('B1-regression create: hostile server echoes adminToken+password in 500 body — CLI redacts BOTH from stderr', async () => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    const hostileBody = `adminToken ${ADMIN_TOKEN} password ${SECRET_PASSWORD} all leaked`;
    const { runtime, captured } = makeRuntime(() => failure(500, hostileBody));
    await handleInviteVerb('create', ['--room', 'r', '--label', 'L', '--password', SECRET_PASSWORD, '--kinds', 'cli'], runtime, { CliInputError });
    assertNoSecretsInStdoutOrStderr(captured, ADMIN_TOKEN, SECRET_PASSWORD);
  });

  it('B1-regression list: hostile server echoes adminToken in 500 body — CLI redacts from stderr', async () => {
    process.env.ANT_ADMIN_TOKEN = ADMIN_TOKEN;
    const hostileBody = `admin leak: ${ADMIN_TOKEN}`;
    const { runtime, captured } = makeRuntime(() => failure(500, hostileBody));
    await handleInviteVerb('list', ['--room', 'r'], runtime, { CliInputError });
    assertNoSecretsInStdoutOrStderr(captured, ADMIN_TOKEN);
  });

  it('B1-regression exchange: hostile server echoes password in 500 body — CLI redacts from stderr', async () => {
    const hostileBody = `password leak: ${SECRET_PASSWORD}`;
    const { runtime, captured } = makeRuntime(() => failure(500, hostileBody));
    await handleInviteVerb('exchange', ['--invite-id', 'inv_x', '--password', SECRET_PASSWORD, '--kind', 'cli'], runtime, { CliInputError });
    assertNoSecretsInStdoutOrStderr(captured, SECRET_PASSWORD);
  });

  it('R1: redeem success prints handle\\troom.name\\troom.id, returns 0, NEVER prints tokenSecret', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      room: { id: 'room-a', name: 'Test room', members: [{ handle: '@guest' }] },
      member: { handle: '@guest' },
      identity: { tokenId: 'tok_1', kind: 'cli' }
    }));
    const code = await handleInviteVerb('redeem', ['--room', 'room-a', '--token', TOKEN_SECRET], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout[0]).toBe('@guest\tTest room\troom-a');
    assertNoSecretsInStdoutOrStderr(captured, TOKEN_SECRET);
  });

  it('R2: redeem 401 (bogus token) exits 1, NO tokenSecret in stderr', async () => {
    const { runtime, captured } = makeRuntime(() => failure(401, '{"message":"invite cannot be used"}'));
    const code = await handleInviteVerb('redeem', ['--room', 'room-a', '--token', TOKEN_SECRET], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('Redeem failed (401)');
    assertNoSecretsInStdoutOrStderr(captured, TOKEN_SECRET);
  });

  it('R3: redeem 401 on right token + nonexistent room exits 1, NO tokenSecret in stderr', async () => {
    const { runtime, captured } = makeRuntime(() => failure(401, '{"message":"invite cannot be used"}'));
    const code = await handleInviteVerb('redeem', ['--room', 'room-does-not-exist', '--token', TOKEN_SECRET], runtime, { CliInputError });
    expect(code).toBe(1);
    expect(captured.stderr.join('\n')).toContain('401');
    assertNoSecretsInStdoutOrStderr(captured, TOKEN_SECRET);
  });

  it('R4: redeem missing --room → CliInputError before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    let captured_err = null;
    try { await handleInviteVerb('redeem', ['--token', TOKEN_SECRET], runtime, { CliInputError }); } catch (failure) { captured_err = failure; }
    expect(captured_err).toBeInstanceOf(CliInputError);
    expect(captured.posts).toHaveLength(0);
  });

  it('R5: redeem missing --token → CliInputError before fetch', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    let captured_err = null;
    try { await handleInviteVerb('redeem', ['--room', 'room-a'], runtime, { CliInputError }); } catch (failure) { captured_err = failure; }
    expect(captured_err).toBeInstanceOf(CliInputError);
    expect(captured.posts).toHaveLength(0);
  });

  it('R6: redeem hostile-server 500 echoes tokenSecret in body — CLI redacts from stderr', async () => {
    const hostileBody = `attempt to leak: ${TOKEN_SECRET}`;
    const { runtime, captured } = makeRuntime(() => failure(500, hostileBody));
    await handleInviteVerb('redeem', ['--room', 'room-a', '--token', TOKEN_SECRET], runtime, { CliInputError });
    assertNoSecretsInStdoutOrStderr(captured, TOKEN_SECRET);
  });

  it('R7 extra: redeem URL composes correctly with slash-containing roomId via encodeURIComponent', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({
      room: { id: 'room/with/slash', name: 'X', members: [] },
      member: { handle: '@x' },
      identity: { tokenId: 'tok_1', kind: 'cli' }
    }));
    await handleInviteVerb('redeem', ['--room', 'room/with/slash', '--token', TOKEN_SECRET], runtime, { CliInputError });
    expect(captured.posts[0].url).toContain('room%2Fwith%2Fslash/join-with-token');
  });

  it('F1 integration: redeem with $TMUX_PANE set fires register + add-membership + prints bound line', async () => {
    process.env.TMUX_PANE = '%5';
    // Three POSTs expected in order: join-with-token, identity/register, sessions/add.
    let postCount = 0;
    const { runtime, captured } = makeRuntime((url) => {
      postCount += 1;
      if (postCount === 1) {
        return okJson({
          room: { id: '0mcytty7ng', name: 'Test room', members: [{ handle: '@jsCC' }] },
          member: { handle: '@jsCC' },
          identity: { tokenId: 'tok_1', kind: 'cli' }
        });
      }
      if (postCount === 2) return okJson({ terminal_id: 'term_abc', name: 'redeem-jsCC-tty7ng' });
      return okJson({ terminal_id: 'term_abc', room_id: '0mcytty7ng', handle: '@jsCC' });
    });
    const code = await handleInviteVerb('redeem', ['--room', '0mcytty7ng', '--token', TOKEN_SECRET], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.posts).toHaveLength(3);
    expect(captured.posts[1].url).toContain('/api/identity/register');
    expect(captured.posts[2].url).toContain('/api/sessions/add');
    // Tab-separated machine line still first (back-compat with script consumers).
    expect(captured.stdout[0]).toBe('@jsCC\tTest room\t0mcytty7ng');
    // Human-readable bind line second.
    expect(captured.stdout[1]).toContain('Bound terminal redeem-jsCC-tty7ng');
    expect(captured.stdout[1]).toContain('@jsCC');
    assertNoSecretsInStdoutOrStderr(captured, TOKEN_SECRET);
  });

  it('F2 integration: --no-register skips auto-register, prints hint, still exits 0', async () => {
    process.env.TMUX_PANE = '%5';
    const { runtime, captured } = makeRuntime(() => okJson({
      room: { id: 'room-a', name: 'X', members: [{ handle: '@x' }] },
      member: { handle: '@x' },
      identity: { tokenId: 'tok_1', kind: 'cli' }
    }));
    const code = await handleInviteVerb('redeem',
      ['--room', 'room-a', '--token', TOKEN_SECRET, '--no-register'],
      runtime, { CliInputError });
    expect(code).toBe(0);
    // Only the join-with-token call fires — no register, no add-membership.
    expect(captured.posts).toHaveLength(1);
    expect(captured.stdout[1]).toContain('--no-register');
    expect(captured.stdout[1]).toContain('ant register');
  });

  // R8/R9 revoke tests moved to scripts/ant-cli-invites-revoke.test.mjs to
  // keep this file under the 240L soft cap (M3.7b).
});
