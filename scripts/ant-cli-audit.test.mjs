import { describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { handleAuditVerb } from './ant-cli-audit.mjs';

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

describe('ant audit wrappers (M3.1a)', () => {
  it('A1: permissions GETs the room audit route and renders one line per member', async () => {
    const payload = {
      roomId: 'room-a',
      members: [
        { handle: '@first', terminal_id: 'term-abcdefgh-1', terminal_name: 'first-term', agent_kind: null, joined_at: Math.floor(Date.now() / 1000) - 30 },
        { handle: '@second', terminal_id: 'term-ijklmnop-2', terminal_name: 'second-term', agent_kind: 'claude_code', joined_at: Math.floor(Date.now() / 1000) - 600 }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleAuditVerb('permissions', ['--room', 'room-a'], runtime, { CliInputError });
    expect(code).toBe(0);
    // URL now carries pidChain query for the hooks.server.ts gate; assert
    // pathname + pidChain presence separately so the test isn't fragile.
    const u0 = new URL(captured.requests[0].url);
    expect(`${u0.origin}${u0.pathname}`).toBe('http://test.local/api/chat-rooms/room-a/audit');
    expect(u0.searchParams.get('pidChain')).toBeTruthy();
    expect(captured.stdout[0]).toContain('@first');
    expect(captured.stdout[0]).toContain('first-term');
    expect(captured.stdout[1]).toContain('@second');
    expect(captured.stdout[1]).toContain('second-term');
  });

  it('A2: permissions --json passes the server payload through unchanged', async () => {
    const payload = { roomId: 'room-b', members: [{ handle: '@only', terminal_id: 't1', terminal_name: 'one', agent_kind: null, joined_at: 1 }] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleAuditVerb('permissions', ['--room', 'room-b', '--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });

  it('A3: permissions with empty room prints a friendly empty message', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ roomId: 'room-empty', members: [] }));
    await handleAuditVerb('permissions', ['--room', 'room-empty'], runtime, { CliInputError });
    expect(captured.stdout[0]).toContain('no members');
    expect(captured.stdout[0]).toContain('room-empty');
  });

  it('A4: permissions requires --room and fails before fetch when missing', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleAuditVerb('permissions', [], runtime, { CliInputError })).rejects.toThrow('missing required flag --room');
    expect(captured.requests).toHaveLength(0);
  });

  it('A5: permissions surfaces server 404 as a thrown error with the status code', async () => {
    const notFound = { ok: false, status: 404, json: async () => ({}), text: async () => 'Room not found.' };
    const { runtime } = makeRuntime(() => notFound);
    await expect(handleAuditVerb('permissions', ['--room', 'unknown'], runtime, { CliInputError })).rejects.toThrow(/404/);
  });

  it('A6: unknown subverb throws CliInputError; help / no-action prints usage; main runner dispatch wires audit verb', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({}));
    await expect(handleAuditVerb('lol', [], runtime, { CliInputError })).rejects.toThrow('unknown audit verb: lol');
    const helpCode = await handleAuditVerb('help', [], runtime, { CliInputError });
    expect(helpCode).toBe(0);
    expect(captured.stdout.join('\n')).toContain('ant audit permissions');
    expect(captured.stdout.join('\n')).toContain('ant audit tools');
    expect(captured.stdout.join('\n')).toContain('ant audit orphans');

    const calls = [];
    const runner = makeCliRunner({
      serverUrl: 'http://test.local',
      fetchImpl: async (url, init = {}) => { calls.push({ url, init }); return okJson({ roomId: 'r', members: [] }); },
      writeOut: () => {},
      writeErr: () => {}
    });
    const dispatchCode = await runner.run(['audit', 'permissions', '--room', 'r']);
    expect(dispatchCode).toBe(0);
    const u = new URL(calls[0].url);
    expect(`${u.origin}${u.pathname}`).toBe('http://test.local/api/chat-rooms/r/audit');
    expect(u.searchParams.get('pidChain')).toBeTruthy();
  });
});

describe('ant audit tools (PR-D)', () => {
  it('GETs /api/tools/audit?audit=tools and renders one row per tool', async () => {
    const payload = {
      tools: [
        {
          toolSlug: 'graphify',
          kind: 'skill',
          version: '0.3.1',
          ownerOrg: 'nmvc',
          minTier: 'oss',
          grantCount: 3,
          deprecatedAtMs: null,
          retiredAtMs: null
        },
        {
          toolSlug: 'nifty',
          kind: 'skill',
          version: null,
          ownerOrg: null,
          minTier: 'oss',
          grantCount: 0,
          deprecatedAtMs: null,
          retiredAtMs: 1
        }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleAuditVerb('tools', ['--include-retired'], runtime, { CliInputError });
    expect(code).toBe(0);
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('audit')).toBe('tools');
    expect(u.searchParams.get('includeRetired')).toBe('1');
    expect(captured.stdout.find((l) => l.includes('graphify'))).toContain('active');
    expect(captured.stdout.find((l) => l.includes('nifty'))).toContain('retired');
  });

  it('forwards --org as owner_org', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tools: [] }));
    await handleAuditVerb('tools', ['--org', 'orgA'], runtime, { CliInputError });
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('owner_org')).toBe('orgA');
  });

  it('prints "(no tools)" when empty', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ tools: [] }));
    await handleAuditVerb('tools', [], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toContain('no tools');
  });
});

describe('ant audit grants (PR-D)', () => {
  it('GETs with --agent --tool --scope filters', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grants: [] }));
    await handleAuditVerb(
      'grants',
      ['--agent', '@speedyc', '--tool', 'graphify', '--scope', 'room'],
      runtime,
      { CliInputError }
    );
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('agent')).toBe('@speedyc');
    expect(u.searchParams.get('tool')).toBe('graphify');
    expect(u.searchParams.get('scope_kind')).toBe('room');
  });

  it('renders one row per grant', async () => {
    const payload = {
      grants: [
        {
          grantId: 'tg_1',
          granteeHandle: '@speedyc',
          toolSlug: 'graphify',
          scopeKind: 'global',
          scopeId: null,
          grantedByHandle: '@jwpk',
          grantedAtMs: 1_700_000_000_000,
          expiresAtMs: null,
          reason: null
        }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleAuditVerb('grants', [], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toContain('@speedyc');
    expect(captured.stdout.join('\n')).toContain('graphify');
    expect(captured.stdout.join('\n')).toContain('tg_1');
  });

  it('prints "(no grants)" when empty', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ grants: [] }));
    await handleAuditVerb('grants', [], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toContain('no grants');
  });
});

describe('ant audit revocations (PR-D)', () => {
  it('parses --since 7d into since_ms', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ revocations: [] }));
    await handleAuditVerb('revocations', ['--since', '7d'], runtime, { CliInputError });
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('since_ms')).toBe(String(7 * 86_400_000));
  });

  it('parses --since 24h', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ revocations: [] }));
    await handleAuditVerb('revocations', ['--since', '24h'], runtime, { CliInputError });
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('since_ms')).toBe(String(24 * 3_600_000));
  });

  it('rejects malformed --since', async () => {
    const { runtime } = makeRuntime(() => okJson({}));
    await expect(
      handleAuditVerb('revocations', ['--since', 'forever'], runtime, { CliInputError })
    ).rejects.toThrow(/--since/);
  });

  it('defaults to last 7 days when --since omitted', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ revocations: [] }));
    await handleAuditVerb('revocations', [], runtime, { CliInputError });
    const u = new URL(captured.requests[0].url);
    expect(u.searchParams.get('since_ms')).toBe(String(7 * 86_400_000));
  });

  it('renders revocation rows', async () => {
    const payload = {
      revocations: [
        {
          grantId: 'tg_x',
          granteeHandle: '@x',
          toolSlug: 'nifty',
          scopeKind: 'global',
          scopeId: null,
          grantedAtMs: 1_700_000_000_000,
          revokedAtMs: 1_700_500_000_000
        }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleAuditVerb('revocations', ['--since', '30d'], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toContain('nifty');
    expect(captured.stdout.join('\n')).toContain('tg_x');
  });

  it('prints "(no revocations in last 7d)" when empty', async () => {
    const { runtime, captured } = makeRuntime(() => okJson({ revocations: [] }));
    await handleAuditVerb('revocations', [], runtime, { CliInputError });
    expect(captured.stdout.join('\n')).toContain('no revocations');
  });
});

describe('ant audit orphans (PR-D)', () => {
  it('renders two sections: orphan grants + orphan tools', async () => {
    const payload = {
      orphanGrants: [
        {
          grantId: 'tg_o',
          granteeHandle: '@x',
          toolSlug: 'nifty',
          grantedByHandle: '@admin'
        }
      ],
      orphanTools: [
        {
          toolSlug: 'unused',
          kind: 'skill',
          version: null,
          ownerOrg: null,
          addedAtMs: 1_700_000_000_000
        }
      ]
    };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    const code = await handleAuditVerb('orphans', [], runtime, { CliInputError });
    expect(code).toBe(0);
    const all = captured.stdout.join('\n');
    expect(all).toContain('Orphan grants');
    expect(all).toContain('@x');
    expect(all).toContain('nifty');
    expect(all).toContain('Orphan tools');
    expect(all).toContain('unused');
  });

  it('renders "(none)" for an empty section', async () => {
    const { runtime, captured } = makeRuntime(() =>
      okJson({ orphanGrants: [], orphanTools: [] })
    );
    await handleAuditVerb('orphans', [], runtime, { CliInputError });
    const all = captured.stdout.join('\n');
    // Two (none) lines, one per section.
    expect(all.match(/\(none\)/g)?.length).toBe(2);
  });

  it('--json passes payload through unchanged', async () => {
    const payload = { orphanGrants: [], orphanTools: [{ toolSlug: 'x' }] };
    const { runtime, captured } = makeRuntime(() => okJson(payload));
    await handleAuditVerb('orphans', ['--json'], runtime, { CliInputError });
    expect(JSON.parse(captured.stdout[0])).toEqual(payload);
  });
});
