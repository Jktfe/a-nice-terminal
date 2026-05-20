/**
 * ant hooks CLI tests — CLI-HOOK-BRIDGE Phase 1B (2026-05-15).
 *
 * Verifies install/uninstall/status against a settings.json in a tmpdir,
 * isolated via ANT_HOOKS_SETTINGS_PATH env override. No filesystem
 * pollution of ~/.claude/settings.json from tests.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { handleHooksVerb } from './ant-cli-hooks.mjs';

class CliInputError extends Error {}

let tmpDir;
let settingsPath;
const previousSettingsEnv = process.env.ANT_HOOKS_SETTINGS_PATH;
const previousReceiverEnv = process.env.ANT_HOOKS_RECEIVER_URL;
const previousServerEnv = process.env.ANT_SERVER_URL;

function makeRuntime() {
  const captured = { stdout: [], stderr: [] };
  return {
    runtime: {
      fetchImpl: async () => { throw new Error('hooks verb should not call fetch'); },
      serverUrl: 'http://test.local',
      writeOut: (line) => captured.stdout.push(line),
      writeErr: (line) => captured.stderr.push(line)
    },
    captured
  };
}

function readSettings() {
  return JSON.parse(readFileSync(settingsPath, 'utf8'));
}

describe('ant hooks CLI', () => {
  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ant-hooks-cli-'));
    settingsPath = join(tmpDir, 'settings.json');
    process.env.ANT_HOOKS_SETTINGS_PATH = settingsPath;
    process.env.ANT_HOOKS_RECEIVER_URL = 'http://localhost:6174/api/cli-hook';
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
    if (previousSettingsEnv === undefined) delete process.env.ANT_HOOKS_SETTINGS_PATH;
    else process.env.ANT_HOOKS_SETTINGS_PATH = previousSettingsEnv;
    if (previousReceiverEnv === undefined) delete process.env.ANT_HOOKS_RECEIVER_URL;
    else process.env.ANT_HOOKS_RECEIVER_URL = previousReceiverEnv;
    if (previousServerEnv === undefined) delete process.env.ANT_SERVER_URL;
    else process.env.ANT_SERVER_URL = previousServerEnv;
  });

  it('install creates settings.json if missing and wires 8 default events', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleHooksVerb('install', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(existsSync(settingsPath)).toBe(true);
    const settings = readSettings();
    const events = Object.keys(settings.hooks);
    expect(events.sort()).toEqual(
      ['PostCompact', 'PostToolUse', 'PreCompact', 'PreToolUse', 'SessionEnd', 'SessionStart', 'Stop', 'UserPromptSubmit'].sort()
    );
    expect(captured.stdout.some((l) => l.includes('Added hooks for'))).toBe(true);
  });

  it('install is idempotent — second run adds nothing', async () => {
    const { runtime } = makeRuntime();
    await handleHooksVerb('install', [], runtime, { CliInputError });
    const r2 = makeRuntime();
    const code = await handleHooksVerb('install', [], r2.runtime, { CliInputError });
    expect(code).toBe(0);
    expect(r2.captured.stdout.some((l) => l.includes('No new hooks added') || l.includes('already installed'))).toBe(true);
    const settings = readSettings();
    // Still exactly one matcher block per event with one hook in it.
    for (const eventName of Object.keys(settings.hooks)) {
      const totalHooks = settings.hooks[eventName]
        .flatMap((mb) => mb.hooks ?? []);
      expect(totalHooks).toHaveLength(1);
    }
  });

  it('install preserves a user-defined hook that is not ours', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          PreToolUse: [{
            matcher: 'Bash',
            hooks: [{ type: 'command', command: 'echo "user hook"', timeout: 1000 }]
          }]
        }
      })
    );
    const { runtime } = makeRuntime();
    await handleHooksVerb('install', [], runtime, { CliInputError });
    const settings = readSettings();
    const preToolUseMatchers = settings.hooks.PreToolUse;
    // User's specific matcher block is intact:
    const userBlock = preToolUseMatchers.find((mb) => mb.matcher === 'Bash');
    expect(userBlock).toBeDefined();
    expect(userBlock.hooks[0].command).toBe('echo "user hook"');
    // Our catch-all matcher block was added alongside:
    const ourBlock = preToolUseMatchers.find((mb) => mb.matcher === undefined);
    expect(ourBlock).toBeDefined();
    expect(ourBlock.hooks.some((h) => h.command.includes('/api/cli-hook'))).toBe(true);
  });

  it('install respects --events flag to override the default 8', async () => {
    const { runtime } = makeRuntime();
    await handleHooksVerb('install', ['--events', 'SessionStart,Stop'], runtime, { CliInputError });
    const settings = readSettings();
    expect(Object.keys(settings.hooks).sort()).toEqual(['SessionStart', 'Stop']);
  });

  it('uninstall removes only our hooks, leaves user hooks intact', async () => {
    const { runtime } = makeRuntime();
    await handleHooksVerb('install', [], runtime, { CliInputError });
    // Add a user hook into the same event:
    const settings = readSettings();
    settings.hooks.PreToolUse.push({
      matcher: 'Edit',
      hooks: [{ type: 'command', command: 'echo "preserve me"' }]
    });
    writeFileSync(settingsPath, JSON.stringify(settings, null, 2));

    const r2 = makeRuntime();
    const code = await handleHooksVerb('uninstall', [], r2.runtime, { CliInputError });
    expect(code).toBe(0);

    const after = readSettings();
    // User's PreToolUse hook survives:
    expect(after.hooks.PreToolUse).toBeDefined();
    expect(after.hooks.PreToolUse).toHaveLength(1);
    expect(after.hooks.PreToolUse[0].hooks[0].command).toBe('echo "preserve me"');
    // All other event entries were ANT-only and got removed:
    expect(after.hooks.SessionStart).toBeUndefined();
    expect(after.hooks.PostCompact).toBeUndefined();
  });

  it('uninstall on a missing settings.json is a no-op', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleHooksVerb('uninstall', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout.some((l) => l.includes('nothing to uninstall'))).toBe(true);
    expect(existsSync(settingsPath)).toBe(false);
  });

  it('status reports installed and missing default events', async () => {
    writeFileSync(
      settingsPath,
      JSON.stringify({
        hooks: {
          SessionStart: [{
            hooks: [{ type: 'command', command: 'curl http://localhost:6174/api/cli-hook -d @-' }]
          }],
          UnrelatedEvent: [{
            hooks: [{ type: 'command', command: 'curl http://elsewhere.example/' }]
          }]
        }
      })
    );
    const { runtime, captured } = makeRuntime();
    await handleHooksVerb('status', ['--json'], runtime, { CliInputError });
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload.installedEvents).toEqual(['SessionStart']);
    expect(payload.missingDefaultEvents).toContain('PreToolUse');
    expect(payload.missingDefaultEvents).toContain('Stop');
  });

  it('status on missing settings.json reports settingsFilePresent=false', async () => {
    const { runtime, captured } = makeRuntime();
    await handleHooksVerb('status', ['--json'], runtime, { CliInputError });
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload.settingsFilePresent).toBe(false);
    expect(payload.installedEvents).toEqual([]);
  });

  it('rejects unknown verb', async () => {
    const { runtime } = makeRuntime();
    await expect(handleHooksVerb('frobnicate', [], runtime, { CliInputError })).rejects.toThrow(/unknown hooks verb/);
  });

  it('help / no-action prints usage', async () => {
    const { runtime, captured } = makeRuntime();
    const code = await handleHooksVerb('help', [], runtime, { CliInputError });
    expect(code).toBe(0);
    expect(captured.stdout.some((l) => l.startsWith('ant hooks'))).toBe(true);
  });

  it('--json install returns a structured result', async () => {
    const { runtime, captured } = makeRuntime();
    await handleHooksVerb('install', ['--json'], runtime, { CliInputError });
    const payload = JSON.parse(captured.stdout[0]);
    expect(payload.added.length).toBe(8);
    expect(payload.receiverUrl).toBe('http://localhost:6174/api/cli-hook');
  });

  it('receiver-url resolves from ANT_SERVER_URL when explicit hook URL is absent', async () => {
    delete process.env.ANT_HOOKS_RECEIVER_URL;
    process.env.ANT_SERVER_URL = 'https://test-host.invalid';
    const { runtime, captured } = makeRuntime();
    await handleHooksVerb('receiver-url', ['--bare'], runtime, { CliInputError });
    expect(captured.stdout[0]).toBe('https://test-host.invalid/api/cli-hook');
  });

  it('installed command resolves receiver dynamically at execution time', async () => {
    const { runtime } = makeRuntime();
    await handleHooksVerb('install', [], runtime, { CliInputError });
    const settings = readSettings();
    const command = settings.hooks.SessionStart[0].hooks[0].command;
    expect(command).toContain('ant hooks receiver-url --bare');
    expect(command).toContain('ANT_SERVER_URL');
  });
});
