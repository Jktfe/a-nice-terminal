import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleSessionsVerb } from './ant-cli-sessions.mjs';

class CliInputError extends Error {}

function makeRuntime(routeBuilder) {
  const captured = { requests: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init = {}) => {
    captured.requests.push({ url, init });
    return routeBuilder(url, init, captured.requests.length);
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

const ok = (body, status = 200) => ({
  ok: true,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body)
});

describe('ant sessions create', () => {
  it('POSTs /api/terminals with the name (positional)', async () => {
    const { runtime, captured } = makeRuntime(() =>
      ok({ sessionId: 't_abc', name: 'Sess1', agentKind: 'claude', linkedChatRoomId: 'r1', tmuxTargetPane: 't_abc:0.0', derivedHandle: '@sess1' })
    );
    const code = await handleSessionsVerb('create', ['Sess1'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/terminals');
    expect(captured.requests[0].init.method).toBe('POST');
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.name).toBe('Sess1');
    expect(body.agentKind).toBeUndefined();
    expect(captured.stdout.join(' ')).toMatch(/Spawned session t_abc/);
  });

  it('passes --agent-kind through to the POST body', async () => {
    const { runtime, captured } = makeRuntime(() =>
      ok({ sessionId: 't_ck', name: 'WithKind', agentKind: 'codex', linkedChatRoomId: 'r2', tmuxTargetPane: 't_ck:0.0', derivedHandle: '@withkind' })
    );
    await handleSessionsVerb('create', ['WithKind', '--agent-kind', 'codex'], runtime, { CliInputError });
    const body = JSON.parse(captured.requests[0].init.body);
    expect(body.name).toBe('WithKind');
    expect(body.agentKind).toBe('codex');
  });

  it('rejects an unknown agent-kind', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(
      handleSessionsVerb('create', ['X', '--agent-kind', 'banana'], runtime, { CliInputError })
    ).rejects.toThrow(/agent-kind must be one of/);
  });

  it('requires a name', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(handleSessionsVerb('create', [], runtime, { CliInputError })).rejects.toThrow(/--name is required/);
  });
});

describe('ant sessions export', () => {
  function exportFixture() {
    return makeRuntime((url) => {
      if (url === 'http://test.local/api/sessions/room_42/export?format=markdown') {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => '# lane-A\n\n**@a**: hello\n**@b**: world\n'
        };
      }
      if (url === 'http://test.local/api/sessions/room_42/export?format=json') {
        return {
          ok: true,
          status: 200,
          json: async () => ({}),
          text: async () => JSON.stringify({
            room: { id: 'room_42', name: 'lane-A' },
            messageCount: 2,
          messages: [
            { id: 'msg_1', body: 'hello', authorHandle: '@a', kind: 'text', createdAt: '2026-05-16T10:00:00.000Z' },
            { id: 'msg_2', body: 'world', authorHandle: '@b', kind: 'text', createdAt: '2026-05-16T10:00:05.000Z' }
          ]
          }, null, 2) + '\n'
        };
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('streams markdown export from the server route to stdout', async () => {
    const { runtime, captured } = exportFixture();
    const code = await handleSessionsVerb('export', ['room_42'], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.requests[0].url).toBe('http://test.local/api/sessions/room_42/export?format=markdown');
    expect(captured.stdout.join('\n')).toContain('# lane-A');
    expect(captured.stdout.join('\n')).toContain('**@a**: hello');
  });

  it('uses --format json when requested', async () => {
    const { runtime, captured } = exportFixture();
    await handleSessionsVerb('export', ['room_42', '--format', 'json'], runtime, { CliInputError });
    expect(captured.requests[0].url).toBe('http://test.local/api/sessions/room_42/export?format=json');
    const payload = JSON.parse(captured.stdout.join('\n'));
    expect(payload.room.id).toBe('room_42');
    expect(payload.messages).toHaveLength(2);
  });

  it('writes server export to --out FILE when given', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'ant-sessions-export-'));
    const out = join(dir, 'room.md');
    try {
      const { runtime, captured } = exportFixture();
      await handleSessionsVerb('export', ['room_42', '--out', out], runtime, { CliInputError });
      const joined = captured.stdout.join('\n');
      expect(joined).toMatch(/Exported session room_42/);
      expect(joined).not.toMatch(/^# lane-A/m);
      const fileText = await readFile(out, 'utf8');
      expect(fileText).toContain('# lane-A');
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  it('requires a room identifier', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(handleSessionsVerb('export', [], runtime, { CliInputError })).rejects.toThrow(/session or room id is required/);
  });

  it('rejects unknown formats before calling the server', async () => {
    const { runtime, captured } = exportFixture();
    await expect(handleSessionsVerb('export', ['room_42', '--format', 'xml'], runtime, { CliInputError })).rejects.toThrow(/--format/);
    expect(captured.requests).toHaveLength(0);
  });
});

describe('ant sessions recover', () => {
  function recoverFixture(terminals) {
    return makeRuntime((url, init) => {
      if (url === 'http://test.local/api/terminals' && (!init || init.method === 'GET')) {
        return ok({ terminals });
      }
      if (url === 'http://test.local/api/terminals/recover') {
        const body = JSON.parse(init.body);
        const recovered = body.sessionIds.map((sid) => {
          const t = terminals.find((x) => x.sessionId === sid);
          return { sessionId: sid, name: t?.name ?? sid, command: 'claude --remote-control', action: body.dryRun ? 'planned' : 'spawned', agentLaunched: !body.dryRun };
        });
        return ok({ recovered });
      }
      throw new Error(`unexpected fetch: ${url}`);
    });
  }

  it('resolves a name to its sessionId and POSTs to /recover', async () => {
    const { runtime, captured } = recoverFixture([
      { sessionId: 't_dead', name: 'speedyClaude', alive: false, derivedHandle: '@speedyclaude' }
    ]);
    const code = await handleSessionsVerb('recover', ['speedyClaude'], runtime, { CliInputError });
    expect(code).toBe(0);
    const post = captured.requests.find((r) => r.url.endsWith('/recover'));
    const body = JSON.parse(post.init.body);
    expect(body.sessionIds).toEqual(['t_dead']);
    expect(body.launchAgents).toBe(true);
    expect(captured.stdout.join('\n')).toMatch(/speedyClaude/);
  });

  it('--all recovers only not-alive sessions', async () => {
    const { runtime, captured } = recoverFixture([
      { sessionId: 't_live', name: 'A', alive: true, derivedHandle: '@a' },
      { sessionId: 't_dead1', name: 'B', alive: false, derivedHandle: '@b' },
      { sessionId: 't_dead2', name: 'C', alive: false, derivedHandle: '@c' }
    ]);
    await handleSessionsVerb('recover', ['--all'], runtime, { CliInputError });
    const post = captured.requests.find((r) => r.url.endsWith('/recover'));
    expect(JSON.parse(post.init.body).sessionIds).toEqual(['t_dead1', 't_dead2']);
  });

  it('--resume and --dry-run flow through to the body', async () => {
    const { runtime, captured } = recoverFixture([
      { sessionId: 't_dead', name: 'speedyClaude', alive: false, derivedHandle: '@speedyclaude' }
    ]);
    await handleSessionsVerb('recover', ['speedyClaude', '--resume', '--dry-run'], runtime, { CliInputError });
    const post = captured.requests.find((r) => r.url.endsWith('/recover'));
    const body = JSON.parse(post.init.body);
    expect(body.resume).toBe(true);
    expect(body.dryRun).toBe(true);
    expect(captured.stdout.join('\n')).toMatch(/Recovery plan/);
  });

  it('--no-agents recreates panes only', async () => {
    const { runtime, captured } = recoverFixture([
      { sessionId: 't_dead', name: 'X', alive: false, derivedHandle: '@x' }
    ]);
    await handleSessionsVerb('recover', ['X', '--no-agents'], runtime, { CliInputError });
    const post = captured.requests.find((r) => r.url.endsWith('/recover'));
    expect(JSON.parse(post.init.body).launchAgents).toBe(false);
  });

  it('throws on an unknown name', async () => {
    const { runtime } = recoverFixture([
      { sessionId: 't_dead', name: 'known', alive: false, derivedHandle: '@known' }
    ]);
    await expect(
      handleSessionsVerb('recover', ['ghost'], runtime, { CliInputError })
    ).rejects.toThrow(/no terminal matches "ghost"/);
  });

  it('throws when neither names nor --all are given', async () => {
    const { runtime } = recoverFixture([]);
    await expect(
      handleSessionsVerb('recover', [], runtime, { CliInputError })
    ).rejects.toThrow(/pass session names, or --all/);
  });
});

describe('ant sessions misc', () => {
  it('rejects unknown sub-verb', async () => {
    const { runtime } = makeRuntime(() => ok({}));
    await expect(handleSessionsVerb('frobnicate', [], runtime, { CliInputError })).rejects.toThrow(/unknown sessions verb/);
  });
});
