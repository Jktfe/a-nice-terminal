import { describe, expect, it } from 'vitest';
import { handleIntegrationsVerb } from './ant-cli-integrations.mjs';
import { homedir } from 'node:os';
import { join } from 'node:path';

class CliInputError extends Error {}

function makeRuntime({ commands = {}, fetchImpl, env = {} } = {}) {
  const captured = { stdout: [], stderr: [] };
  const runtime = {
    serverUrl: 'http://test.local',
    env,
    writeOut: (line) => captured.stdout.push(String(line)),
    writeErr: (line) => captured.stderr.push(String(line)),
    fetchImpl: fetchImpl ?? (async () => {
      throw new Error('proxy unavailable');
    }),
    commandProbeImpl: async (command, args) => {
      const key = `${command} ${args.join(' ')}`;
      const value = commands[key];
      if (value) return value;
      return { ok: false, stdout: '', stderr: '', error: 'command not found' };
    }
  };
  return { runtime, captured };
}

function parseOnlyJson(captured) {
  expect(captured.stdout).toHaveLength(1);
  return JSON.parse(captured.stdout[0]);
}

describe('ant integrations headroom status', () => {
  it('reports a missing headroom binary and exits 2', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleIntegrationsVerb('headroom', ['status', '--json'], runtime, { CliInputError });
    const payload = parseOnlyJson(captured);

    expect(code).toBe(2);
    expect(payload.installed).toBe(false);
    expect(payload.ready).toBe(false);
    expect(payload.recommendation).toBe('install_headroom_first');
  });

  it('refuses ready when telemetry is only the upstream default', async () => {
    const { runtime, captured } = makeRuntime({
      env: {},
      commands: {
        'headroom --version': { ok: true, stdout: 'headroom 0.26.0\n', stderr: '', error: null },
        'headroom mcp --help': { ok: true, stdout: 'usage: headroom mcp\n', stderr: '', error: null }
      }
    });
    const code = await handleIntegrationsVerb('headroom', ['status', '--json'], runtime, { CliInputError });
    const payload = parseOnlyJson(captured);

    expect(code).toBe(2);
    expect(payload.installed).toBe(true);
    expect(payload.version).toBe('0.26.0');
    expect(payload.telemetry).toMatchObject({ state: 'default_enabled', accepted: false });
    expect(payload.recommendation).toBe('disable_or_acknowledge_headroom_telemetry');
  });

  it('is ready for an MCP artifact probe when telemetry is off and MCP is available', async () => {
    const { runtime, captured } = makeRuntime({
      env: { HEADROOM_TELEMETRY: 'off' },
      commands: {
        'headroom --version': { ok: true, stdout: 'headroom-ai, version 0.26.0\n', stderr: '', error: null },
        'headroom mcp --help': { ok: true, stdout: 'usage: headroom mcp\n', stderr: '', error: null }
      }
    });
    const code = await handleIntegrationsVerb('headroom', ['status', '--json'], runtime, { CliInputError });
    const payload = parseOnlyJson(captured);

    expect(code).toBe(0);
    expect(payload.ready).toBe(true);
    expect(payload.telemetry.accepted).toBe(true);
    expect(payload.workspace.usesAntWorkspace).toBe(true);
    expect(payload.workspace.workspaceDir).toBe(join(homedir(), '.ant', 'headroom'));
    expect(payload.mcp).toMatchObject({
      available: true,
      tools: ['headroom_compress', 'headroom_retrieve', 'headroom_stats']
    });
    expect(payload.recommendation).toBe('ready_for_opt_in_mcp_artifact_probe');
  });

  it('prefers proxy readiness when the proxy health check passes', async () => {
    const { runtime, captured } = makeRuntime({
      env: { HEADROOM_TELEMETRY: 'off' },
      commands: {
        'headroom --version': { ok: true, stdout: '0.26.0\n', stderr: '', error: null },
        'headroom mcp --help': { ok: true, stdout: 'usage: headroom mcp\n', stderr: '', error: null }
      },
      fetchImpl: async (url) => {
        expect(url).toBe('http://127.0.0.1:8787/health');
        return new Response(JSON.stringify({ status: 'healthy' }), {
          status: 200,
          headers: { 'content-type': 'application/json' }
        });
      }
    });
    const code = await handleIntegrationsVerb('headroom', ['status', '--json'], runtime, { CliInputError });
    const payload = parseOnlyJson(captured);

    expect(code).toBe(0);
    expect(payload.proxy).toMatchObject({ healthy: true, status: 200 });
    expect(payload.recommendation).toBe('ready_for_opt_in_proxy_artifact_probe');
  });

  it('refuses ready when Headroom dirs are outside ANT-owned storage', async () => {
    const { runtime, captured } = makeRuntime({
      env: {
        HEADROOM_TELEMETRY: 'off',
        HEADROOM_WORKSPACE_DIR: join(homedir(), '.headroom'),
        HEADROOM_CONFIG_DIR: join(homedir(), '.headroom', 'config')
      },
      commands: {
        'headroom --version': { ok: true, stdout: 'headroom 0.26.0\n', stderr: '', error: null },
        'headroom mcp --help': { ok: true, stdout: 'usage: headroom mcp\n', stderr: '', error: null }
      }
    });
    const code = await handleIntegrationsVerb('headroom', ['status', '--json'], runtime, { CliInputError });
    const payload = parseOnlyJson(captured);

    expect(code).toBe(2);
    expect(payload.workspace.usesAntWorkspace).toBe(false);
    expect(payload.recommendation).toBe('set_ant_owned_headroom_workspace_dirs');
  });

  it('accepts explicit telemetry acknowledgement without marking telemetry off', async () => {
    const { runtime, captured } = makeRuntime({
      env: { ANT_HEADROOM_TELEMETRY_ACK: '1' },
      commands: {
        'headroom --version': { ok: true, stdout: 'headroom 0.26.0\n', stderr: '', error: null },
        'headroom mcp --help': { ok: true, stdout: 'usage: headroom mcp\n', stderr: '', error: null }
      }
    });
    const code = await handleIntegrationsVerb('headroom', ['status', '--json'], runtime, { CliInputError });
    const payload = parseOnlyJson(captured);

    expect(code).toBe(0);
    expect(payload.telemetry).toMatchObject({ state: 'acknowledged_default_enabled', accepted: true });
    expect(payload.recommendation).toBe('ready_for_opt_in_mcp_artifact_probe');
  });
});
