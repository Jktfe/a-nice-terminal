import { describe, expect, it, vi } from 'vitest';
import { execFileSync } from 'node:child_process';
import { pidStart, parentPid, processName, processIdentityChain } from './ant-cli-identity-chain.mjs';

vi.mock('node:child_process', () => ({
  execFileSync: vi.fn()
}));

describe('pidStart', () => {
  it('returns ISO 8601 form of trimmed lstart string', () => {
    // 2026-05-29 normalisation: pidStart now returns ISO so server-side
    // exact-string-equality works across locales / OSes / shells.
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('Mon Jan 1 00:00:00 2024\n'));
    const out = pidStart(123);
    expect(out).not.toBeNull();
    expect(out).toMatch(/^2024-01-01T/);
    expect(out.endsWith('Z')).toBe(true);
  });

  it('returns the SAME ISO output for day-month vs month-day locale strings', () => {
    // Regression for the 2026-05-29 4-hour silence forensic across 19 agents.
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from('Fri 29 May 11:11:24 2026\n'));
    const a = pidStart(123);
    vi.mocked(execFileSync).mockReturnValueOnce(Buffer.from('Thu May 29 11:11:24 2026\n'));
    const b = pidStart(123);
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(a).toBe(b);
  });

  it('returns null on error', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(pidStart(999)).toBeNull();
  });

  it('returns null on unparseable garbage (no throw)', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('not a date\n'));
    expect(pidStart(123)).toBeNull();
  });
});

describe('processName', () => {
  it('returns trimmed comm name from ps -o comm=', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from('claude\n'));
    expect(processName(123)).toBe('claude');
  });

  it('returns null on empty stdout', () => {
    vi.mocked(execFileSync).mockReturnValue(Buffer.from(''));
    expect(processName(123)).toBeNull();
  });

  it('returns null on error', () => {
    vi.mocked(execFileSync).mockImplementation(() => { throw new Error('ENOENT'); });
    expect(processName(999)).toBeNull();
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
    // 2026-05-29 normalisation: pid_start is now ISO 8601 so we feed
    // parseable lstart strings; the chain assertion checks the ISO output.
    const startMap = { 100: 'Fri 29 May 11:11:24 2026', 2: 'Fri 29 May 11:11:20 2026' };
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const pid = args[3];
      if (args[1] === 'ppid=') return Buffer.from(`${ppidMap[pid] ?? 1}\n`);
      return Buffer.from(`${startMap[pid] ?? 'Fri 29 May 11:11:00 2026'}\n`);
    });
    const chain = processIdentityChain(100, 10);
    expect(chain.length).toBe(2);
    expect(chain[0].pid).toBe(100);
    expect(chain[0].pid_start).toMatch(/^2026-05-29T/);
    expect(chain[0].pid_start.endsWith('Z')).toBe(true);
    expect(chain[1].pid).toBe(2);
    expect(chain[1].pid_start).toMatch(/^2026-05-29T/);
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

  it('includes process name on every chain entry (v0.1.15)', () => {
    const ppidMap = { 100: 200, 200: 1 };
    const nameMap = { 100: 'bash', 200: 'claude' };
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      const pid = args[3];
      if (args[1] === 'ppid=') return Buffer.from(`${ppidMap[pid] ?? 1}\n`);
      if (args[1] === 'comm=') return Buffer.from(`${nameMap[pid] ?? ''}\n`);
      return Buffer.from('Fri 29 May 11:11:00 2026\n');
    });
    const chain = processIdentityChain(100, 10);
    expect(chain.length).toBe(2);
    expect(chain[0].name).toBe('bash');
    expect(chain[1].name).toBe('claude');
  });

  it('chain entry name is null when comm read fails', () => {
    vi.mocked(execFileSync).mockImplementation((_cmd, args) => {
      if (args[1] === 'ppid=') return Buffer.from('1\n');
      if (args[1] === 'comm=') return Buffer.from('');
      return Buffer.from('Fri 29 May 11:11:00 2026\n');
    });
    const chain = processIdentityChain(100);
    expect(chain[0].name).toBeNull();
  });
});
