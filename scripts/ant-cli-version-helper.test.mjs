import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';

vi.mock('./ant-cli-version-constant.mjs', () => ({
  ANT_CLI_VERSION_CONSTANT: ''
}));

vi.mock('node:fs', () => ({
  readFileSync: vi.fn()
}));

// Re-import after mocking so the module sees the mocks
const { resolveCliVersion } = await import('./ant-cli-version-helper.mjs');

describe('resolveCliVersion', () => {
  it('falls back to package.json version', () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ version: '1.2.3' }));
    expect(resolveCliVersion()).toBe('1.2.3');
  });

  it('returns 0.0.0-unknown when package.json has no version', () => {
    vi.mocked(readFileSync).mockReturnValue(JSON.stringify({ name: 'test' }));
    expect(resolveCliVersion()).toBe('0.0.0-unknown');
  });

  it('returns 0.0.0-unknown on read error', () => {
    vi.mocked(readFileSync).mockImplementation(() => {
      throw new Error('ENOENT');
    });
    expect(resolveCliVersion()).toBe('0.0.0-unknown');
  });

  it('returns 0.0.0-unknown on parse error', () => {
    vi.mocked(readFileSync).mockReturnValue('not json');
    expect(resolveCliVersion()).toBe('0.0.0-unknown');
  });
});
