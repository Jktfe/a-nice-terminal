import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

describe('toast container placement', () => {
  const source = readFileSync(
    resolve(import.meta.dirname, '../src/lib/components/ToastContainer.svelte'),
    'utf8',
  );

  it('uses a constrained top-right stack so notifications do not cover the composer send button', () => {
    expect(source).toContain('.ant-toast-container');
    expect(source).toContain('top: calc(1rem + var(--ant-safe-top, 0px))');
    expect(source).toContain('right: calc(1rem + var(--ant-safe-right, 0px))');
    expect(source).toContain('width: min(400px');
    expect(source).not.toContain('bottom-5 right-5');
  });

  it('keeps toast text readable without full-width overlays', () => {
    expect(source).toContain('overflow-wrap: anywhere');
    expect(source).toContain('visibleToasts = $derived(toasts.list.slice(-5))');
    expect(source).toContain('grid-template-columns: 1.25rem minmax(0, 1fr) auto');
  });
});
