/**
 * Tests for the per-terminal model flag (JWPK msg_fespxsi2lu antV4
 * 2026-05-28): setTerminalModel + listTerminalModelsByIds + the
 * trim/empty/null normalisation rules.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import {
  listTerminalModelsByIds,
  setTerminalModel,
  upsertTerminal
} from './terminalsStore';
import { resetIdentityDbForTests } from './db';

describe('per-terminal model flag', () => {
  beforeEach(() => {
    resetIdentityDbForTests();
  });

  it('defaults to null when never set', () => {
    const t = upsertTerminal({
      pid: 901_001,
      pid_start: 'model-test-1',
      name: 'model-test-1',
      ttlSeconds: 60 * 60
    });
    const models = listTerminalModelsByIds([t.id]);
    expect(models.get(t.id)).toBeNull();
  });

  it('setTerminalModel persists a trimmed non-empty string', () => {
    const t = upsertTerminal({
      pid: 901_002,
      pid_start: 'model-test-2',
      name: 'model-test-2',
      ttlSeconds: 60 * 60
    });
    expect(setTerminalModel(t.id, '  kimi-k2  ')).toBe(true);
    const models = listTerminalModelsByIds([t.id]);
    expect(models.get(t.id)).toBe('kimi-k2');
  });

  it('setTerminalModel with null clears the flag', () => {
    const t = upsertTerminal({
      pid: 901_003,
      pid_start: 'model-test-3',
      name: 'model-test-3',
      ttlSeconds: 60 * 60
    });
    setTerminalModel(t.id, 'codex');
    setTerminalModel(t.id, null);
    expect(listTerminalModelsByIds([t.id]).get(t.id)).toBeNull();
  });

  it('setTerminalModel with empty string normalises to null', () => {
    const t = upsertTerminal({
      pid: 901_004,
      pid_start: 'model-test-4',
      name: 'model-test-4',
      ttlSeconds: 60 * 60
    });
    setTerminalModel(t.id, 'kimi');
    setTerminalModel(t.id, '');
    expect(listTerminalModelsByIds([t.id]).get(t.id)).toBeNull();
  });

  it('setTerminalModel returns false for a missing terminalId', () => {
    expect(setTerminalModel('does-not-exist', 'kimi')).toBe(false);
  });

  it('listTerminalModelsByIds batches multiple lookups', () => {
    const a = upsertTerminal({
      pid: 901_005,
      pid_start: 'model-test-a',
      name: 'model-test-a',
      ttlSeconds: 60 * 60
    });
    const b = upsertTerminal({
      pid: 901_006,
      pid_start: 'model-test-b',
      name: 'model-test-b',
      ttlSeconds: 60 * 60
    });
    setTerminalModel(a.id, 'kimi');
    setTerminalModel(b.id, 'codex');
    const models = listTerminalModelsByIds([a.id, b.id]);
    expect(models.get(a.id)).toBe('kimi');
    expect(models.get(b.id)).toBe('codex');
  });

  it('listTerminalModelsByIds returns an empty Map for an empty input', () => {
    expect(listTerminalModelsByIds([]).size).toBe(0);
  });
});
