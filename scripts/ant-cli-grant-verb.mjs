/**
 * ant-cli-grant-verb — Stage A grants_shim CLI verb (plan milestone
 * p3-stage-a-grant-cli of ant-substrate-v0.2-2026-05-29).
 *
 * Wired into the ant-cli.mjs dispatcher as the `grant` verb. (The
 * standalone `ant-cli-grant.mjs` is the older caller_grants script from
 * 2026-05-19 and is intentionally left untouched — it speaks to a
 * different surface, /api/admin/grants, and predates the dispatcher.)
 *
 * Usage:
 *   ant grant <handle> <action> --room <id>      grant for a specific room
 *   ant grant <handle> <action> --plan <id>      grant for a specific plan
 *   ant grant <handle> <action> --task <id>      grant for a specific task
 *   ant grant <handle> <action> --org <id>       org-wide grant
 *   ant grant <handle> <action> --system <name>  system-level grant
 *   ... [--once | --always-for-room | --always-for-agent]   scope flags
 *   ... [--revoke]                                          revoke instead of grant
 *
 * Threads `pidChain` from `processIdentityChain()` into every request
 * body so the server can resolve caller identity for the audit row.
 * Writes/revokes a row in `grants_shim` server-side.
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const TARGET_FLAGS = ['room', 'plan', 'task', 'org', 'system'];
const SCOPE_FLAGS = ['once', 'always-for-room', 'always-for-agent'];
const BOOLEAN_FLAGS = new Set([...SCOPE_FLAGS, 'revoke']);

export async function handleGrantVerb(action, args, runtime, ctx) {
  const { CliInputError } = ctx;
  // The CLI dispatcher invokes this as `(action, args, runtime, ctx)`
  // where `action` is the FIRST positional after `grant` — for us that
  // is `<handle>`. Handle help up-front so `ant grant help` works.
  if (action === undefined || action === 'help' || action === '--help') {
    writeUsage(runtime);
    return action === undefined ? 1 : 0;
  }
  const granteeHandle = normaliseHandle(action);
  const actionVerb = args[0];
  if (!actionVerb || actionVerb.startsWith('--')) {
    writeUsage(runtime);
    throw new CliInputError('grant requires <handle> <action> --<target> <id>');
  }
  const flagArgs = args.slice(1);
  const flags = parseFlags(flagArgs, CliInputError);

  const target = resolveTarget(flags, CliInputError);
  const scope = resolveScope(flags, CliInputError);
  const revoke = flags.revoke === 'true';

  const payload = {
    granteeHandle,
    action: actionVerb,
    targetKind: target.kind,
    targetId: target.id,
    pidChain: processIdentityChain()
  };
  if (!revoke && scope) {
    payload.scope = scope;
  }

  const method = revoke ? 'DELETE' : 'POST';
  const url = `${runtime.serverUrl}/api/grants`;
  const response = await runtime.fetchImpl(url, {
    method,
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload)
  });
  if (!response.ok) {
    const errorBodyText = await response.text().catch(() => '');
    runtime.writeErr(
      `ant grant ${revoke ? '--revoke ' : ''}failed (${response.status}): ${errorBodyText.slice(0, 200)}`
    );
    return 1;
  }
  const body = await response.json().catch(() => ({}));
  if (revoke) {
    const count = typeof body.revokedCount === 'number' ? body.revokedCount : 0;
    if (count === 0) {
      runtime.writeOut(
        `No active grant matched ${granteeHandle} ${actionVerb} --${target.kind} ${target.id}.`
      );
    } else {
      runtime.writeOut(
        `Revoked ${count} grant${count === 1 ? '' : 's'} for ${granteeHandle} ${actionVerb} --${target.kind} ${target.id}.`
      );
    }
  } else {
    const grantId = body?.grant?.grantId ?? '?';
    runtime.writeOut(
      `Granted ${granteeHandle} ${actionVerb} --${target.kind} ${target.id} (grant_id=${grantId}, scope=${scope ?? 'once'}).`
    );
  }
  return 0;
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (!token.startsWith('--')) {
      throw new CliInputError(`expected --flag, got "${token}"`);
    }
    const flagName = token.slice(2);
    if (BOOLEAN_FLAGS.has(flagName)) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    const flagValue = rawArgs[cursor + 1];
    if (flagValue === undefined || flagValue.startsWith('--')) {
      throw new CliInputError(`flag --${flagName} needs a value`);
    }
    collected[flagName] = flagValue;
    cursor += 2;
  }
  return collected;
}

function resolveTarget(flags, CliInputError) {
  const present = TARGET_FLAGS.filter((name) => flags[name] !== undefined);
  if (present.length === 0) {
    throw new CliInputError(
      `grant requires one of --${TARGET_FLAGS.join(' / --')}`
    );
  }
  if (present.length > 1) {
    throw new CliInputError(
      `grant accepts exactly one target flag (got --${present.join(' + --')})`
    );
  }
  return { kind: present[0], id: flags[present[0]] };
}

function resolveScope(flags, CliInputError) {
  const present = SCOPE_FLAGS.filter((name) => flags[name] === 'true');
  if (present.length === 0) return null;
  if (present.length > 1) {
    throw new CliInputError(
      `grant accepts at most one scope flag (got --${present.join(' + --')})`
    );
  }
  return present[0];
}

function normaliseHandle(handle) {
  return handle.startsWith('@') ? handle : `@${handle}`;
}

function writeUsage(runtime) {
  runtime.writeOut('ant grant <handle> <action> --room <id> [--once|--always-for-room|--always-for-agent] [--revoke]');
  runtime.writeOut('ant grant <handle> <action> --plan <id> [scope flags] [--revoke]');
  runtime.writeOut('ant grant <handle> <action> --task <id> [scope flags] [--revoke]');
  runtime.writeOut('ant grant <handle> <action> --org <id> [scope flags] [--revoke]');
  runtime.writeOut('ant grant <handle> <action> --system <name> [scope flags] [--revoke]');
}
