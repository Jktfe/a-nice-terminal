// Tests for ant-cli-fingerprint.mjs (M3.2a Q7).
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { handleFingerprintVerb } from './ant-cli-fingerprint.mjs';
class CliInputError extends Error {}
const ctx = { CliInputError };
const PREV = process.env.ANT_ADMIN_TOKEN;
beforeEach(() => { process.env.ANT_ADMIN_TOKEN = 'admin-fp-tok'; });
afterEach(() => {
  if (PREV === undefined) delete process.env.ANT_ADMIN_TOKEN;
  else process.env.ANT_ADMIN_TOKEN = PREV;
});
function jsonRes(payload, status = 200) {
  return { ok: status >= 200 && status < 300, status,
    json: async () => payload, text: async () => JSON.stringify(payload) };
}
function makeRuntime(replies = []) {
  const calls = [], stdout = [], stderr = []; let i = 0;
  return {
    fetchImpl: async (url, init) => { calls.push({ url, init }); return replies[i++] ?? jsonRes({}, 500); },
    writeOut: (l) => stdout.push(l), writeErr: (l) => stderr.push(l),
    serverUrl: 'http://127.0.0.1:6174', stdout, stderr, calls
  };
}

describe('ant fingerprint detect', () => {
  it('GETs /api/terminals/:id/fingerprint without writeBack by default', async () => {
    const payload = { terminal_id: 't1', kind: 'claude_code',
      driver: { binary: 'claude', version: '0.42.1' },
      confidence: 'high', fallback: '', evidence: { source: 'process-tree', detail: 'claude' } };
    const rt = makeRuntime([jsonRes(payload, 200)]);
    expect(await handleFingerprintVerb('detect', ['t1'], rt, ctx)).toBe(0);
    expect(rt.calls[0].url).toBe('http://127.0.0.1:6174/api/terminals/t1/fingerprint');
    expect(rt.calls[0].init.headers.authorization).toBeUndefined();
    expect(rt.stdout.join('\n')).toContain('kind=claude_code');
    expect(rt.stdout.join('\n')).toContain('driver=claude@0.42.1');
  });

  it('--write-back appends ?writeBack=1 + adds admin bearer header', async () => {
    const payload = { terminal_id: 't2', kind: 'codex_cli', driver: null,
      confidence: 'medium', fallback: '', evidence: { source: 'tmux-title', detail: 'Codex' } };
    const rt = makeRuntime([jsonRes(payload, 200)]);
    expect(await handleFingerprintVerb('detect', ['t2', '--write-back'], rt, ctx)).toBe(0);
    expect(rt.calls[0].url).toBe('http://127.0.0.1:6174/api/terminals/t2/fingerprint?writeBack=1');
    expect(rt.calls[0].init.headers.authorization).toBe('Bearer admin-fp-tok');
  });

  it('--json prints raw payload', async () => {
    const payload = { terminal_id: 't3', kind: 'unknown', driver: null,
      confidence: 'low', fallback: '', evidence: { source: 'default', detail: 'no-signal' } };
    const rt = makeRuntime([jsonRes(payload, 200)]);
    await handleFingerprintVerb('detect', ['t3', '--json'], rt, ctx);
    expect(JSON.parse(rt.stdout[0])).toEqual(payload);
  });

  it('missing terminal-id throws CliInputError', async () => {
    const rt = makeRuntime();
    await expect(handleFingerprintVerb('detect', [], rt, ctx)).rejects.toThrow(/needs a TERMINAL_ID/);
  });

  it('--write-back without admin token throws CliInputError', async () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const rt = makeRuntime();
    await expect(handleFingerprintVerb('detect', ['t4', '--write-back'], rt, ctx))
      .rejects.toThrow(/admin token/);
  });

  it('non-2xx response writes error and returns 1', async () => {
    const rt = makeRuntime([jsonRes({ message: 'not found' }, 404)]);
    expect(await handleFingerprintVerb('detect', ['t5'], rt, ctx)).toBe(1);
    expect(rt.stderr.join('\n')).toContain('Request failed (404)');
  });

  it('admin token is scrubbed from error body', async () => {
    const errBody = { message: 'token leak admin-fp-tok' };
    const rt = makeRuntime([jsonRes(errBody, 401)]);
    await handleFingerprintVerb('detect', ['t6', '--write-back'], rt, ctx);
    expect(rt.stderr.join('\n')).not.toContain('admin-fp-tok');
    expect(rt.stderr.join('\n')).toContain('***');
  });

  it('unknown verb writes usage and throws CliInputError', async () => {
    const rt = makeRuntime();
    await expect(handleFingerprintVerb('bogus', [], rt, ctx)).rejects.toThrow(/unknown fingerprint verb/);
  });
});
