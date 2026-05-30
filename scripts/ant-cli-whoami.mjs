/**
 * ant whoami — substrate-side answer to "which handle is mine?".
 *
 * The verb every fresh shell runs first. Walks the caller's PID chain
 * locally, POSTs it to /api/identity/whoami, and exits with a code the
 * agent's shell can branch on instead of guessing from stale session
 * context. Spec: docs/concepts/ant-whoami-primitive.md. Co-signed by
 * @speedy + @v4claude in Heroes room (msg_so9awpjlmw + msg_eqce1j2cec).
 *
 *   ant whoami [--json] [--quiet]
 *
 * Exit codes:
 *   0 — bound; handle resolved cleanly
 *   2 — terminal registered but no handle assigned yet (run ant register)
 *   3 — no terminal record on this PID chain (run ant register)
 *   4 — collision: PID chain matches multiple records (operator pick needed)
 *   5 — server unreachable
 *   6 — stale-rebind: PID matches but pid_start disagrees (re-register)
 */

import { processIdentityChain } from './ant-cli-identity-chain.mjs';

const BOOLEAN_FLAGS = new Set(['json', 'quiet']);

function parseFlags(args) {
  const flags = {};
  for (const arg of args) {
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    if (BOOLEAN_FLAGS.has(key)) flags[key] = true;
  }
  return flags;
}

function formatHumanLine(payload) {
  const parts = [payload.handle];
  const inner = [];
  if (payload.terminalName) inner.push(`agent ${payload.terminalName}`);
  if (payload.lastBoundAt) {
    const hhmm = payload.lastBoundAt.slice(11, 16);
    inner.push(`bound ${hhmm} UTC`);
  }
  if (payload.lastBoundRoom) inner.push(`last room: ${payload.lastBoundRoom}`);
  if (inner.length > 0) parts.push(`(${inner.join(', ')})`);
  return parts.join('   ');
}

export async function handleWhoamiVerb(action, args, runtime) {
  const { fetchImpl, writeOut, writeErr, serverUrl } = runtime;
  const fullArgs = action !== undefined ? [action, ...args] : args;
  const flags = parseFlags(fullArgs);
  const chain = processIdentityChain();
  if (chain.length === 0) {
    writeErr('ant whoami: could not walk PID chain (no entries from processIdentityChain).');
    return 5;
  }

  let response;
  try {
    response = await fetchImpl(`${serverUrl}/api/identity/whoami`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ pids: chain })
    });
  } catch (err) {
    if (!flags.quiet) writeErr(`ant whoami: server unreachable at ${serverUrl} (${err?.message ?? err}).`);
    return 5;
  }

  const payload = await response.json().catch(() => ({}));

  if (response.status === 200 && payload.status === 'bound') {
    if (flags.quiet) return 0;
    writeOut(flags.json ? JSON.stringify(payload, null, 2) : formatHumanLine(payload));
    return 0;
  }
  if (response.status === 422 && payload.status === 'registered-no-handle') {
    if (!flags.quiet) {
      writeOut(
        flags.json
          ? JSON.stringify(payload, null, 2)
          : `terminal ${payload.terminalName ?? payload.terminalId} registered but no handle — run: ant register --handle @<you>`
      );
    }
    return 2;
  }
  if (response.status === 404) {
    if (!flags.quiet) {
      writeOut(
        flags.json
          ? JSON.stringify(payload, null, 2)
          : `no terminal record on this PID chain — run: ant register --handle @<you>`
      );
    }
    return 3;
  }
  if (response.status === 409 && payload.status === 'collision') {
    if (!flags.quiet) {
      writeOut(
        flags.json
          ? JSON.stringify(payload, null, 2)
          : `pid chain matches multiple terminals — operator must pick (see candidates in --json output)`
      );
    }
    return 4;
  }
  if (response.status === 409 && payload.status === 'stale-rebind') {
    if (!flags.quiet) {
      writeOut(
        flags.json
          ? JSON.stringify(payload, null, 2)
          : `stale-rebind: terminal ${payload.name ?? payload.terminalId} has a different pid_start than recorded — run: ant register --handle @<you>`
      );
    }
    return 6;
  }
  if (!flags.quiet) {
    writeErr(`ant whoami: unexpected response ${response.status}: ${JSON.stringify(payload)}`);
  }
  return 5;
}
