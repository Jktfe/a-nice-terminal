/**
 * ant identity — thin dispatcher that proxies to ant-identity-live.mjs.
 *
 * Verb forms:
 *   ant identity register   --handle @you
 *   ant identity enroll-2fa --handle @you
 *   ant identity grant      --handle @you --to-terminal T --duration 30m --uses 5 --code 482915
 *
 * Wires the consent-gated impersonation enrolment flow into the main
 * `ant` CLI so users don't need to remember a separate script path.
 *
 * The actual fetch + readline + QR-rendering logic lives in
 * scripts/ant-identity-live.mjs — this file just hands off argv.
 */

import { spawn } from 'child_process';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { handleIdentityKeysVerb, isIdentityKeysVerb } from './ant-cli-identity-keys.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIVE_SCRIPT = join(__dirname, 'ant-identity-live.mjs');

const KNOWN_LIVE_VERBS = new Set(['register', 'enroll-2fa', 'grant']);

function printIdentityUsage(runtime) {
  runtime.writeOut('ant identity — consent-gated impersonation enrolment');
  runtime.writeOut('');
  runtime.writeOut('Usage:');
  runtime.writeOut('  ant identity register   --handle @you            (one-time, needs ANT_ADMIN_TOKEN)');
  runtime.writeOut('  ant identity enroll-2fa --handle @you            (scan QR with Authy, get recovery codes)');
  runtime.writeOut('  ant identity grant      --handle @you            (creates a time-bounded consent grant)');
  runtime.writeOut('                          --to-terminal TERM_ID');
  runtime.writeOut('                          --duration 30m');
  runtime.writeOut('                          --uses 5');
  runtime.writeOut('                          [--code 482915 | --recovery-code XXXX-XXXX]');
  runtime.writeOut('');
  runtime.writeOut('Multi-device key management (substrate v0.2 Part 4):');
  runtime.writeOut('  ant identity attest-device --new-device LABEL --identity-id ID --attester-key KEY_ID');
  runtime.writeOut('                             --private-key-file PATH [--new-private-key-file PATH]');
  runtime.writeOut('  ant identity revoke-device --device LABEL --identity-id ID --attester-key KEY_ID');
  runtime.writeOut('  ant identity recover       --org-admin HANDLE --reason TEXT --identity-id ID');
  runtime.writeOut('  ant identity approve-recovery GRANT_ID');
  runtime.writeOut('  ant identity recover-from-paper-key --mnemonic "<24 words>" --identity-id ID');
  runtime.writeOut('  ant identity list-keys --identity HANDLE');
}

export async function handleIdentityVerb(secondaryVerb, rest, runtime, ctx = {}) {
  const { CliInputError } = ctx;
  if (!secondaryVerb || secondaryVerb === 'help' || secondaryVerb === '--help') {
    printIdentityUsage(runtime);
    return 0;
  }
  // Substrate v0.2 Part 4 sub-verbs handled in-process (no spawn). These
  // talk to /api/identity/attest-* + identity_keys store via fetch — same
  // shape as other in-process verbs like `ant identity grant` future will
  // be. Live spawn-out path is kept for the legacy enrolment verbs only.
  if (isIdentityKeysVerb(secondaryVerb)) {
    return handleIdentityKeysVerb(secondaryVerb, rest, runtime, { CliInputError });
  }
  if (!KNOWN_LIVE_VERBS.has(secondaryVerb)) {
    if (CliInputError) throw new CliInputError(`Unknown identity verb: ${secondaryVerb}`);
    runtime.writeErr(`Unknown identity verb: ${secondaryVerb}`);
    printIdentityUsage(runtime);
    return 1;
  }
  return new Promise((resolve) => {
    const child = spawn(process.execPath, [LIVE_SCRIPT, secondaryVerb, ...rest], {
      stdio: 'inherit',
      env: process.env
    });
    child.on('exit', (code) => resolve(code ?? 0));
    child.on('error', (err) => {
      runtime.writeErr(`ant identity: ${err.message}`);
      resolve(1);
    });
  });
}
