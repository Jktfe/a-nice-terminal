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

const __dirname = dirname(fileURLToPath(import.meta.url));
const LIVE_SCRIPT = join(__dirname, 'ant-identity-live.mjs');

const KNOWN_VERBS = new Set(['register', 'enroll-2fa', 'grant']);

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
}

export async function handleIdentityVerb(secondaryVerb, rest, runtime, { CliInputError } = {}) {
  if (!secondaryVerb || secondaryVerb === 'help' || secondaryVerb === '--help') {
    printIdentityUsage(runtime);
    return 0;
  }
  if (!KNOWN_VERBS.has(secondaryVerb)) {
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
