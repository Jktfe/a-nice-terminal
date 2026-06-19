import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/lib/components/HelperPairingPanel.svelte', 'utf8');

describe('HelperPairingPanel source contract', () => {
  it('does not eagerly fetch operator-only helper endpoints while collapsed', () => {
    expect(source).not.toContain('onMount');
    expect(source).toContain('async function ensureLoaded()');
    expect(source).toContain('if (expanded) void ensureLoaded();');
    expect(source).toContain('onclick={toggleExpanded}');
  });
});
