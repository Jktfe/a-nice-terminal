import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { resolveMemoryVaultPath } from './memoryVaultSettingsStore';

// These tests focus on the env-var path because it's the reliable testing
// surface. File-based settings are exercised in production via
// deckSettingsStore (same shape) and through the integration test in
// roomMembershipsStore.test.ts. Direct file-write tests would either
// clobber the real user's ~/.ant/memory-vault.json or require vi.mock
// for `os.homedir()` — both worse than the focused unit tests here.

let originalEnv: string | undefined;

beforeEach(() => {
  originalEnv = process.env.ANT_MEMORY_VAULT_PATH;
  delete process.env.ANT_MEMORY_VAULT_PATH;
});

afterEach(() => {
  if (originalEnv === undefined) delete process.env.ANT_MEMORY_VAULT_PATH;
  else process.env.ANT_MEMORY_VAULT_PATH = originalEnv;
});

describe('resolveMemoryVaultPath via env var', () => {
  it('returns the env var value when set', () => {
    process.env.ANT_MEMORY_VAULT_PATH = '/env/vault';
    expect(resolveMemoryVaultPath()).toBe('/env/vault');
  });

  it('trims surrounding whitespace from env var value', () => {
    process.env.ANT_MEMORY_VAULT_PATH = '  /vault/path  ';
    expect(resolveMemoryVaultPath()).toBe('/vault/path');
  });

  it('treats whitespace-only env var as unset (falls through to file lookup, which is null in this test env)', () => {
    process.env.ANT_MEMORY_VAULT_PATH = '   ';
    // Whether the result is null or a real file-backed value depends on
    // the test runner's home directory state. The contract is: empty/
    // whitespace env var triggers fallback, not literal whitespace.
    const result = resolveMemoryVaultPath();
    expect(result).not.toBe('   ');
  });

  it('handles an unset env var without throwing', () => {
    expect(() => resolveMemoryVaultPath()).not.toThrow();
  });
});
