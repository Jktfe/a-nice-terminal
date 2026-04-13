// Safe subprocess utility — wraps execFile with array args (no shell injection)
// and returns a structured result instead of throwing.

import { execFile as _execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(_execFile);

export interface ExecResult {
  stdout: string;
  stderr: string;
  status: 'ok' | 'error';
  code: number | null;
}

/**
 * Run a command with array arguments (no shell — prevents injection).
 * Never throws; returns { status: 'error' } on failure.
 */
export async function execFileNoThrow(
  cmd: string,
  args: string[],
  options?: { timeout?: number; cwd?: string }
): Promise<ExecResult> {
  try {
    const { stdout, stderr } = await execFileAsync(cmd, args, {
      timeout:   options?.timeout ?? 10_000,
      cwd:       options?.cwd,
      encoding: 'utf8',
    });
    return { stdout: stdout ?? '', stderr: stderr ?? '', status: 'ok', code: 0 };
  } catch (err: any) {
    return {
      stdout: err.stdout ?? '',
      stderr: err.stderr ?? err.message ?? '',
      status: 'error',
      code:   err.code ?? null,
    };
  }
}
