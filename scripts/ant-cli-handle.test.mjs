import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, readFileSync, statSync, mkdirSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { handleHandleVerb } from './ant-cli-handle.mjs';

class CliInputError extends Error {}

let homeDir;

function runtime() {
  const captured = { stdout: [], stderr: [] };
  return {
    runtime: {
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line),
      env: { HOME: homeDir }
    },
    captured
  };
}

function seedWorkspace(accountId, deviceId) {
  const root = join(homeDir, '.ant');
  mkdirSync(join(root, 'account', accountId, 'devices', deviceId), { recursive: true });
  writeFileSync(
    join(root, 'active-workspace.json'),
    JSON.stringify({ activeAccountId: accountId })
  );
  writeFileSync(
    join(root, 'account', accountId, 'devices', deviceId, 'device-token.json'),
    JSON.stringify({ sub: 'user_1', device_id: deviceId, org_id: 'org_1', type: 'refresh' })
  );
}

function bindingsFilePath(accountId, deviceId) {
  return join(homeDir, '.ant', 'account', accountId, 'devices', deviceId, 'bindings.json');
}

beforeEach(() => {
  homeDir = mkdtempSync(join(tmpdir(), 'ant-handle-'));
});

afterEach(() => {
  rmSync(homeDir, { recursive: true, force: true });
});

describe('ant handle', () => {
  it('bind writes the canonical schema and chmods 600', async () => {
    seedWorkspace('acct_a', 'dev_a');
    const { runtime: r, captured } = runtime();
    await handleHandleVerb('bind', ['--handle', '@codex', '--target', 'tmux:t_abc'], r, { CliInputError });

    const filePath = bindingsFilePath('acct_a', 'dev_a');
    const parsed = JSON.parse(readFileSync(filePath, 'utf8'));
    expect(parsed.accountId).toBe('acct_a');
    expect(parsed.deviceId).toBe('dev_a');
    expect(parsed.bindings).toEqual([{ handle: '@codex', target: 'tmux:t_abc' }]);
    expect(typeof parsed.updatedAtMs).toBe('number');
    expect(parsed.updatedAtMs).toBeGreaterThan(0);

    // chmod 600 — owner rw only.
    expect(statSync(filePath).mode & 0o777).toBe(0o600);
    expect(captured.stdout.join('\n')).toContain('bound @codex → tmux:t_abc');
  });

  it('bind replaces an existing handle entry rather than duplicating', async () => {
    seedWorkspace('acct_a', 'dev_a');
    const { runtime: r } = runtime();
    await handleHandleVerb('bind', ['--handle', '@codex', '--target', 'mcp'], r, { CliInputError });
    await handleHandleVerb('bind', ['--handle', '@codex', '--target', 'tmux:t_new'], r, { CliInputError });
    const parsed = JSON.parse(readFileSync(bindingsFilePath('acct_a', 'dev_a'), 'utf8'));
    expect(parsed.bindings).toEqual([{ handle: '@codex', target: 'tmux:t_new' }]);
  });

  it('list returns bindings as text and as JSON', async () => {
    seedWorkspace('acct_a', 'dev_a');
    const { runtime: r } = runtime();
    await handleHandleVerb('bind', ['--handle', '@codex', '--target', 'mcp'], r, { CliInputError });
    await handleHandleVerb('bind', ['--handle', '@alpha', '--target', 'tmux:t_x'], r, { CliInputError });

    const text = runtime();
    await handleHandleVerb('list', [], text.runtime, { CliInputError });
    // sorted by handle, so @alpha first.
    expect(text.captured.stdout).toEqual(['@alpha\ttmux:t_x', '@codex\tmcp']);

    const jsonOut = runtime();
    await handleHandleVerb('list', ['--json'], jsonOut.runtime, { CliInputError });
    const payload = JSON.parse(jsonOut.captured.stdout[0]);
    expect(payload.bindings.length).toBe(2);
    expect(payload.deviceId).toBe('dev_a');
  });

  it('remove drops the requested handle and is idempotent', async () => {
    seedWorkspace('acct_a', 'dev_a');
    const { runtime: r } = runtime();
    await handleHandleVerb('bind', ['--handle', '@codex', '--target', 'mcp'], r, { CliInputError });

    const first = runtime();
    await handleHandleVerb('remove', ['--handle', '@codex'], first.runtime, { CliInputError });
    expect(first.captured.stdout[0]).toBe('removed @codex');

    const second = runtime();
    await handleHandleVerb('remove', ['--handle', '@codex'], second.runtime, { CliInputError });
    expect(second.captured.stdout[0]).toBe('@codex was not bound');
  });

  it('throws when there is no active workspace (Lane A pre-S3 stub path)', async () => {
    const { runtime: r } = runtime();
    await expect(
      handleHandleVerb('bind', ['--handle', '@codex', '--target', 'mcp'], r, { CliInputError })
    ).rejects.toThrow(/no active workspace/);
  });

  it('throws when --account is supplied but no device-token exists for it', async () => {
    seedWorkspace('acct_a', 'dev_a');
    // Account exists in active-workspace.json but a different account is asked
    // for; resolver must not silently fall back to the active one.
    const { runtime: r } = runtime();
    await expect(
      handleHandleVerb('bind', ['--handle', '@codex', '--target', 'mcp', '--account', 'acct_other'], r, { CliInputError })
    ).rejects.toThrow(/no device-token for account acct_other/);
  });

  it('rejects malformed --target', async () => {
    seedWorkspace('acct_a', 'dev_a');
    const { runtime: r } = runtime();
    await expect(
      handleHandleVerb('bind', ['--handle', '@codex', '--target', 'pigeon'], r, { CliInputError })
    ).rejects.toThrow(/--target must be/);
    expect(existsSync(bindingsFilePath('acct_a', 'dev_a'))).toBe(false);
  });

  it('rejects --handle that does not start with @', async () => {
    seedWorkspace('acct_a', 'dev_a');
    const { runtime: r } = runtime();
    await expect(
      handleHandleVerb('bind', ['--handle', 'codex', '--target', 'mcp'], r, { CliInputError })
    ).rejects.toThrow(/--handle must be a @name/);
  });
});
