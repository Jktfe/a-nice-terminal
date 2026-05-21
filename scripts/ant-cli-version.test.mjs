import { describe, expect, it } from 'vitest';
import { makeCliRunner } from './ant-cli.mjs';
import { resolveCliVersion } from './ant-cli-version-helper.mjs';

function makeRuntime() {
  const captured = { stdout: [], stderr: [] };
  return {
    runner: makeCliRunner({
      fetchImpl: async () => { throw new Error('fetch should not be called for --version'); },
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    }),
    captured
  };
}

describe('ant --version (m6.1 T1)', () => {
  it('resolveCliVersion reads package.json + returns a non-empty string', () => {
    const v = resolveCliVersion();
    expect(typeof v).toBe('string');
    expect(v.length).toBeGreaterThan(0);
    // Should look like a semver, "0.0.0-unknown", or similar; never empty/null.
    expect(v).toMatch(/[0-9]/);
  });

  it('ant --version prints `ant <version>` to stdout and exits 0', async () => {
    const { runner, captured } = makeRuntime();
    const code = await runner.run(['--version']);
    expect(code).toBe(0);
    expect(captured.stdout).toHaveLength(1);
    expect(captured.stdout[0]).toMatch(/^ant /);
    expect(captured.stderr).toHaveLength(0);
  });

  it('ant version (bare verb) is equivalent to --version', async () => {
    const { runner, captured } = makeRuntime();
    const code = await runner.run(['version']);
    expect(code).toBe(0);
    expect(captured.stdout[0]).toMatch(/^ant /);
  });

  it('--version does not trigger fetch (no network in brew test sandbox)', async () => {
    // makeRuntime supplies a fetchImpl that throws if called — covered by
    // the absence-of-throw in the previous tests, plus this explicit assertion.
    const { runner, captured } = makeRuntime();
    await expect(runner.run(['--version'])).resolves.toBe(0);
    expect(captured.stdout).toHaveLength(1);
  });
});
