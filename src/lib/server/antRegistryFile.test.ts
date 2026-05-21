import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createTerminalRecord } from './terminalRecordsStore';
import { upsertTerminal } from './terminalsStore';
import { antRegistryFilePath, buildAntRegistryMarkdown, projectAntRegistryFile } from './antRegistryFile';

let tmpDir: string;
const previousDb = process.env.ANT_FRESH_DB_PATH;
const previousPath = process.env.ANT_REGISTRY_FILE_PATH;

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-registry-file-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_REGISTRY_FILE_PATH = join(tmpDir, 'registry.md');
  resetIdentityDbForTests();
});

afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.ANT_FRESH_DB_PATH;
  else process.env.ANT_FRESH_DB_PATH = previousDb;
  if (previousPath === undefined) delete process.env.ANT_REGISTRY_FILE_PATH;
  else process.env.ANT_REGISTRY_FILE_PATH = previousPath;
});

describe('ANT registry file projection', () => {
  it('uses the configured path when provided', () => {
    expect(antRegistryFilePath()).toBe(join(tmpDir, 'registry.md'));
  });

  it('renders terminal_records and terminal pid data as a markdown mirror', () => {
    createTerminalRecord({
      sessionId: 't_codex',
      name: 'Codex',
      agentKind: 'codex',
      handle: '@evolveantcodex',
      tmuxTargetPane: 'codex-pane:0.0'
    });
    upsertTerminal({ pid: 12345, pid_start: 'start', name: 'Codex' });
    const markdown = buildAntRegistryMarkdown(1779000000000);
    expect(markdown).toContain('# ANT Agent Registry');
    expect(markdown).toContain('@evolveantcodex');
    expect(markdown).toContain('codex');
    expect(markdown).toContain('codex-pane');
  });

  it('writes a recoverable markdown registry file', () => {
    createTerminalRecord({ sessionId: 't_svelte', name: 'Svelte', agentKind: 'svelte', handle: '@evolveantsvelte' });
    const result = projectAntRegistryFile({ force: true });
    expect(result.skipped).toBe(false);
    expect(result.rows).toBeGreaterThanOrEqual(1);
    const content = readFileSync(result.path, 'utf8');
    expect(content).toContain('@evolveantsvelte');
    expect(content).toContain('ANT database state is canonical');
  });
});
