/**
 * specialKeys.ts — fresh-ANT local copy of v3 a-nice-terminal/src/lib/shared/special-keys.ts
 * Per FRONT-3 v2 design implementation note: fresh-ANT must not depend
 * on the v3 path. Hardcoded sequences match xterm-compatible ANSI for
 * cursor + meta keys. `__paste__` is a sentinel — the renderer should
 * intercept and call navigator.clipboard.readText() instead of writing it.
 */

export type SpecialKey = {
  label: string;
  seq: string;
  cli: string;
};

export const SPECIAL_KEYS: readonly SpecialKey[] = [
  { label: 'Kill', seq: '\x03', cli: 'ctrl-c' },
  { label: '⇧Tab', seq: '\x1b[Z', cli: 'shift-tab' },
  { label: 'Tab', seq: '\t', cli: 'tab' },
  { label: 'Enter', seq: '\r', cli: 'enter' },
  { label: '←', seq: '\x1b[D', cli: 'left' },
  { label: '→', seq: '\x1b[C', cli: 'right' },
  { label: '↑', seq: '\x1b[A', cli: 'up' },
  { label: '↓', seq: '\x1b[B', cli: 'down' },
  { label: 'Esc', seq: '\x1b', cli: 'escape' },
  { label: 'Paste', seq: '__paste__', cli: 'paste' }
] as const;

export const PASTE_SENTINEL = '__paste__';

export function getKeySequence(cli: string): string | null {
  const k = SPECIAL_KEYS.find((entry) => entry.cli === cli);
  return k?.seq ?? null;
}
