import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MentionAutocomplete interactions', () => {
  const source = readFileSync('src/lib/components/MentionAutocomplete.svelte', 'utf8');

  it('keeps textarea focus stable while clicking a suggestion', () => {
    expect(source).toContain('onmousedown={(event) => event.preventDefault()}');
    expect(source).toContain('onclick={() => onPick(option.handleToInsert)}');
  });
});
