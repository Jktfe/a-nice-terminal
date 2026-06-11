// ant helper — attachment lifecycle verb (pair/redeem/leases/revoke).
// The CLI is a thin presenter over the operator-gated pairing + lease
// endpoints; these tests pin the request shapes and the secrecy rules
// (code never echoed beyond the one mint print; secrets never listed).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleHelperVerb } from './ant-cli-helper.mjs';

class CliInputError extends Error {}
const ctx = { CliInputError };

function okJson(body, status = 200) {
  return {
    ok: status < 400,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body)
  };
}

function makeRuntime(responseQueue) {
  const captured = { calls: [], stdout: [], stderr: [] };
  const fetchImpl = async (url, init) => {
    captured.calls.push({ url, init });
    return responseQueue.shift();
  };
  return {
    runtime: {
      fetchImpl,
      serverUrl: 'http://fresh.test',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

const prevAdmin = process.env.ANT_ADMIN_TOKEN;
beforeEach(() => { process.env.ANT_ADMIN_TOKEN = 'tok-test'; });
afterEach(() => {
  if (prevAdmin === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = prevAdmin;
});

describe('ant helper pair', () => {
  it('POSTs the pairing endpoint with handle + role and prints the code once', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ pairingId: 'pair_1', code: 'AB23CD', handle: '@fClaude', role: 'agent', expiresAtMs: 1781300000000 }, 201)
    ]);
    const exit = await handleHelperVerb('pair', ['--handle', '@fClaude', '--role', 'agent'], runtime, ctx);
    expect(exit).toBe(0);
    expect(captured.calls[0].url).toBe('http://fresh.test/api/helper/pairing');
    const sent = JSON.parse(captured.calls[0].init.body);
    expect(sent).toEqual({ handle: '@fClaude', role: 'agent' });
    expect(captured.calls[0].init.headers.authorization).toBe('Bearer tok-test');
    const out = captured.stdout.join('\n');
    expect(out).toContain('AB23CD');
    expect(out).toContain('NEVER paste a pairing code in a room');
  });

  it('refuses an invalid role client-side and requires a token', async () => {
    const { runtime } = makeRuntime([]);
    await expect(handleHelperVerb('pair', ['--handle', '@x', '--role', 'admin'], runtime, ctx))
      .rejects.toThrow(/role/);
    delete process.env.ANT_ADMIN_TOKEN;
    await expect(handleHelperVerb('pair', ['--handle', '@x'], runtime, ctx))
      .rejects.toThrow(/admin token/i);
  });
});

describe('ant helper redeem', () => {
  it('redeems a code and surfaces the lease secret exactly once', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ handle: '@fClaude', role: 'agent', leaseId: 'lease_1', leaseSecret: 'lease_sk_abc', scope: { authorMessages: true }, expiresAtMs: 1 }, 201)
    ]);
    const exit = await handleHelperVerb('redeem', ['AB23CD', '--host', 'mac'], runtime, ctx);
    expect(exit).toBe(0);
    expect(captured.calls[0].url).toBe('http://fresh.test/api/helper/pairing/redeem');
    expect(JSON.parse(captured.calls[0].init.body)).toEqual({ code: 'AB23CD', host: 'mac' });
    expect(captured.stdout.join('\n')).toContain('lease_sk_abc');
  });

  it('maps a dead code (410) to a clear error', async () => {
    const { runtime, captured } = makeRuntime([okJson({ message: 'gone' }, 410)]);
    const exit = await handleHelperVerb('redeem', ['ZZZZZZ'], runtime, ctx);
    expect(exit).toBe(1);
    expect(captured.stderr.join('\n')).toMatch(/invalid|expired|used|410/i);
  });
});

describe('ant helper leases + revoke', () => {
  it('lists active leases without ever printing a secret', async () => {
    const { runtime, captured } = makeRuntime([
      okJson({ leases: [{ id: 'lease_1', handle: '@fClaude', role: 'agent', owners: ['@JWPK'], pairedHost: 'mac', createdAtMs: 1, expiresAtMs: 2, lastSeenAtMs: null }] })
    ]);
    const exit = await handleHelperVerb('leases', ['--handle', '@fClaude'], runtime, ctx);
    expect(exit).toBe(0);
    expect(captured.calls[0].url).toContain('/api/helper/leases?handle=');
    expect(captured.stdout.join('\n')).toContain('@fClaude');
    expect(captured.stdout.join('\n')).not.toContain('lease_sk_');
  });

  it('revokes by lease id', async () => {
    const { runtime, captured } = makeRuntime([okJson({ revoked: true })]);
    const exit = await handleHelperVerb('revoke', ['lease_1'], runtime, ctx);
    expect(exit).toBe(0);
    expect(captured.calls[0].url).toBe('http://fresh.test/api/helper/leases/lease_1/revoke');
    expect(captured.calls[0].init.method).toBe('POST');
  });
});
