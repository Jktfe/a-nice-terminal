/**
 * ant delivery — per-terminal delivery state surface (M3.5a).
 *
 * Subverb: verify — show verified / stale / unknown + reason for a terminal.
 *
 * v1 surfaces existing terminals.pane_status via the /api/terminals/:id/delivery
 * route. Rich agent status (working/idle/thinking) is M3.4a-v2.
 */

const BOOLEAN_FLAGS = new Set(['json']);

export async function handleDeliveryVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  const flags = parseFlags(args, CliInputError);
  if (action === 'verify') return runVerify(flags, runtime, CliInputError);
  if (!action || action === 'help' || action === '--help') {
    runtime.writeOut('ant delivery verify --terminal TERMINAL_ID [--json]');
    return action ? 0 : 1;
  }
  throw new CliInputError(`unknown delivery verb: ${action}`);
}

function parseFlags(rawArgs, CliInputError) {
  const flags = {};
  for (let cursor = 0; cursor < rawArgs.length;) {
    const token = rawArgs[cursor];
    if (!token?.startsWith('--')) throw new CliInputError(`expected --flag, got "${token}"`);
    const name = token.slice(2);
    if (BOOLEAN_FLAGS.has(name)) { flags[name] = 'true'; cursor += 1; continue; }
    const value = rawArgs[cursor + 1];
    if (value === undefined || value.startsWith('--')) throw new CliInputError(`flag --${name} needs a value`);
    flags[name] = value;
    cursor += 2;
  }
  return flags;
}

function requireFlag(flags, name, CliInputError) {
  const value = flags[name];
  if (value === undefined || value.length === 0) throw new CliInputError(`missing required flag --${name}`);
  return value;
}

async function fetchJson(runtime, path) {
  const response = await runtime.fetchImpl(`${runtime.serverUrl}${path}`);
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Request failed (${response.status}): ${text.slice(0, 200)}`);
  }
  return response.json();
}

async function runVerify(flags, runtime, CliInputError) {
  const terminalId = requireFlag(flags, 'terminal', CliInputError);
  const path = `/api/terminals/${encodeURIComponent(terminalId)}/delivery`;
  const payload = await fetchJson(runtime, path);

  if (flags.json !== undefined) {
    runtime.writeOut(JSON.stringify(payload));
    return 0;
  }
  const prefix = (payload.terminal_id ?? '').slice(0, 8);
  runtime.writeOut(`${prefix}\t${payload.delivery_state}\t(${payload.reason})`);
  return 0;
}
