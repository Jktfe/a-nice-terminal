import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { bindHandle } from './handleBindingsStore';
import { listLedger } from './identityLedgerStore';
import { resolveCallerIdentity, readIdentityReadMode } from './callerIdentityResolver';

let tmpDir: string;
const prevDb = process.env.ANT_FRESH_DB_PATH;
const prevMode = process.env.ANT_IDENTITY_READ;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-caller-resolver-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  delete process.env.ANT_IDENTITY_READ;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (prevDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = prevDb;
  if (prevMode === undefined) delete process.env.ANT_IDENTITY_READ;
  else process.env.ANT_IDENTITY_READ = prevMode;
});

describe('readIdentityReadMode', () => {
  it('defaults to legacy; honours shadow/clean; falls back to legacy on junk', () => {
    expect(readIdentityReadMode()).toBe('legacy');
    process.env.ANT_IDENTITY_READ = 'shadow';
    expect(readIdentityReadMode()).toBe('shadow');
    process.env.ANT_IDENTITY_READ = 'clean';
    expect(readIdentityReadMode()).toBe('clean');
    process.env.ANT_IDENTITY_READ = 'yolo';
    expect(readIdentityReadMode()).toBe('legacy');
  });
});

describe('resolveCallerIdentity — LEGACY (default)', () => {
  it('returns the legacy answer untouched and writes nothing to the ledger', () => {
    const result = resolveCallerIdentity({
      pane: '%9',
      legacy: () => ({ handle: '@dave', terminalId: 't_1' })
    });
    expect(result).toEqual({
      ok: true,
      identity: { handle: '@dave', terminalId: 't_1', source: 'legacy' }
    });
    expect(listLedger({})).toHaveLength(0);
  });

  it('legacy null → unresolved', () => {
    const result = resolveCallerIdentity({ pane: '%9', legacy: () => null });
    expect(result).toEqual({ ok: false, reason: 'identity_unresolved' });
  });
});

describe('resolveCallerIdentity — CLEAN', () => {
  beforeEach(() => { process.env.ANT_IDENTITY_READ = 'clean'; });

  it('answers ONLY from the witnessed binding for the pane — legacy is never consulted', () => {
    bindHandle({ handle: '@dave', pane: '%9', pid: 1, pidStart: null, terminalId: 't_w' });
    let legacyCalls = 0;
    const result = resolveCallerIdentity({
      pane: '%9',
      legacy: () => { legacyCalls += 1; return { handle: '@impostor', terminalId: 't_x' }; }
    });
    expect(result).toEqual({
      ok: true,
      identity: { handle: '@dave', terminalId: 't_w', source: 'witness' }
    });
    expect(legacyCalls).toBe(0);
  });

  it('no witnessed binding → identity_unresolved, regardless of what legacy would say', () => {
    const result = resolveCallerIdentity({
      pane: '%9',
      legacy: () => ({ handle: '@dave', terminalId: 't_1' })
    });
    expect(result).toEqual({ ok: false, reason: 'identity_unresolved' });
  });

  it('no pane presented → identity_unresolved (nothing witnessed)', () => {
    const result = resolveCallerIdentity({
      pane: null,
      legacy: () => ({ handle: '@dave', terminalId: 't_1' })
    });
    expect(result).toEqual({ ok: false, reason: 'identity_unresolved' });
  });
});

describe('resolveCallerIdentity — SHADOW (the proving mode)', () => {
  beforeEach(() => { process.env.ANT_IDENTITY_READ = 'shadow'; });

  it('answers legacy, and when witness agrees writes NO ledger row', () => {
    bindHandle({ handle: '@dave', pane: '%9', pid: 1, pidStart: null });
    const result = resolveCallerIdentity({
      pane: '%9',
      legacy: () => ({ handle: '@dave', terminalId: 't_1' })
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.identity.source).toBe('legacy');
    expect(listLedger({}).filter((e) => e.kind === 'resolver.disagreement')).toHaveLength(0);
  });

  it('ledgers a disagreement when legacy and witness answer differently', () => {
    bindHandle({ handle: '@dave', pane: '%9', pid: 1, pidStart: null });
    const result = resolveCallerIdentity({
      pane: '%9',
      legacy: () => ({ handle: '@mallory', terminalId: 't_1' })
    });
    expect(result.ok).toBe(true); // shadow never changes behaviour
    const rows = listLedger({}).filter((e) => e.kind === 'resolver.disagreement');
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({
      pane: '%9',
      legacy_handle: '@mallory',
      witness_handle: '@dave'
    });
  });

  it('ledgers when legacy answers but nothing is witnessed (the token-crutch signature)', () => {
    const result = resolveCallerIdentity({
      pane: '%9',
      legacy: () => ({ handle: '@dave', terminalId: 't_1' })
    });
    expect(result.ok).toBe(true);
    const rows = listLedger({}).filter((e) => e.kind === 'resolver.disagreement');
    expect(rows).toHaveLength(1);
    expect(rows[0].detail).toMatchObject({ legacy_handle: '@dave', witness_handle: null });
  });
});
