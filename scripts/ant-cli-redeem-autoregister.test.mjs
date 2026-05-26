import { describe, expect, it } from 'vitest';
import {
  attemptAutoRegister,
  deriveTerminalName,
  formatAutoRegisterOutcome,
  resolveTmuxPane
} from './ant-cli-redeem-autoregister.mjs';

function okJson(payload) {
  return {
    ok: true,
    status: 200,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function failure(status, bodyText) {
  return { ok: false, status, json: async () => ({}), text: async () => bodyText };
}

function makeRuntime(responseQueue) {
  // responseQueue is an array of responses; consumed FIFO. Indexed POSTs
  // are recorded for assertions on which endpoint was called with what.
  const captured = { posts: [] };
  const fetchImpl = async (url, init) => {
    captured.posts.push({ url, body: init?.body });
    if (responseQueue.length === 0) {
      throw new Error(`fetchImpl: ran out of queued responses for ${url}`);
    }
    return responseQueue.shift();
  };
  const runtime = {
    fetchImpl,
    serverUrl: 'http://test.local',
    cwd: '/tmp/test-cwd',
    writeOut: () => {},
    writeErr: () => {}
  };
  return { runtime, captured };
}

function makePidChainImpl() {
  // Stable two-entry chain so deriveTerminalName + registerBody assertions
  // are deterministic in tests.
  return () => [
    { pid: 12345, pid_start: '2026-05-26T14:00:00Z' },
    { pid: 12344, pid_start: '2026-05-26T13:00:00Z' }
  ];
}

describe('deriveTerminalName', () => {
  it('strips leading @ from handle and uses 6-char room suffix', () => {
    expect(deriveTerminalName('@jsCC', '0mcytty7ng')).toBe('redeem-jsCC-tty7ng');
  });
  it('handles handles without @ defensively', () => {
    expect(deriveTerminalName('jsCC', '0mcytty7ng')).toBe('redeem-jsCC-tty7ng');
  });
  it('handles short room ids gracefully (slice past start is empty-safe)', () => {
    expect(deriveTerminalName('@x', 'abc')).toBe('redeem-x-abc');
  });
});

describe('resolveTmuxPane', () => {
  it('A1: returns null when both flag and env are unset', () => {
    expect(resolveTmuxPane(undefined, undefined)).toBe(null);
    expect(resolveTmuxPane('', '')).toBe(null);
  });
  it('A2: prefers explicit --pane over $TMUX_PANE', () => {
    expect(resolveTmuxPane('%5', '%99')).toBe('%5');
  });
  it('A3: falls back to $TMUX_PANE when --pane absent', () => {
    expect(resolveTmuxPane(undefined, '%5')).toBe('%5');
  });
});

describe('attemptAutoRegister', () => {
  const baseInputs = {
    handle: '@jsCC',
    roomId: '0mcytty7ng',
    baseUrl: 'http://test.local',
    processIdentityChainImpl: makePidChainImpl()
  };

  it('R1: returns skipped when --no-register flag is set', async () => {
    const { runtime } = makeRuntime([]);
    const result = await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: { 'no-register': 'true' },
      envTmuxPane: '%5'
    });
    expect(result.status).toBe('skipped');
    expect(result.reason).toBe('no-register flag');
  });

  it('R2: returns skipped when no pane available (no flag + no env)', async () => {
    const { runtime, captured } = makeRuntime([]);
    const result = await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: {},
      envTmuxPane: undefined
    });
    expect(result.status).toBe('skipped');
    expect(result.reason).toContain('no pane');
    // Critical: no HTTP calls fired when we know we will skip.
    expect(captured.posts).toHaveLength(0);
  });

  it('R3: returns registered + posts to both endpoints when pane available', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 'term_abc', name: 'redeem-jsCC-tty7ng' }),
      okJson({ terminal_id: 'term_abc', room_id: '0mcytty7ng', handle: '@jsCC' })
    ]);
    const result = await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: {},
      envTmuxPane: '%5'
    });
    expect(result.status).toBe('registered');
    expect(result.terminalId).toBe('term_abc');
    expect(result.terminalName).toBe('redeem-jsCC-tty7ng');
    // Step 1 — register
    expect(captured.posts[0].url).toBe('http://test.local/api/identity/register');
    const registerBody = JSON.parse(captured.posts[0].body);
    expect(registerBody.name).toBe('redeem-jsCC-tty7ng');
    expect(registerBody.pane).toBe('%5');
    expect(registerBody.source).toBe('cli-redeem-autoregister');
    expect(registerBody.meta.handle).toBe('@jsCC');
    expect(registerBody.pids[0].pid).toBe(12345);
    // Step 2 — add membership
    expect(captured.posts[1].url).toBe('http://test.local/api/sessions/add');
    const addMembershipBody = JSON.parse(captured.posts[1].body);
    expect(addMembershipBody.room_id).toBe('0mcytty7ng');
    expect(addMembershipBody.handle).toBe('@jsCC');
    expect(addMembershipBody.terminal_name).toBe('redeem-jsCC-tty7ng');
  });

  it('R4: returns failed when /api/identity/register errors, never calls add-membership', async () => {
    const { runtime, captured } = makeRuntime([
      failure(500, 'register internal error')
    ]);
    const result = await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: {},
      envTmuxPane: '%5'
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('register 500');
    // Critical: a register failure must NOT cascade to add-membership.
    expect(captured.posts).toHaveLength(1);
  });

  it('R5: returns failed (with terminalId) when add-membership errors after a clean register', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 'term_abc' }),
      failure(409, 'membership already exists for another terminal')
    ]);
    const result = await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: {},
      envTmuxPane: '%5'
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('add-membership 409');
    // Terminal was created — surface its id so the user can recover.
    expect(result.terminalId).toBe('term_abc');
    expect(captured.posts).toHaveLength(2);
  });

  it('R6: --pane flag wins over $TMUX_PANE', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 'term_abc' }),
      okJson({})
    ]);
    await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: { pane: '%explicit' },
      envTmuxPane: '%fromenv'
    });
    expect(JSON.parse(captured.posts[0].body).pane).toBe('%explicit');
  });

  it('R7: --name + --agent-kind overrides reach the register endpoint', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ terminal_id: 'term_abc' }),
      okJson({})
    ]);
    await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: { name: 'custom-pane', 'agent-kind': 'claude_code' },
      envTmuxPane: '%5'
    });
    const registerBody = JSON.parse(captured.posts[0].body);
    expect(registerBody.name).toBe('custom-pane');
    expect(registerBody.agent_kind).toBe('claude_code');
  });

  it('R8: empty PID chain → failed (no HTTP calls)', async () => {
    const { runtime, captured } = makeRuntime([]);
    const result = await attemptAutoRegister({
      ...baseInputs,
      runtime,
      flags: {},
      envTmuxPane: '%5',
      processIdentityChainImpl: () => []
    });
    expect(result.status).toBe('failed');
    expect(result.reason).toContain('PID chain unavailable');
    expect(captured.posts).toHaveLength(0);
  });
});

describe('formatAutoRegisterOutcome', () => {
  it('F1: registered → human-readable bound line with terminal id', () => {
    const line = formatAutoRegisterOutcome(
      { status: 'registered', terminalId: 'term_abc', terminalName: 'redeem-jsCC-tty7ng' },
      '@jsCC',
      '0mcytty7ng'
    );
    expect(line).toContain('Bound terminal redeem-jsCC-tty7ng');
    expect(line).toContain('term_abc');
    expect(line).toContain('@jsCC');
    expect(line).toContain('PTY-inject');
  });
  it('F2: skipped (no-register) → hint with the manual register command', () => {
    const line = formatAutoRegisterOutcome(
      { status: 'skipped', reason: 'no-register flag' },
      '@jsCC',
      '0mcytty7ng'
    );
    expect(line).toContain('--no-register');
    expect(line).toContain('ant register');
    expect(line).toContain('@jsCC');
  });
  it('F3: skipped (no pane) → hint with the manual register command + tmux note', () => {
    const line = formatAutoRegisterOutcome(
      { status: 'skipped', reason: 'no pane (no --pane flag and $TMUX_PANE unset)' },
      '@jsCC',
      '0mcytty7ng'
    );
    expect(line).toContain('tmux pane');
    expect(line).toContain('$TMUX_PANE');
    expect(line).toContain('@jsCC');
  });
  it('F4: failed → surfaces reason + manual recovery command', () => {
    const line = formatAutoRegisterOutcome(
      { status: 'failed', reason: 'register 500: server down', terminalId: 'term_abc' },
      '@jsCC',
      '0mcytty7ng'
    );
    expect(line).toContain('register 500');
    expect(line).toContain('term_abc');
    expect(line).toContain('Redeem succeeded');
    expect(line).toContain('ant register');
  });
});
