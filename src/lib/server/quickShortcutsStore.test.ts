/**
 * Tests for the global Quick Shortcuts store. Mirrors chatRoomStore.test.ts
 * style: reset before each test, exercise CRUD + reorder, assert validation.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  createQuickShortcut,
  deleteQuickShortcut,
  findQuickShortcutById,
  listQuickShortcuts,
  reorderQuickShortcuts,
  resetQuickShortcutsStoreForTests,
  updateQuickShortcut
} from './quickShortcutsStore';

describe('quickShortcutsStore', () => {
  beforeEach(() => {
    resetQuickShortcutsStoreForTests();
  });

  describe('createQuickShortcut', () => {
    it('returns a shortcut with the given label, text, and autoEnter default true', () => {
      const created = createQuickShortcut({ label: 'exit', text: 'exit' });
      expect(created.ownerHandle).toBe('@JWPK');
      expect(created.label).toBe('exit');
      expect(created.text).toBe('exit');
      expect(created.autoEnter).toBe(true);
      expect(created.id.length).toBeGreaterThan(0);
      expect(created.orderIndex).toBe(1);
      expect(created.createdAtMs).toBeGreaterThan(0);
      expect(created.updatedAtMs).toBe(created.createdAtMs);
    });

    it('respects explicit autoEnter false', () => {
      const created = createQuickShortcut({
        label: 'paste',
        text: 'hello',
        autoEnter: false
      });
      expect(created.autoEnter).toBe(false);
    });

    it('trims whitespace from label and text', () => {
      const created = createQuickShortcut({
        label: '  clear  ',
        text: '   clear   '
      });
      expect(created.label).toBe('clear');
      expect(created.text).toBe('clear');
    });

    it('rejects an empty label', () => {
      expect(() => createQuickShortcut({ label: '   ', text: 'something' })).toThrow();
    });

    it('rejects an empty text', () => {
      expect(() => createQuickShortcut({ label: 'something', text: '   ' })).toThrow();
    });

    it('assigns incrementing orderIndex values', () => {
      const a = createQuickShortcut({ label: 'a', text: 'a' });
      const b = createQuickShortcut({ label: 'b', text: 'b' });
      const c = createQuickShortcut({ label: 'c', text: 'c' });
      expect(a.orderIndex).toBeLessThan(b.orderIndex);
      expect(b.orderIndex).toBeLessThan(c.orderIndex);
    });
  });

  describe('listQuickShortcuts', () => {
    it('returns shortcuts ordered by orderIndex ASC', () => {
      const a = createQuickShortcut({ label: 'a', text: 'a' });
      const b = createQuickShortcut({ label: 'b', text: 'b' });
      const c = createQuickShortcut({ label: 'c', text: 'c' });
      const list = listQuickShortcuts();
      expect(list.map((s) => s.id)).toEqual([a.id, b.id, c.id]);
    });

    it('returns an empty list when no shortcuts exist', () => {
      expect(listQuickShortcuts()).toEqual([]);
    });

    it('isolates shortcuts by owner handle', () => {
      const mine = createQuickShortcut({ ownerHandle: '@JWPK', label: 'mine', text: 'mine' });
      const theirs = createQuickShortcut({ ownerHandle: '@agent', label: 'theirs', text: 'theirs' });

      expect(listQuickShortcuts('@JWPK').map((s) => s.id)).toEqual([mine.id]);
      expect(listQuickShortcuts('@agent').map((s) => s.id)).toEqual([theirs.id]);
    });
  });

  describe('findQuickShortcutById', () => {
    it('returns the shortcut when it exists', () => {
      const created = createQuickShortcut({ label: 'a', text: 'a' });
      const found = findQuickShortcutById(created.id);
      expect(found?.id).toBe(created.id);
    });

    it('returns undefined for an unknown id', () => {
      expect(findQuickShortcutById('does-not-exist')).toBeUndefined();
    });

    it('does not find another owner shortcut', () => {
      const created = createQuickShortcut({ ownerHandle: '@agent', label: 'a', text: 'a' });
      expect(findQuickShortcutById(created.id, '@JWPK')).toBeUndefined();
    });
  });

  describe('updateQuickShortcut', () => {
    it('patches the label only', () => {
      const created = createQuickShortcut({ label: 'old', text: 'cmd' });
      const updated = updateQuickShortcut(created.id, { label: 'new' });
      expect(updated?.label).toBe('new');
      expect(updated?.text).toBe('cmd');
      expect(updated?.autoEnter).toBe(true);
    });

    it('patches the text only', () => {
      const created = createQuickShortcut({ label: 'label', text: 'old' });
      const updated = updateQuickShortcut(created.id, { text: 'new' });
      expect(updated?.text).toBe('new');
      expect(updated?.label).toBe('label');
    });

    it('patches the autoEnter only', () => {
      const created = createQuickShortcut({ label: 'l', text: 't' });
      expect(created.autoEnter).toBe(true);
      const updated = updateQuickShortcut(created.id, { autoEnter: false });
      expect(updated?.autoEnter).toBe(false);
    });

    it('trims label and text on patch', () => {
      const created = createQuickShortcut({ label: 'l', text: 't' });
      const updated = updateQuickShortcut(created.id, {
        label: '  trimmed-label  ',
        text: '  trimmed-text  '
      });
      expect(updated?.label).toBe('trimmed-label');
      expect(updated?.text).toBe('trimmed-text');
    });

    it('bumps updatedAtMs', async () => {
      const created = createQuickShortcut({ label: 'l', text: 't' });
      // Wait at least 2ms to guarantee Date.now() advances past 1ms resolution.
      await new Promise((resolve) => setTimeout(resolve, 2));
      const updated = updateQuickShortcut(created.id, { label: 'l2' });
      expect(updated?.updatedAtMs).toBeGreaterThanOrEqual(created.updatedAtMs);
    });

    it('returns undefined for an unknown id', () => {
      expect(updateQuickShortcut('does-not-exist', { label: 'x' })).toBeUndefined();
    });

    it('does not update another owner shortcut', () => {
      const created = createQuickShortcut({ ownerHandle: '@agent', label: 'old', text: 'cmd' });
      expect(updateQuickShortcut(created.id, { label: 'new' }, '@JWPK')).toBeUndefined();
      expect(findQuickShortcutById(created.id, '@agent')?.label).toBe('old');
    });

    it('rejects an empty trimmed label', () => {
      const created = createQuickShortcut({ label: 'l', text: 't' });
      expect(() => updateQuickShortcut(created.id, { label: '   ' })).toThrow();
    });

    it('rejects an empty trimmed text', () => {
      const created = createQuickShortcut({ label: 'l', text: 't' });
      expect(() => updateQuickShortcut(created.id, { text: '   ' })).toThrow();
    });
  });

  describe('deleteQuickShortcut', () => {
    it('returns true and removes the row', () => {
      const created = createQuickShortcut({ label: 'l', text: 't' });
      expect(deleteQuickShortcut(created.id)).toBe(true);
      expect(findQuickShortcutById(created.id)).toBeUndefined();
    });

    it('returns false for an unknown id', () => {
      expect(deleteQuickShortcut('does-not-exist')).toBe(false);
    });

    it('does not delete another owner shortcut', () => {
      const created = createQuickShortcut({ ownerHandle: '@agent', label: 'l', text: 't' });
      expect(deleteQuickShortcut(created.id, '@JWPK')).toBe(false);
      expect(findQuickShortcutById(created.id, '@agent')).toBeDefined();
    });
  });

  describe('reorderQuickShortcuts', () => {
    it('reorders shortcuts to the requested sequence', () => {
      const a = createQuickShortcut({ label: 'a', text: 'a' });
      const b = createQuickShortcut({ label: 'b', text: 'b' });
      const c = createQuickShortcut({ label: 'c', text: 'c' });

      const reordered = reorderQuickShortcuts([c.id, a.id, b.id]);
      expect(reordered.map((s) => s.id)).toEqual([c.id, a.id, b.id]);
      expect(listQuickShortcuts().map((s) => s.id)).toEqual([c.id, a.id, b.id]);
    });

    it('ignores unknown ids in the input', () => {
      const a = createQuickShortcut({ label: 'a', text: 'a' });
      const b = createQuickShortcut({ label: 'b', text: 'b' });
      const reordered = reorderQuickShortcuts([b.id, 'unknown-id', a.id]);
      expect(reordered.map((s) => s.id)).toEqual([b.id, a.id]);
    });

    it('leaves omitted shortcuts at their previous orderIndex (which may be larger)', () => {
      const a = createQuickShortcut({ label: 'a', text: 'a' }); // orderIndex 1
      const b = createQuickShortcut({ label: 'b', text: 'b' }); // orderIndex 2
      const c = createQuickShortcut({ label: 'c', text: 'c' }); // orderIndex 3

      // Reorder only b and a — both get new (smaller) positions; c retains
      // orderIndex 3 and therefore stays last in the list.
      const reordered = reorderQuickShortcuts([b.id, a.id]);
      expect(reordered.map((s) => s.id)).toEqual([b.id, a.id, c.id]);
    });

    it('handles an empty ids array (no-op, returns current list)', () => {
      const a = createQuickShortcut({ label: 'a', text: 'a' });
      const reordered = reorderQuickShortcuts([]);
      expect(reordered.map((s) => s.id)).toEqual([a.id]);
    });

    it('only reorders the requested owner bucket', () => {
      const mineA = createQuickShortcut({ ownerHandle: '@JWPK', label: 'mine-a', text: 'a' });
      const mineB = createQuickShortcut({ ownerHandle: '@JWPK', label: 'mine-b', text: 'b' });
      const theirA = createQuickShortcut({ ownerHandle: '@agent', label: 'their-a', text: 'a' });
      const theirB = createQuickShortcut({ ownerHandle: '@agent', label: 'their-b', text: 'b' });

      expect(reorderQuickShortcuts([mineB.id, mineA.id], '@JWPK').map((s) => s.id)).toEqual([
        mineB.id,
        mineA.id
      ]);
      expect(listQuickShortcuts('@agent').map((s) => s.id)).toEqual([theirA.id, theirB.id]);
    });
  });
});
