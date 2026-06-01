#!/usr/bin/env node
/**
 * ant identity — live CLI for consent-gated impersonation enrolment.
 *
 * Part of plan_consent_gate_2026_05_20. Walks a human owner through:
 *   ant identity register   --handle @you           (one-time, needs admin bearer)
 *   ant identity enroll-2fa --handle @you           (scan QR with Authy, print recovery codes)
 *   ant identity grant      --handle @you           (creates a consent grant)
 *
 * No external server. Hits /api/owners/* on $ANT_SERVER_URL.
 * Reads ANT_ADMIN_TOKEN from env for register only.
 *
 * Run via: bun run scripts/ant-identity-live.mjs <verb> --flags
 */

import { createInterface } from 'readline';
import { stdin as input, stdout as output } from 'process';
import qrcode from 'qrcode';

const SERVER = process.env.ANT_SERVER_URL ?? 'http://127.0.0.1:6174';
const ADMIN = process.env.ANT_ADMIN_TOKEN ?? '';

function parseFlags(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith('--')) { flags[key] = next; i++; }
      else flags[key] = true;
    }
  }
  return flags;
}

function ask(question, { hidden = false } = {}) {
  return new Promise((resolve) => {
    const rl = createInterface({ input, output, terminal: true });
    if (hidden) {
      const stdoutWrite = output.write.bind(output);
      const onData = () => stdoutWrite('');
      output.write = (chunk, enc, cb) => {
        if (chunk && chunk.toString().includes(question)) {
          return stdoutWrite(chunk, enc, cb);
        }
        return true;
      };
      rl.question(question, (answer) => {
        output.write = stdoutWrite;
        rl.close();
        stdoutWrite('\n');
        resolve(answer);
      });
      input.on('data', onData);
    } else {
      rl.question(question, (answer) => { rl.close(); resolve(answer); });
    }
  });
}

async function apiPost(path, body, { admin = false } = {}) {
  const headers = { 'content-type': 'application/json' };
  if (admin) {
    if (!ADMIN) throw new Error('ANT_ADMIN_TOKEN env var required for admin call');
    headers.authorization = `Bearer ${ADMIN}`;
  }
  const res = await fetch(`${SERVER}${path}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });
  const text = await res.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }
  if (!res.ok) {
    const msg = json?.message ?? json?.raw ?? `HTTP ${res.status}`;
    throw new Error(`${res.status} ${msg}`);
  }
  return json;
}

async function verbRegister(flags) {
  const handle = flags.handle ?? (await ask('Handle (e.g. @you): '));
  const password = await ask('New password (min 8 chars): ', { hidden: true });
  const owner = await apiPost('/api/owners/register', { handle, password }, { admin: true });
  console.log('');
  console.log(`✓ Owner created`);
  console.log(`  id:             ${owner.owner.id}`);
  console.log(`  primary handle: ${owner.owner.primaryHandle}`);
  console.log(`  TOTP enrolled:  ${owner.owner.totpEnrolledAtMs ? 'yes' : 'no — run enroll-2fa next'}`);
}

async function verbEnroll(flags) {
  const handle = flags.handle ?? (await ask('Handle: '));
  const password = await ask('Password: ', { hidden: true });
  console.log('Requesting fresh TOTP secret...');
  const begin = await apiPost('/api/owners/enroll-2fa/begin', { handle, password });
  console.log('');
  console.log('Scan this QR with Authy (or any TOTP app — Google Authenticator, 1Password):');
  console.log('');
  const qr = await qrcode.toString(begin.otpauthUrl, { type: 'terminal', small: true });
  console.log(qr);
  console.log(`Manual entry secret (if QR fails): ${begin.secretBase32}`);
  console.log(`Issuer: ANT   Account: ${handle}`);
  console.log('');
  const code = await ask('Enter the 6-digit code shown in Authy: ');
  const confirm = await apiPost('/api/owners/enroll-2fa/confirm', {
    handle, password, secretBase32: begin.secretBase32, code: code.trim()
  });
  console.log('');
  console.log('✓ TOTP enrolled. Recovery codes (each works once if you lose your phone):');
  console.log('');
  for (const rc of confirm.recoveryCodes) console.log(`  ${rc}`);
  console.log('');
  console.log('STORE THESE NOW — they will never be shown again. Server only keeps hashes.');
}

async function verbGrant(flags) {
  const handle = flags.handle ?? (await ask('Owner handle: '));
  const targetTerm = flags['to-terminal'] ?? (await ask('Granted-to terminal id: '));
  const duration = flags.duration ?? (await ask('Duration (e.g. 30m, 2h, 1d): '));
  const usesInput = flags.uses ?? (await ask('Max uses (blank = unlimited within TTL): '));
  const password = await ask('Password: ', { hidden: true });
  const code = flags.code ?? (await ask('TOTP code (or use --recovery-code if lost): '));
  const body = {
    handle, password, code: code.trim(),
    grantedToTerminalId: targetTerm,
    createdByTerminalId: flags['from-terminal'] ?? targetTerm,
    duration
  };
  if (usesInput && String(usesInput).trim().length > 0) {
    body.maxUses = parseInt(String(usesInput), 10);
  }
  const result = await apiPost('/api/owners/grant', body);
  const g = result.grant;
  console.log('');
  console.log(`✓ Grant ${g.id} created`);
  console.log(`  Owner handle:   ${g.grantedToHandle}`);
  console.log(`  Granted to:     terminal ${g.grantedToTerminalId}`);
  console.log(`  Status:         ${g.status}`);
  console.log(`  Expires at ms:  ${g.expiresAtMs}`);
  console.log(`  Max uses:       ${g.maxUses ?? 'unlimited within TTL'}`);
}

const VERBS = { register: verbRegister, 'enroll-2fa': verbEnroll, grant: verbGrant };

async function main() {
  const [, , verb, ...rest] = process.argv;
  if (!verb || !VERBS[verb]) {
    console.error('Usage: ant-identity-live.mjs <register|enroll-2fa|grant> [--flags]');
    process.exit(2);
  }
  try {
    await VERBS[verb](parseFlags(rest));
  } catch (err) {
    console.error(`✗ ${err.message}`);
    process.exit(1);
  }
}

main();
