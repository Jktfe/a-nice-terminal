import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleConnectVerb } from './ant-cli-connect.mjs';
import { makeCliRunner } from './ant-cli.mjs';

class CliInputError extends Error {}
const ctx = { CliInputError };

function jsonRes(payload, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => payload,
    text: async () => JSON.stringify(payload)
  };
}

function makeRuntime(replies = [], overrides = {}) {
  const calls = [], stdout = [], stderr = [];
  let i = 0;
  return {
    fetchImpl: async (url, init) => {
      calls.push({ url, init });
      const next = replies[i++];
      return next ?? jsonRes({ ok: true }, 500);
    },
    writeOut: (line) => stdout.push(line),
    writeErr: (line) => stderr.push(line),
    serverUrl: 'http://test.local',
    stdout,
    stderr,
    calls,
    ...overrides
  };
}

let scratchHome;
const savedEnv = {};

beforeEach(() => {
  scratchHome = mkdtempSync(join(tmpdir(), 'ant-cli-connect-test-'));
  for (const key of ['ANT_SESSION_ID', 'ANT_ADMIN_TOKEN', 'TMUX_PANE', 'WEZTERM_PANE']) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
});

afterEach(() => {
  rmSync(scratchHome, { recursive: true, force: true });
  for (const key of Object.keys(savedEnv)) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
});

function seedConfig(config) {
  const dir = join(scratchHome, '.ant');
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'config.json'), JSON.stringify(config, null, 2));
}

describe('ant connect', () => {
  it('registers this terminal and persists the returned durable session by pane', async () => {
    const rt = makeRuntime(
      [jsonRes({ terminal_id: 't_connect', name: 'TermA', session_id: 'sess-new' }, 201)],
      { envTmuxPane: '%connect', homeDir: scratchHome }
    );
    const code = await handleConnectVerb('--handle', ['@alice', '--name', 'TermA'], rt, ctx);
    expect(code).toBe(0);
    expect(rt.calls[0].url).toBe('http://test.local/api/identity/register');
    const body = JSON.parse(rt.calls[0].init.body);
    expect(body).toMatchObject({
      name: 'TermA',
      handle: '@alice',
      pane: '%connect',
      source: 'cli-connect'
    });
    expect(body.sessionToken).toBeUndefined();
    const raw = JSON.parse(readFileSync(join(scratchHome, '.ant', 'config.json'), 'utf8'));
    expect(raw.antSessions.byPane['%connect']).toBe('sess-new');
    expect(rt.stdout.join('\n')).toContain('Connected TermA as t_connect');
  });

  it('reuses an existing pane-scoped durable session as sessionToken', async () => {
    seedConfig({ antSessions: { byPane: { '%reuse': 'sess-existing' } } });
    const rt = makeRuntime(
      [jsonRes({ terminal_id: 't_reuse', name: 'TermB', session_id: 'sess-existing' }, 201)],
      { envTmuxPane: '%reuse', homeDir: scratchHome }
    );
    await handleConnectVerb('--handle', ['@bob', '--name', 'TermB'], rt, ctx);
    const body = JSON.parse(rt.calls[0].init.body);
    expect(body.sessionToken).toBe('sess-existing');
    expect(rt.stdout.join('\n')).toContain('session_source: config');
  });

  it('lets ANT_SESSION_ID override the pane-scoped durable session', async () => {
    process.env.ANT_SESSION_ID = 'sess-env';
    seedConfig({ antSessions: { byPane: { '%reuse': 'sess-config' } } });
    const rt = makeRuntime(
      [jsonRes({ terminal_id: 't_env', name: 'TermC', session_id: 'sess-env' }, 201)],
      { envTmuxPane: '%reuse', homeDir: scratchHome }
    );
    await handleConnectVerb('--handle', ['@carol', '--name', 'TermC'], rt, ctx);
    const body = JSON.parse(rt.calls[0].init.body);
    expect(body.sessionToken).toBe('sess-env');
    expect(rt.stdout.join('\n')).toContain('session_source: env');
  });

  it('surfaces remote bridge mappings when --room and admin token are available', async () => {
    process.env.ANT_ADMIN_TOKEN = 'admin-secret';
    const rt = makeRuntime([
      jsonRes({ terminal_id: 't_remote', name: 'TermD', session_id: 'sess-d' }, 201),
      jsonRes({ mappings: [{ id: 'map_1', remote_instance_label: 'Studio ANT', direction: 'both', last_seen_at_ms: 123 }] })
    ], { envTmuxPane: '%remote', homeDir: scratchHome });
    await handleConnectVerb('--handle', ['@dora', '--name', 'TermD', '--room', 'room-1'], rt, ctx);
    expect(rt.calls[1].url).toBe('http://test.local/api/remote-ant/mappings?roomId=room-1');
    expect(rt.calls[1].init.headers.authorization).toBe('Bearer admin-secret');
    const out = rt.stdout.join('\n');
    expect(out).toContain('remote_mappings: 1');
    expect(out).toContain('map_1');
    expect(out).toContain('remote_admit: ant remote admit --room room-1 --lifetime 48h');
  });

  it('prints bridge next steps without fetching mappings when admin token is absent', async () => {
    const rt = makeRuntime(
      [jsonRes({ terminal_id: 't_no_admin', name: 'TermE', session_id: 'sess-e' }, 201)],
      { envTmuxPane: '%noadmin', homeDir: scratchHome }
    );
    await handleConnectVerb('--handle', ['@erin', '--name', 'TermE', '--room', 'room-2'], rt, ctx);
    expect(rt.calls).toHaveLength(1);
    const out = rt.stdout.join('\n');
    expect(out).toContain('remote_bridge_note: admin token not present');
    expect(out).toContain('remote_status: ant remote mapping list --room room-2');
  });

  it('main runner dispatches connect and help advertises it', async () => {
    const rt = makeRuntime([]);
    const runner = makeCliRunner({
      fetchImpl: rt.fetchImpl,
      writeOut: rt.writeOut,
      writeErr: rt.writeErr,
      serverUrl: rt.serverUrl
    });
    const code = await runner.run(['help']);
    expect(code).toBe(0);
    expect(rt.stdout.join('\n')).toContain('connect --handle @h --name NAME');
  });
});
