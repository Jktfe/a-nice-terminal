import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { resetIdentityDbForTests } from './db';
import { createTerminalRecord } from './terminalRecordsStore';
import { upsertTerminal, updatePaneTarget } from './terminalsStore';
import { antRegistryFilePath, buildAntRegistryMarkdown, projectAntRegistryFile } from './antRegistryFile';
import {
  createChatRoom,
  inviteAgentToRoom,
  resetChatRoomStoreForTests
} from './chatRoomStore';
import { addMembership } from './roomMembershipsStore';
import {
  setRoomAlias,
  resetChatRoomAliasStoreForTests
} from './chatRoomAliasStore';

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

  it('PID-as-identity slice 5: room-alias section maps alias → handle → PID → tmux pane', () => {
    resetChatRoomStoreForTests();
    resetChatRoomAliasStoreForTests();
    const room = createChatRoom({ name: 'registry-aliases-room', whoCreatedIt: '@you' });
    inviteAgentToRoom({ roomId: room.id, agentHandle: '@evolveantcodex' });

    const codexTerminal = upsertTerminal({
      pid: 47238,
      pid_start: 'p47238',
      name: 'registry-codex-term'
    });
    updatePaneTarget(codexTerminal.id, 'antv4:codex.0', 'codex_cli');
    addMembership({
      room_id: room.id,
      handle: '@evolveantcodex',
      terminal_id: codexTerminal.id
    });

    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@cdx' });
    setRoomAlias({ roomId: room.id, globalHandle: '@evolveantcodex', newAlias: '@codex-shouting' });

    const markdown = buildAntRegistryMarkdown(1779000000000);
    expect(markdown).toContain('## Room aliases');
    expect(markdown).toContain('registry-aliases-room');
    expect(markdown).toContain('@cdx');
    expect(markdown).toContain('@codex-shouting');
    expect(markdown).toContain('@evolveantcodex');
    expect(markdown).toContain('PID 47238');
    expect(markdown).toContain('tmux antv4');
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
