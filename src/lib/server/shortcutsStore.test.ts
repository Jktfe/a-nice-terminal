/**
 * Vitest suite for the scope-aware shortcuts store.
 *
 * Covers addShortcut validation across all three scopes, listShortcutsFor
 * filtering, removeShortcut idempotency, and the reset helper.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  addShortcut,
  findShortcutById,
  listShortcutsFor,
  removeShortcut,
  resetShortcutsStoreForTests
} from './shortcutsStore';

describe('shortcutsStore', () => {
  beforeEach(() => {
    resetShortcutsStoreForTests();
  });

  it('adds a terminal-scoped shortcut and round-trips it via findShortcutById', () => {
    const created = addShortcut({
      scope: 'terminal',
      scopeTarget: 't_abc',
      label: 'plan',
      command: '/plan',
      createdBy: '@cli'
    });
    expect(created.id.length).toBeGreaterThan(0);
    expect(created.scope).toBe('terminal');
    expect(created.scopeTarget).toBe('t_abc');
    expect(created.label).toBe('plan');
    expect(created.command).toBe('/plan');
    expect(created.orderIndex).toBe(0);
    expect(created.createdBy).toBe('@cli');
    const looked = findShortcutById(created.id);
    expect(looked).toEqual(created);
  });

  it('adds a chatroom-scoped shortcut and lists it back via listShortcutsFor', () => {
    const a = addShortcut({ scope: 'chatroom', scopeTarget: 'room_x', label: 'a', command: 'go a' });
    const b = addShortcut({ scope: 'chatroom', scopeTarget: 'room_x', label: 'b', command: 'go b' });
    const list = listShortcutsFor('chatroom', 'room_x');
    expect(list.map((row) => row.id)).toEqual([a.id, b.id]);
    expect(list.map((row) => row.orderIndex)).toEqual([0, 1]);
  });

  it('isolates shortcuts by (scope, scope_target) bucket', () => {
    addShortcut({ scope: 'terminal', scopeTarget: 't1', label: 'x', command: 'x' });
    addShortcut({ scope: 'terminal', scopeTarget: 't2', label: 'y', command: 'y' });
    addShortcut({ scope: 'chatroom', scopeTarget: 't1', label: 'z', command: 'z' });
    addShortcut({ scope: 'global', label: 'g', command: 'g' });

    expect(listShortcutsFor('terminal', 't1').map((row) => row.label)).toEqual(['x']);
    expect(listShortcutsFor('terminal', 't2').map((row) => row.label)).toEqual(['y']);
    expect(listShortcutsFor('chatroom', 't1').map((row) => row.label)).toEqual(['z']);
    expect(listShortcutsFor('global').map((row) => row.label)).toEqual(['g']);
  });

  it('adds a global shortcut and refuses a scope_target for the global scope', () => {
    const g = addShortcut({ scope: 'global', label: 'help', command: '/help' });
    expect(g.scope).toBe('global');
    expect(g.scopeTarget).toBeNull();
    expect(() =>
      addShortcut({ scope: 'global', scopeTarget: 'oops', label: 'x', command: 'x' })
    ).toThrow(/cannot carry a scope_target/);
  });

  it('rejects blank label, blank command, and non-global scopes without a target', () => {
    expect(() => addShortcut({ scope: 'terminal', scopeTarget: 't1', label: '   ', command: 'x' })).toThrow(/label/);
    expect(() => addShortcut({ scope: 'terminal', scopeTarget: 't1', label: 'x', command: '   ' })).toThrow(/command/);
    expect(() => addShortcut({ scope: 'terminal', scopeTarget: '', label: 'x', command: 'x' })).toThrow(/scope_target/);
    expect(() => addShortcut({ scope: 'chatroom', label: 'x', command: 'x' })).toThrow(/scope_target/);
  });

  it('removeShortcut returns true on success and false for unknown ids', () => {
    const created = addShortcut({ scope: 'terminal', scopeTarget: 't_abc', label: 'x', command: 'x' });
    expect(removeShortcut(created.id)).toBe(true);
    expect(findShortcutById(created.id)).toBeUndefined();
    expect(removeShortcut(created.id)).toBe(false);
    expect(removeShortcut('does-not-exist')).toBe(false);
  });

  it('listShortcutsFor on a non-global scope requires a non-empty target', () => {
    expect(() => listShortcutsFor('terminal', '   ')).toThrow(/scope_target/);
    expect(() => listShortcutsFor('chatroom', null)).toThrow(/scope_target/);
  });

  it('honours an explicit orderIndex on add (does not bump MAX+1)', () => {
    const a = addShortcut({ scope: 'global', label: 'a', command: 'a', orderIndex: 5 });
    const b = addShortcut({ scope: 'global', label: 'b', command: 'b', orderIndex: 2 });
    const list = listShortcutsFor('global');
    expect(list.map((row) => row.id)).toEqual([b.id, a.id]);
    expect(list.map((row) => row.orderIndex)).toEqual([2, 5]);
  });

  it('resetShortcutsStoreForTests wipes every row', () => {
    addShortcut({ scope: 'global', label: 'a', command: 'a' });
    addShortcut({ scope: 'terminal', scopeTarget: 't1', label: 'b', command: 'b' });
    expect(listShortcutsFor('global').length + listShortcutsFor('terminal', 't1').length).toBe(2);
    resetShortcutsStoreForTests();
    expect(listShortcutsFor('global')).toEqual([]);
    expect(listShortcutsFor('terminal', 't1')).toEqual([]);
  });
});
