import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('ClaimValidationOverlay', () => {
  it('looks up validation runs by stable claim anchor, not raw claim text', () => {
    const source = readFileSync('src/lib/components/ClaimValidationOverlay.svelte', 'utf8');

    expect(source).toContain('claimAnchor: string');
    expect(source).toContain('encodeURIComponent(claimAnchor)');
    expect(source).not.toContain('encodeURIComponent(claimText)');
    expect(source).toContain('{claimAnchor}');
  });
});
