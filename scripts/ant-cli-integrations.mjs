/**
 * `ant integrations ...` — local probes for optional sidecar integrations.
 *
 * The Headroom probe is intentionally read-only. It does not install packages,
 * start a proxy, wrap agents, or write Headroom state. It only reports whether
 * the local machine is safe to use for an opt-in compression experiment.
 */

import { execFile } from 'node:child_process';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const HEADROOM_MCP_TOOLS = ['headroom_compress', 'headroom_retrieve', 'headroom_stats'];
const DEFAULT_HEADROOM_PROXY_URL = 'http://127.0.0.1:8787';
const DEFAULT_TIMEOUT_MS = 1500;

const BOOLEAN_FLAGS = new Set(['json', 'allow-telemetry']);
const VALUE_FLAGS = new Set(['proxy-url', 'timeout-ms', 'bin']);

export async function handleIntegrationsVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  if (action === undefined || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action === undefined ? 1 : 0;
  }
  if (action !== 'headroom') {
    writeUsage(runtime);
    throw new CliInputError(`unknown integration: ${action}`);
  }

  const [subcommand, ...rest] = args;
  if (subcommand === undefined || subcommand === 'help' || subcommand === '--help') {
    writeHeadroomUsage(runtime);
    return subcommand === undefined ? 1 : 0;
  }
  if (subcommand !== 'status') {
    writeHeadroomUsage(runtime);
    throw new CliInputError(`unknown headroom subcommand: ${subcommand}`);
  }

  return runHeadroomStatus(rest, runtime, CliInputError);
}

function writeUsage(runtime) {
  runtime.writeOut('ant integrations <name>');
  runtime.writeOut('  headroom status [--json] [--proxy-url URL] [--timeout-ms MS]');
}

function writeHeadroomUsage(runtime) {
  runtime.writeOut('ant integrations headroom <subcommand>');
  runtime.writeOut('  status [--json] [--proxy-url URL] [--timeout-ms MS]');
}

function parseFlags(args, CliInputError) {
  const flags = {};
  const positionals = [];
  for (let i = 0; i < args.length;) {
    const token = args[i];
    if (!token?.startsWith('--')) {
      positionals.push(token);
      i += 1;
      continue;
    }
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) {
      flags[name] = true;
      i += 1;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) {
      throw new CliInputError(`unknown flag: --${name}`);
    }
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      throw new CliInputError(`flag --${name} needs a value`);
    }
    flags[name] = value;
    i += 2;
  }
  return { flags, positionals };
}

async function runHeadroomStatus(args, runtime, CliInputError) {
  const { flags, positionals } = parseFlags(args, CliInputError);
  if (positionals.length > 0) {
    throw new CliInputError(`unexpected argument: ${positionals[0]}`);
  }

  const env = runtime.env ?? process.env;
  const timeoutMs = parseTimeout(flags['timeout-ms'], CliInputError);
  const binary = String(flags.bin ?? env.HEADROOM_BIN ?? 'headroom');
  const proxyUrl = String(flags['proxy-url'] ?? env.HEADROOM_PROXY_URL ?? env.HEADROOM_BASE_URL ?? DEFAULT_HEADROOM_PROXY_URL);

  const versionProbe = await runCommand(runtime, binary, ['--version'], timeoutMs, env);
  const installed = versionProbe.ok;
  const version = installed ? parseVersion(versionProbe.stdout || versionProbe.stderr) : null;
  const mcpProbe = installed
    ? await runCommand(runtime, binary, ['mcp', '--help'], timeoutMs, env)
    : { ok: false, error: 'headroom is not installed' };
  const telemetry = inspectTelemetry(env, Boolean(flags['allow-telemetry']));
  const workspace = inspectWorkspace(env);
  const proxy = await probeProxy(runtime, proxyUrl, timeoutMs);
  const mcp = {
    available: Boolean(installed && mcpProbe.ok),
    tools: installed && mcpProbe.ok ? HEADROOM_MCP_TOOLS : [],
    error: mcpProbe.ok ? null : mcpProbe.error ?? trimForJson(mcpProbe.stderr || mcpProbe.stdout)
  };
  const recommendation = recommend({ installed, telemetry, workspace, proxy, mcp });
  const ready = recommendation.startsWith('ready_');
  const status = {
    schema: 'ant-headroom-status/1',
    installed,
    version,
    license: 'Apache-2.0',
    binary,
    telemetry,
    workspace,
    proxy,
    mcp,
    ready,
    recommendation
  };

  if (flags.json) {
    runtime.writeOut(JSON.stringify(status));
    return ready ? 0 : 2;
  }

  runtime.writeOut(`Headroom: ${installed ? `installed${version ? ` ${version}` : ''}` : 'not installed'}`);
  runtime.writeOut(`Telemetry: ${telemetry.state}${telemetry.accepted ? ' (accepted)' : ' (not accepted)'}`);
  runtime.writeOut(`Workspace: ${workspace.workspaceDir}${workspace.usesAntWorkspace ? ' (ANT-owned)' : ' (not ANT-owned)'}`);
  runtime.writeOut(`Proxy: ${proxy.healthy ? `healthy ${proxy.url}` : `not healthy ${proxy.url}${proxy.error ? ` — ${proxy.error}` : ''}`}`);
  runtime.writeOut(`MCP: ${mcp.available ? `available (${mcp.tools.join(', ')})` : `not available${mcp.error ? ` — ${mcp.error}` : ''}`}`);
  runtime.writeOut(`Recommendation: ${recommendation}`);
  return ready ? 0 : 2;
}

function parseTimeout(raw, CliInputError) {
  if (raw === undefined) return DEFAULT_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed < 250 || parsed > 30000) {
    throw new CliInputError('--timeout-ms must be between 250 and 30000');
  }
  return Math.trunc(parsed);
}

function parseVersion(text) {
  const match = String(text ?? '').match(/\b(\d+\.\d+\.\d+(?:[-+][0-9A-Za-z.-]+)?)\b/);
  return match?.[1] ?? null;
}

function isTelemetryOff(value) {
  return ['off', '0', 'false', 'no', 'disabled'].includes(String(value ?? '').trim().toLowerCase());
}

function isTelemetryAck(value) {
  return ['1', 'true', 'yes', 'on', 'ack', 'acknowledged'].includes(String(value ?? '').trim().toLowerCase());
}

function inspectTelemetry(env, allowTelemetryFlag) {
  const raw = env.HEADROOM_TELEMETRY;
  const ack = allowTelemetryFlag || isTelemetryAck(env.ANT_HEADROOM_TELEMETRY_ACK);
  if (isTelemetryOff(raw)) {
    return { state: 'off', env: raw ?? null, accepted: true };
  }
  if (ack) {
    return { state: raw ? 'acknowledged_enabled' : 'acknowledged_default_enabled', env: raw ?? null, accepted: true };
  }
  return { state: raw ? 'enabled' : 'default_enabled', env: raw ?? null, accepted: false };
}

function inspectWorkspace(env) {
  const recommendedWorkspaceDir = join(homedir(), '.ant', 'headroom');
  const recommendedConfigDir = join(recommendedWorkspaceDir, 'config');
  const workspaceDir = expandHome(env.HEADROOM_WORKSPACE_DIR || recommendedWorkspaceDir);
  const configDir = expandHome(env.HEADROOM_CONFIG_DIR || recommendedConfigDir);
  const usesAntWorkspace = isInsideOrEqual(workspaceDir, recommendedWorkspaceDir)
    && isInsideOrEqual(configDir, recommendedWorkspaceDir);
  return {
    workspaceDir,
    configDir,
    recommendedWorkspaceDir,
    recommendedConfigDir,
    usesAntWorkspace
  };
}

function expandHome(path) {
  const text = String(path ?? '');
  if (text === '~') return homedir();
  if (text.startsWith('~/')) return join(homedir(), text.slice(2));
  return text;
}

function isInsideOrEqual(candidate, root) {
  const resolvedCandidate = resolve(candidate);
  const resolvedRoot = resolve(root);
  return resolvedCandidate === resolvedRoot || resolvedCandidate.startsWith(`${resolvedRoot}/`);
}

async function runCommand(runtime, command, args, timeoutMs, env) {
  if (runtime.commandProbeImpl) {
    return runtime.commandProbeImpl(command, args, { timeoutMs, env });
  }
  return new Promise((resolveResult) => {
    execFile(command, args, { env, timeout: timeoutMs, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        resolveResult({
          ok: false,
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
          error: error.code === 'ENOENT' ? 'command not found' : trimForJson(error.message)
        });
        return;
      }
      resolveResult({ ok: true, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), error: null });
    });
  });
}

async function probeProxy(runtime, proxyUrl, timeoutMs) {
  const url = new URL('/health', proxyUrl).toString();
  try {
    const response = await runtime.fetchImpl(url, { signal: timeoutSignal(timeoutMs) });
    let body = null;
    try {
      body = await response.clone().json();
    } catch {
      body = null;
    }
    return {
      url: proxyUrl,
      healthUrl: url,
      healthy: response.ok,
      status: response.status,
      body,
      error: response.ok ? null : `HTTP ${response.status}`
    };
  } catch (error) {
    return {
      url: proxyUrl,
      healthUrl: url,
      healthy: false,
      status: null,
      body: null,
      error: trimForJson(error instanceof Error ? error.message : String(error))
    };
  }
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    return AbortSignal.timeout(timeoutMs);
  }
  const controller = new AbortController();
  setTimeout(() => controller.abort(), timeoutMs).unref?.();
  return controller.signal;
}

function recommend({ installed, telemetry, workspace, proxy, mcp }) {
  if (!installed) return 'install_headroom_first';
  if (!telemetry.accepted) return 'disable_or_acknowledge_headroom_telemetry';
  if (!workspace.usesAntWorkspace) return 'set_ant_owned_headroom_workspace_dirs';
  if (proxy.healthy) return 'ready_for_opt_in_proxy_artifact_probe';
  if (mcp.available) return 'ready_for_opt_in_mcp_artifact_probe';
  return 'install_headroom_mcp_or_proxy_extra';
}

function trimForJson(value) {
  const text = String(value ?? '').trim();
  return text.length > 240 ? `${text.slice(0, 237)}...` : text;
}
