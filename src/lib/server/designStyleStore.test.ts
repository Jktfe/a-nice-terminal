import { describe, it, expect, beforeEach } from 'vitest';
import {
  listDesignStyles,
  getDesignStyle,
  createDesignStyle,
  updateDesignStyle,
  deleteDesignStyle,
  isAllowedDesignStyleKind,
  isAllowedDesignStyleScope
} from './designStyleStore';

describe('designStyleStore', () => {
  beforeEach(() => {
    // Clean up default public styles between tests
    const styles = listDesignStyles({ scope: 'public', scopeId: 'test-org' });
    for (const s of styles) deleteDesignStyle(s.id);
  });

  it('T1: kind + scope guards work', () => {
    expect(isAllowedDesignStyleKind('palette')).toBe(true);
    expect(isAllowedDesignStyleKind('invalid')).toBe(false);
    expect(isAllowedDesignStyleScope('org')).toBe(true);
    expect(isAllowedDesignStyleScope('invalid')).toBe(false);
  });

  it('T2: create + get round-trip', () => {
    const created = createDesignStyle({
      name: 'Test Palette',
      kind: 'palette',
      scope: 'org',
      scopeId: 'test-org',
      data: { primary: '#ff0000' },
      tags: ['test'],
      createdBy: '@test'
    });
    expect(created.name).toBe('Test Palette');
    expect(created.data.primary).toBe('#ff0000');

    const fetched = getDesignStyle(created.id);
    expect(fetched).toBeDefined();
    expect(fetched?.name).toBe('Test Palette');
  });

  it('T3: list with filters', () => {
    createDesignStyle({ name: 'A', kind: 'palette', scope: 'org', scopeId: 'test-org' });
    createDesignStyle({ name: 'B', kind: 'font', scope: 'org', scopeId: 'test-org' });
    createDesignStyle({ name: 'C', kind: 'palette', scope: 'user', scopeId: 'u1' });

    const all = listDesignStyles();
    expect(all.length).toBeGreaterThanOrEqual(3);

    const palettes = listDesignStyles({ kind: 'palette' });
    expect(palettes.every(s => s.kind === 'palette')).toBe(true);

    const orgScoped = listDesignStyles({ scope: 'org', scopeId: 'test-org' });
    expect(orgScoped.every(s => s.scope === 'org' && s.scopeId === 'test-org')).toBe(true);
  });

  it('T4: update + delete', () => {
    const created = createDesignStyle({ name: 'Old', kind: 'palette', scope: 'org', scopeId: 'test-org' });
    const updated = updateDesignStyle(created.id, { name: 'New', data: { updated: true } });
    expect(updated?.name).toBe('New');
    expect(updated?.data.updated).toBe(true);

    const deleted = deleteDesignStyle(created.id);
    expect(deleted).toBe(true);
    expect(getDesignStyle(created.id)).toBeUndefined();
  });
});
