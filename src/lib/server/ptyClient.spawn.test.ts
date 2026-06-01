import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

describe('spawnTerminal existing-session output capture', () => {
  const originalHome = process.env.HOME;

  afterEach(() => {
    vi.resetModules();
    vi.doUnmock('node:child_process');
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
  });

  it('re-arms tmux pipe-pane when attaching to an existing session', async () => {
    const tmpHome = mkdtempSync(join(tmpdir(), 'ant-pty-existing-'));
    process.env.HOME = tmpHome;
    const tmuxArgs: string[][] = [];

    vi.doMock('node:child_process', () => ({
      execFile: vi.fn((_cmd: string, args: string[], ...rest: unknown[]) => {
        tmuxArgs.push(args);
        const callback = rest.find((value) => typeof value === 'function') as
          | ((error: Error | null, stdout: string, stderr: string) => void)
          | undefined;
        callback?.(null, '', '');
      })
    }));

    const { spawnTerminal } = await import('./ptyClient');

    const result = await spawnTerminal('t_existing');

    expect(result.alive).toBe(true);
    expect(tmuxArgs).toContainEqual(['has-session', '-t', 't_existing']);
    expect(
      tmuxArgs.some((args) =>
        args[0] === 'pipe-pane' &&
        args.includes('-o') &&
        args.includes('-t') &&
        args.includes('t_existing:0.0') &&
        args.some((arg) => arg.includes('/.ant/pty/t_existing.out'))
      )
    ).toBe(true);

    rmSync(tmpHome, { recursive: true, force: true });
  });
});
