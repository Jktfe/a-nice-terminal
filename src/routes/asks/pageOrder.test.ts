import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('/asks page ordering', () => {
  it('renders definite open asks before potential ask candidates', () => {
    const source = readFileSync('src/routes/asks/+page.svelte', 'utf8');

    const openAskListIndex = source.indexOf('<ul class="ask-list" aria-label="Open asks queue">');
    const candidateReviewIndex = source.indexOf('<section class="candidate-section" aria-labelledby="ask-candidates-heading">');

    expect(openAskListIndex).toBeGreaterThan(-1);
    expect(candidateReviewIndex).toBeGreaterThan(-1);
    expect(openAskListIndex).toBeLessThan(candidateReviewIndex);
  });
});
