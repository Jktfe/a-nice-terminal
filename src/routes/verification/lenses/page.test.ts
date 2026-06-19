import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/routes/verification/lenses/+page.svelte', 'utf8');

describe('/verification/lenses page source', () => {
  it('preserves server failure reasons for save and archive actions', () => {
    expect(pageSource).toContain('responseFailureMessage(response,');
    expect(pageSource).toContain("responseFailureMessage(response, 'Save')");
    expect(pageSource).toContain("responseFailureMessage(response, 'Archive')");
    expect(pageSource).toContain('body?.message');
    expect(pageSource).not.toContain('throw new Error(`Archive failed (${response.status}).`)');
  });

  it('clones lens rules through JSON so Svelte state proxies are selectable', () => {
    expect(pageSource).toContain('function cloneLensRules(rules: LensRules): LensRules');
    expect(pageSource).toContain('return JSON.parse(JSON.stringify(rules)) as LensRules;');
    expect(pageSource).toContain('rules: cloneLensRules(parsedRules)');
    expect(pageSource).toContain('return cloneLensRules(draft.rules);');
    expect(pageSource).not.toContain('structuredClone(');
  });
});
