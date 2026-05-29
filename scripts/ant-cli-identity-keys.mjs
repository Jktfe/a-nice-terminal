/**
 * ant identity keys — substrate v0.2 Part 4 (2026-05-29).
 *
 * CLI verbs for the identity_keys multi-device model. These layer on top of
 * the existing `ant identity register / enroll-2fa / grant` verbs (which
 * live in ant-cli-identity.mjs and forward to ant-identity-live.mjs).
 *
 * Sub-verbs handled here:
 *   ant identity attest-device --new-device LABEL [--reason TEXT]
 *   ant identity revoke-device --device LABEL [--reason TEXT]
 *   ant identity recover --org-admin HANDLE --reason TEXT
 *   ant identity approve-recovery GRANT_ID
 *   ant identity recover-from-paper-key
 *   ant identity list-keys [--identity HANDLE]
 *
 * Spec: /tmp/ant-identity-keys-multi-device-canvas-2026-05-29.md.
 *
 * Crypto: node:crypto's ed25519 — no external dep. CLI generates the
 * private seed locally; only the public key + signed challenge cross
 * the wire. Private keys live in the OS keychain (label
 * `ant-identity-<key_id>`) — this slice ships the in-memory placeholder
 * (warn-only); real keychain wiring lands when Stage B permissions does.
 *
 * TODO(stage-b): wire OS keychain. For now, a `--private-key-file PATH`
 * fallback is supported so smoke tests + headless servers can drive the
 * flow without a keychain.
 */

import { generateKeyPairSync, sign, randomBytes, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';

const KNOWN_VERBS = new Set([
  'attest-device',
  'revoke-device',
  'recover',
  'approve-recovery',
  'recover-from-paper-key',
  'list-keys'
]);

export function isIdentityKeysVerb(verb) {
  return KNOWN_VERBS.has(verb);
}

export async function handleIdentityKeysVerb(secondaryVerb, rest, runtime, ctx) {
  const { CliInputError } = ctx ?? {};
  const flags = parseFlags(rest, CliInputError);
  switch (secondaryVerb) {
    case 'attest-device':
      return runAttestDevice(flags, runtime, CliInputError);
    case 'revoke-device':
      return runRevokeDevice(flags, runtime, CliInputError);
    case 'recover':
      return runRecover(flags, runtime, CliInputError);
    case 'approve-recovery':
      return runApproveRecovery(flags, rest, runtime, CliInputError);
    case 'recover-from-paper-key':
      return runRecoverFromPaperKey(flags, runtime, CliInputError);
    case 'list-keys':
      return runListKeys(flags, runtime, CliInputError);
    default:
      throw new CliInputError(`Unknown identity verb: ${secondaryVerb}`);
  }
}

function parseFlags(rawArgs, CliInputError) {
  const collected = {};
  const positionals = [];
  let cursor = 0;
  while (cursor < rawArgs.length) {
    const token = rawArgs[cursor];
    if (token === undefined) break;
    if (!String(token).startsWith('--')) {
      positionals.push(token);
      cursor += 1;
      continue;
    }
    const flagName = token.slice(2);
    const next = rawArgs[cursor + 1];
    if (next === undefined || String(next).startsWith('--')) {
      collected[flagName] = 'true';
      cursor += 1;
      continue;
    }
    collected[flagName] = next;
    cursor += 2;
  }
  collected.__positionals = positionals;
  return collected;
}

async function postJson(runtime, path, body, extraHeaders = {}) {
  return runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...adminBearerHeader(runtime),
      ...extraHeaders
    },
    body: JSON.stringify(body)
  });
}

async function getJson(runtime, path) {
  return runtime.fetchImpl(`${runtime.serverUrl}${path}`, {
    method: 'GET',
    headers: { ...adminBearerHeader(runtime) }
  });
}

function adminBearerHeader(runtime) {
  const token = runtime.adminBearer ?? process.env.ANT_ADMIN_TOKEN;
  if (!token) return {};
  return { authorization: `Bearer ${token}` };
}

// ---------------------------------------------------------------------------
// ed25519 helpers (mirror the server-side store; CLI does its own keygen)
// ---------------------------------------------------------------------------

function generateEd25519Pair() {
  const pair = generateKeyPairSync('ed25519');
  const pubJwk = pair.publicKey.export({ format: 'jwk' });
  const privJwk = pair.privateKey.export({ format: 'jwk' });
  return {
    publicKey: Buffer.from(pubJwk.x, 'base64url').toString('base64'),
    privateKey: Buffer.from(privJwk.d, 'base64url').toString('base64')
  };
}

function signCanonical(canonicalPayload, privateKeyBase64, publicKeyBase64) {
  // Re-import via JWK with both d + x set so node:crypto can build the
  // signing key without a separate public-key import step.
  const keyObject = createPrivateFromBase64(privateKeyBase64, publicKeyBase64);
  return sign(null, Buffer.from(canonicalPayload, 'utf8'), keyObject).toString('base64');
}

function createPrivateFromBase64(privateKeyBase64, publicKeyBase64) {
  // Lazy require so we don't pay the cost when CLI is just listing keys.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { createPrivateKey } = require('node:crypto');
  return createPrivateKey({
    key: {
      kty: 'OKP',
      crv: 'Ed25519',
      x: Buffer.from(publicKeyBase64, 'base64').toString('base64url'),
      d: Buffer.from(privateKeyBase64, 'base64').toString('base64url')
    },
    format: 'jwk'
  });
}

function canonicalPayloadFor(nonce, publicKey, deviceLabel) {
  return `attest-device|${nonce}|${publicKey}|${deviceLabel}`;
}

// ---------------------------------------------------------------------------
// Key storage placeholder
//
// TODO(stage-b): replace with OS keychain. The placeholder uses an explicit
// --private-key-file PATH flag so callers (and tests) drive the flow
// deterministically. Reading from / writing to a plaintext file is NOT a
// production-grade key store — that's the whole point of Stage B.
// ---------------------------------------------------------------------------

function loadPrivateKeyMaterial(flags, runtime, CliInputError) {
  const path = flags['private-key-file'];
  if (!path) {
    throw new CliInputError(
      'No private key source supplied. Pass --private-key-file PATH (the keychain bridge ships in Stage B).'
    );
  }
  const raw = readFileSync(path, 'utf8').trim();
  // File format: two lines — first public key base64, second private key base64.
  const [pub, priv] = raw.split(/\r?\n/);
  if (!pub || !priv) {
    throw new CliInputError(`--private-key-file ${path} must have two lines (public, private).`);
  }
  return { publicKey: pub.trim(), privateKey: priv.trim() };
}

function writePrivateKeyMaterial(path, publicKey, privateKey) {
  writeFileSync(path, `${publicKey}\n${privateKey}\n`, { mode: 0o600 });
}

// ---------------------------------------------------------------------------
// Sub-verbs
// ---------------------------------------------------------------------------

async function runAttestDevice(flags, runtime, CliInputError) {
  const newDeviceLabel = flags['new-device'];
  const identityId = flags['identity-id'];
  const attesterKeyId = flags['attester-key'];
  if (!newDeviceLabel) throw new CliInputError('attest-device requires --new-device LABEL');
  if (!identityId) throw new CliInputError('attest-device requires --identity-id IDENT_ID');
  if (!attesterKeyId) throw new CliInputError('attest-device requires --attester-key KEY_ID');

  const attester = loadPrivateKeyMaterial(flags, runtime, CliInputError);
  const fresh = generateEd25519Pair();

  // Step 1: request a challenge.
  const challengeResp = await postJson(runtime, '/api/identity/attest-challenge', {
    identity_id: identityId,
    new_public_key: fresh.publicKey,
    new_device_label: newDeviceLabel,
    attester_key_id: attesterKeyId
  });
  if (!challengeResp.ok) {
    const text = await challengeResp.text().catch(() => '');
    runtime.writeErr(`attest-challenge failed (${challengeResp.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const challengeBody = await challengeResp.json();
  const nonce = challengeBody.nonce;

  // Step 2: sign the canonical payload with the attester key.
  const canonicalPayload = canonicalPayloadFor(nonce, fresh.publicKey, newDeviceLabel);
  const signature = signCanonical(canonicalPayload, attester.privateKey, attester.publicKey);

  // Step 3: POST the signed payload to attest-device.
  const attestResp = await postJson(runtime, '/api/identity/attest-device', {
    nonce,
    signature,
    reason: flags.reason ?? null
  });
  if (!attestResp.ok) {
    const text = await attestResp.text().catch(() => '');
    runtime.writeErr(`attest-device failed (${attestResp.status}): ${text.slice(0, 200)}`);
    return 1;
  }
  const attestBody = await attestResp.json();

  // Step 4: persist the new private key. Placeholder: write to a file
  // when --new-private-key-file is supplied, otherwise emit a warning.
  const outputPath = flags['new-private-key-file'];
  if (outputPath) {
    writePrivateKeyMaterial(outputPath, fresh.publicKey, fresh.privateKey);
    runtime.writeOut(`Wrote new private key to ${outputPath} (mode 0600).`);
  } else {
    runtime.writeOut('WARNING: --new-private-key-file not supplied. Private key was not persisted.');
    runtime.writeOut(`Public key:  ${fresh.publicKey}`);
    runtime.writeOut(`Private key: ${fresh.privateKey}  (store this in your OS keychain manually)`);
  }
  runtime.writeOut(
    `Attested ${attestBody.device_label} as ${attestBody.key_id} on identity ${attestBody.identity_id}`
  );
  runtime.writeOut(`Attestation: ${attestBody.attestation_id}`);
  return 0;
}

async function runRevokeDevice(flags, runtime, CliInputError) {
  const deviceLabel = flags.device;
  const identityId = flags['identity-id'];
  const attesterKeyId = flags['attester-key'];
  if (!deviceLabel) throw new CliInputError('revoke-device requires --device LABEL');
  if (!identityId) throw new CliInputError('revoke-device requires --identity-id IDENT_ID');
  if (!attesterKeyId) throw new CliInputError('revoke-device requires --attester-key KEY_ID');

  // TODO(stage-b): this thin scaffold targets a future POST /api/identity/revoke-device
  // endpoint. It's not implemented yet — Stage B will land it alongside the
  // permissions modal. The CLI parsing path is exercised by tests today so
  // the contract is locked in.
  runtime.writeOut(
    `revoke-device staged for identity=${identityId} device=${deviceLabel} attester=${attesterKeyId}`
  );
  runtime.writeOut('Server endpoint /api/identity/revoke-device lands in Stage B permissions slice.');
  return 0;
}

async function runRecover(flags, runtime, CliInputError) {
  const orgAdmin = flags['org-admin'];
  const reason = flags.reason;
  const requesterIdentityId = flags['identity-id'];
  if (!orgAdmin) throw new CliInputError('recover requires --org-admin HANDLE');
  if (!reason) throw new CliInputError('recover requires --reason TEXT');
  if (!requesterIdentityId) throw new CliInputError('recover requires --identity-id IDENT_ID');

  // TODO(stage-b): POST /api/identity/recover endpoint lands with permissions
  // slice. For now this is a thin scaffold that prints the staged request.
  runtime.writeOut(
    `recovery requested by ${requesterIdentityId} targeting ${orgAdmin}: ${reason}`
  );
  runtime.writeOut(
    'Modal routing for org-admin approval ships in Stage B. Org admin can approve manually via:'
  );
  runtime.writeOut('  ant identity approve-recovery <grant_id>');
  return 0;
}

async function runApproveRecovery(flags, rest, runtime, CliInputError) {
  const grantId = flags.__positionals?.[0];
  if (!grantId) throw new CliInputError('approve-recovery requires a grant_id positional argument');
  runtime.writeOut(`approve-recovery staged for grant=${grantId}`);
  runtime.writeOut(
    'Server endpoint /api/identity/approve-recovery lands in Stage B permissions slice.'
  );
  return 0;
}

async function runRecoverFromPaperKey(flags, runtime, CliInputError) {
  const mnemonic = flags.mnemonic;
  const identityId = flags['identity-id'];
  if (!mnemonic) {
    throw new CliInputError(
      'recover-from-paper-key requires --mnemonic "<24 words>" (passed inline for now; interactive prompt lands in Stage B).'
    );
  }
  if (!identityId) throw new CliInputError('recover-from-paper-key requires --identity-id IDENT_ID');

  // Hash the supplied mnemonic so the operator can confirm it locally
  // before passing it to the server.
  const hash = createHash('sha256').update(mnemonic, 'utf8').digest('hex');
  runtime.writeOut(`Mnemonic hash (sha256 hex): ${hash}`);
  runtime.writeOut(
    'Server endpoint /api/identity/recover-from-paper-key lands in Stage B permissions slice.'
  );
  runtime.writeOut(
    'Expected substrate behaviour: server compares this hash to identities.paper_key_hash; on match, mints a new device key + rotates the paper hash.'
  );
  return 0;
}

async function runListKeys(flags, runtime, CliInputError) {
  const identityIdOrHandle = flags.identity ?? flags['identity-id'];
  if (!identityIdOrHandle) {
    throw new CliInputError(
      'list-keys requires --identity <handle> or --identity-id <id> (the default-to-caller shortcut ships in Stage B).'
    );
  }
  // For now, fetch via a JSON helper endpoint that doesn't exist yet either.
  // Print the staged call so tests can pin the contract.
  runtime.writeOut(`list-keys staged for identity=${identityIdOrHandle}`);
  runtime.writeOut(
    'Server endpoint /api/identity/keys?identity=... lands in Stage B permissions slice.'
  );
  return 0;
}

// ---------------------------------------------------------------------------
// Test exports
// ---------------------------------------------------------------------------

export const __testExports = {
  parseFlags,
  generateEd25519Pair,
  signCanonical,
  canonicalPayloadFor,
  loadPrivateKeyMaterial,
  writePrivateKeyMaterial
};
