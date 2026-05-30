import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  handleIdentityKeysVerb,
  isIdentityKeysVerb,
  __testExports
} from './ant-cli-identity-keys.mjs';

class CliInputError extends Error {}

function okJson(body, status = 201) {
  return {
    ok: true,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function failResponse(status, message) {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => message
  };
}

function makeRuntime(responseQueue = []) {
  const captured = { calls: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init) => {
    captured.calls.push({ url, init });
    const next = responseQueue.shift();
    if (typeof next === 'function') return next();
    if (next === undefined) return okJson({});
    return next;
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://identity-keys.test',
      adminBearer: 'test-admin-token',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

let tmpDir;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-cli-identity-keys-'));
});
afterEach(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

describe('isIdentityKeysVerb', () => {
  it('accepts the six substrate-v0.2 sub-verbs', () => {
    for (const verb of [
      'attest-device',
      'revoke-device',
      'recover',
      'approve-recovery',
      'recover-from-paper-key',
      'list-keys'
    ]) {
      expect(isIdentityKeysVerb(verb)).toBe(true);
    }
  });
  it('rejects unrelated verbs', () => {
    expect(isIdentityKeysVerb('register')).toBe(false);
    expect(isIdentityKeysVerb('grant')).toBe(false);
    expect(isIdentityKeysVerb('foo')).toBe(false);
  });
});

describe('__testExports.parseFlags', () => {
  it('captures --flag VALUE pairs', () => {
    const flags = __testExports.parseFlags(
      ['--new-device', 'laptop', '--reason', 'lost'],
      CliInputError
    );
    expect(flags['new-device']).toBe('laptop');
    expect(flags.reason).toBe('lost');
  });
  it('captures positional args after flags', () => {
    const flags = __testExports.parseFlags(['grant_abc123'], CliInputError);
    expect(flags.__positionals).toEqual(['grant_abc123']);
  });
});

describe('__testExports.generateEd25519Pair + signCanonical', () => {
  it('produces 32-byte public + 32-byte private base64 strings', () => {
    const pair = __testExports.generateEd25519Pair();
    expect(Buffer.from(pair.publicKey, 'base64').length).toBe(32);
    expect(Buffer.from(pair.privateKey, 'base64').length).toBe(32);
  });
  it('signs a canonical payload to a 64-byte signature', () => {
    const pair = __testExports.generateEd25519Pair();
    const sig = __testExports.signCanonical('payload', pair.privateKey, pair.publicKey);
    expect(Buffer.from(sig, 'base64').length).toBe(64);
  });
});

describe('attest-device CLI flow', () => {
  it('requires --new-device + --identity-id + --attester-key + --private-key-file', async () => {
    const { runtime } = makeRuntime();
    let err = null;
    try {
      await handleIdentityKeysVerb('attest-device', [], runtime, { CliInputError });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliInputError);
  });

  it('rejects when only --new-device is supplied', async () => {
    const { runtime } = makeRuntime();
    let err = null;
    try {
      await handleIdentityKeysVerb(
        'attest-device',
        ['--new-device', 'phone'],
        runtime,
        { CliInputError }
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliInputError);
  });

  it('drives the two-leg flow (challenge → sign → attest) and writes new key file', async () => {
    // Stage an attester keypair on disk that the CLI can read.
    const attesterPair = __testExports.generateEd25519Pair();
    const attesterPath = join(tmpDir, 'attester.txt');
    writeFileSync(attesterPath, `${attesterPair.publicKey}\n${attesterPair.privateKey}\n`);
    const newKeyPath = join(tmpDir, 'new-device.txt');

    const { runtime, captured } = makeRuntime([
      okJson({ nonce: 'NONCE_FAKE_BASE64', ttl_ms: 300000 }),
      okJson({
        key_id: 'key_new_abc',
        attestation_id: 'att_xyz',
        device_label: 'phone',
        identity_id: 'ident_target'
      })
    ]);

    const code = await handleIdentityKeysVerb(
      'attest-device',
      [
        '--new-device', 'phone',
        '--identity-id', 'ident_target',
        '--attester-key', 'key_attester_abc',
        '--private-key-file', attesterPath,
        '--new-private-key-file', newKeyPath,
        '--reason', 'second device'
      ],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.calls.length).toBe(2);
    expect(captured.calls[0].url).toBe(
      'http://identity-keys.test/api/identity/attest-challenge'
    );
    expect(captured.calls[1].url).toBe(
      'http://identity-keys.test/api/identity/attest-device'
    );
    const challengeBody = JSON.parse(captured.calls[0].init.body);
    expect(challengeBody.identity_id).toBe('ident_target');
    expect(challengeBody.new_device_label).toBe('phone');
    expect(challengeBody.attester_key_id).toBe('key_attester_abc');
    expect(typeof challengeBody.new_public_key).toBe('string');

    const attestBody = JSON.parse(captured.calls[1].init.body);
    expect(attestBody.nonce).toBe('NONCE_FAKE_BASE64');
    expect(typeof attestBody.signature).toBe('string');
    expect(Buffer.from(attestBody.signature, 'base64').length).toBe(64);

    // New private key file persisted with 0600 perms.
    const written = readFileSync(newKeyPath, 'utf8').trim().split(/\r?\n/);
    expect(written).toHaveLength(2);
    expect(Buffer.from(written[0], 'base64').length).toBe(32);
    expect(Buffer.from(written[1], 'base64').length).toBe(32);

    expect(captured.stdout.some((l) => l.includes('key_new_abc'))).toBe(true);
  });

  it('surfaces server failure on challenge step', async () => {
    const attesterPair = __testExports.generateEd25519Pair();
    const attesterPath = join(tmpDir, 'attester.txt');
    writeFileSync(attesterPath, `${attesterPair.publicKey}\n${attesterPair.privateKey}\n`);
    const { runtime, captured } = makeRuntime([failResponse(404, 'identity not found')]);
    const code = await handleIdentityKeysVerb(
      'attest-device',
      [
        '--new-device', 'phone',
        '--identity-id', 'ident_does_not_exist',
        '--attester-key', 'key_x',
        '--private-key-file', attesterPath
      ],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(1);
    expect(captured.stderr.some((l) => l.includes('attest-challenge failed'))).toBe(true);
  });
});

describe('revoke-device CLI flow', () => {
  it('requires --device + --identity-id + --attester-key', async () => {
    const { runtime } = makeRuntime();
    let err = null;
    try {
      await handleIdentityKeysVerb(
        'revoke-device',
        ['--device', 'laptop'],
        runtime,
        { CliInputError }
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliInputError);
  });

  it('prints the staged scaffold message (server endpoint pending Stage B)', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleIdentityKeysVerb(
      'revoke-device',
      ['--device', 'laptop', '--identity-id', 'ident_x', '--attester-key', 'key_y'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.stdout.some((l) => l.includes('revoke-device staged'))).toBe(true);
    expect(captured.stdout.some((l) => l.includes('Stage B'))).toBe(true);
  });
});

describe('recover + approve-recovery + recover-from-paper-key + list-keys', () => {
  it('recover requires --org-admin + --reason + --identity-id', async () => {
    const { runtime } = makeRuntime();
    let err = null;
    try {
      await handleIdentityKeysVerb('recover', ['--org-admin', '@admin'], runtime, {
        CliInputError
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliInputError);
  });

  it('recover prints the staged request shape', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleIdentityKeysVerb(
      'recover',
      ['--org-admin', '@jwpk', '--reason', 'car crash', '--identity-id', 'ident_me'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.stdout.some((l) => l.includes('targeting @jwpk'))).toBe(true);
    expect(captured.stdout.some((l) => l.includes('approve-recovery'))).toBe(true);
  });

  it('approve-recovery requires a positional grant_id', async () => {
    const { runtime } = makeRuntime();
    let err = null;
    try {
      await handleIdentityKeysVerb('approve-recovery', [], runtime, { CliInputError });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliInputError);
  });

  it('approve-recovery prints the staged ack', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleIdentityKeysVerb(
      'approve-recovery',
      ['recov_abc'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.stdout.some((l) => l.includes('recov_abc'))).toBe(true);
  });

  it('recover-from-paper-key requires --mnemonic + --identity-id', async () => {
    const { runtime } = makeRuntime();
    let err = null;
    try {
      await handleIdentityKeysVerb(
        'recover-from-paper-key',
        ['--identity-id', 'ident_me'],
        runtime,
        { CliInputError }
      );
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliInputError);
  });

  it('recover-from-paper-key prints the mnemonic hash for operator audit', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleIdentityKeysVerb(
      'recover-from-paper-key',
      ['--mnemonic', 'test mnemonic phrase', '--identity-id', 'ident_me'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.stdout.some((l) => /^Mnemonic hash \(sha256 hex\): [0-9a-f]{64}$/.test(l))).toBe(true);
  });

  it('list-keys requires --identity or --identity-id', async () => {
    const { runtime } = makeRuntime();
    let err = null;
    try {
      await handleIdentityKeysVerb('list-keys', [], runtime, { CliInputError });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(CliInputError);
  });

  it('list-keys prints the staged ack', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleIdentityKeysVerb(
      'list-keys',
      ['--identity', '@jwpk'],
      runtime,
      { CliInputError }
    );
    expect(code).toBe(0);
    expect(captured.stdout.some((l) => l.includes('@jwpk'))).toBe(true);
  });
});
