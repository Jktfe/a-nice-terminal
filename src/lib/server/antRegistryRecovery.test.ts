import { beforeEach, afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { upsertTerminal, setTerminalStatus } from './terminalsStore';
import { buildAntRegistryMarkdown, projectAntRegistryFile } from './antRegistryFile';
import { resetIdentityDbForTests } from './db';

let tmpDir: string;
beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'ant-recovery-'));
  process.env.ANT_FRESH_DB_PATH = join(tmpDir, 'test.db');
  process.env.ANT_MEMORY_VAULT_PATH = join(tmpDir, 'vault');
  process.env.ANT_REGISTRY_FILE_PATH = join(tmpDir, 'ant-registry.md');
  resetIdentityDbForTests();
});
afterEach(() => {
  resetIdentityDbForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  delete process.env.ANT_REGISTRY_FILE_PATH;
  delete process.env.ANT_MEMORY_VAULT_PATH;
  delete process.env.ANT_FRESH_DB_PATH;
});

describe('recovery section', () => {
  it('lists archived terminals with base name and a --revive command', () => {
    const a = upsertTerminal({ pid: 840001, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    const md = buildAntRegistryMarkdown();
    expect(md).toContain('## Recoverable archived terminals');
    expect(md).toContain('[A] terminal3');
    expect(md).toContain(`ant register --name terminal3 --revive ${a.id}`);
  });

  it('writes the projection to both the default path and the vault path', () => {
    const a = upsertTerminal({ pid: 840101, pid_start: 'a', name: 'terminal3' });
    setTerminalStatus(a.id, 'archived');
    projectAntRegistryFile({ force: true });
    expect(existsSync(process.env.ANT_REGISTRY_FILE_PATH!)).toBe(true);
    const vaultFile = join(process.env.ANT_MEMORY_VAULT_PATH!, 'ant-registry.md');
    expect(existsSync(vaultFile)).toBe(true);
    expect(readFileSync(vaultFile, 'utf8')).toContain('[A] terminal3');
  });
});
