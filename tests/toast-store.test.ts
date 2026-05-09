import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('toast store timing contract', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/stores/toast.svelte.ts'),
    'utf8',
  );

  it('keeps notifications visible long enough to read by default', () => {
    expect(source).toContain('export const DEFAULT_TOAST_DURATION_MS = 7000');
    expect(source).toContain("durationMs = DEFAULT_TOAST_DURATION_MS");
    expect(source).not.toContain('durationMs = 3000');
  });

  it('tracks remaining time so hover and focus pause auto-dismiss', () => {
    expect(source).toContain('remainingMs: number');
    expect(source).toContain('paused: boolean');
    expect(source).toContain('function pause(id: number)');
    expect(source).toContain('function resume(id: number)');
    expect(source).toContain('Date.now() - (startedAt.get(id) ?? Date.now())');
  });
});
