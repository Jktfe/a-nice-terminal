import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { getIdentityDb, resetIdentityDbForTests } from './db';
import {
  getOperatorEmail,
  getPersistedOperatorEmail,
  normalizeOperatorEmailOrThrow,
  setOperatorEmail
} from './operatorEmail';

let tmpDir: string;
const previousDbPath = process.env.ANT_FRESH_DB_PATH;
const previousOperatorEmail = process.env.ANT_OPERATOR_EMAIL;
const previousDemoEmail = process.env.ANT_DEMO_EMAIL;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-operator-email-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  delete process.env.ANT_OPERATOR_EMAIL;
  delete process.env.ANT_DEMO_EMAIL;
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  restoreEnv('ANT_FRESH_DB_PATH', previousDbPath);
  restoreEnv('ANT_OPERATOR_EMAIL', previousOperatorEmail);
  restoreEnv('ANT_DEMO_EMAIL', previousDemoEmail);
});

function restoreEnv(key: string, value: string | undefined): void {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

describe('operatorEmail', () => {
  it('fails closed when neither env nor persisted config exists', () => {
    expect(getOperatorEmail()).toBeNull();
  });

  it('persists the operator email in server_config', () => {
    const saved = setOperatorEmail({
      email: ' Operator@Example.COM ',
      updatedBy: 'test-bootstrap',
      nowMs: 123
    });

    expect(saved).toBe('operator@example.com');
    expect(getPersistedOperatorEmail()).toBe('operator@example.com');
    expect(getOperatorEmail()).toBe('operator@example.com');
    expect(
      getIdentityDb()
        .prepare(`SELECT updated_at_ms, updated_by FROM server_config WHERE key = 'operator_email'`)
        .get()
    ).toEqual({ updated_at_ms: 123, updated_by: 'test-bootstrap' });
  });

  it('lets environment config override persisted bootstrap config for ops', () => {
    setOperatorEmail({ email: 'persisted@example.com' });
    process.env.ANT_OPERATOR_EMAIL = 'env@example.com';

    expect(getOperatorEmail()).toBe('env@example.com');
  });

  it('falls back to the demo email env for current deployments', () => {
    process.env.ANT_DEMO_EMAIL = 'demo@example.com';

    expect(getOperatorEmail()).toBe('demo@example.com');
  });

  it('rejects blank or non-email input before persisting', () => {
    expect(() => normalizeOperatorEmailOrThrow('   ')).toThrow(/operator email/i);
    expect(() => normalizeOperatorEmailOrThrow('not-an-email')).toThrow(/operator email/i);
    expect(() => setOperatorEmail({ email: 'not an email@example.com' })).toThrow(/operator email/i);
    expect(getPersistedOperatorEmail()).toBeNull();
  });
});
