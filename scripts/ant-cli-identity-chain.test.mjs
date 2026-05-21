import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { pidStart, parentPid, processIdentityChain } from './ant-cli-identity-chain.mjs';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}));

describe('pidStart', () => {
  it('returns trimmed lstart string', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('Mon Jan 1 00:00:00 2024\n'));
    expect(pidStart(123)).toBe('Mon Jan 1 00:00:00 2024');
  });

  it('returns null on error', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(pidStart(999)).toBeNull();
  });
});

describe('parentPid', () => {
  it('returns numeric parent pid', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('42\n'));
    expect(parentPid(123)).toBe(42);
  });

  it('returns null for non-numeric ppid', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('?\n'));
    expect(parentPid(123)).toBeNull();
  });

  it('returns null on error', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(parentPid(999)).toBeNull();
  });
});

describe('processIdentityChain', () => {
  it('walks chain to root', () => {
    const ppidMap = { 100: 2, 2: 1 };
    const startMap = { 100: 'ts-a', 2: 'ts-b' };
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const pid = args[3];
      if (args[1] === 'ppid=') return Buffer.from(`${ppidMap[pid] ?? 1}\n`);
      return Buffer.from(`${startMap[pid] ?? 'ts'}\n`);
    });
    const chain = processIdentityChain(100, 10);
    expect(chain.length).toBe(2);
    expect(chain[0]).toEqual({ pid: 100, pid_start: 'ts-a' });
    expect(chain[1]).toEqual({ pid: 2, pid_start: 'ts-b' });
  });

  it('stops at pid 1', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (args[1] === 'ppid=') return Buffer.from('1\n');
      return Buffer.from('ts\n');
    });
    const chain = processIdentityChain(50);
    expect(chain.length).toBe(1);
    expect(chain[0].pid).toBe(50);
  });

  it('stops on loop', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (args[1] === 'ppid=') return Buffer.from('100\n');
      return Buffer.from('ts\n');
    });
    const chain = processIdentityChain(100, 10);
    expect(chain.length).toBe(1);
  });

  it('respects maxDepth by capping chain length', () => {
    const ppidMap = { 100: 200, 200: 300, 300: 400 };
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const pid = args[3];
      if (args[1] === 'ppid=') return Buffer.from(`${ppidMap[pid] ?? 1}\n`);
      return Buffer.from('ts\n');
    });
    const chain = processIdentityChain(100, 2);
    expect(chain.length).toBe(2);
    expect(chain[0].pid).toBe(100);
    expect(chain[1].pid).toBe(200);
  });

  it('defaults startPid to process.pid', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (args[1] === 'ppid=') return Buffer.from('1\n');
      return Buffer.from('ts\n');
    });
    const chain = processIdentityChain(undefined);
    expect(chain[0].pid).toBe(process.pid);
  });
});
