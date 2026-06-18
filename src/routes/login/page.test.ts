import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const pageSource = readFileSync('src/routes/login/+page.svelte', 'utf8');

describe('/login page source', () => {
  it('does not fall back to stored login after account login accepted credentials but local session failed', () => {
    expect(pageSource).toContain('failure.fallbackToStoredLogin === false');
    expect(pageSource).toContain('canTryStoredLogin(response, failure ?? {})');
    expect(pageSource).toContain('return `${failure.message}${requestSuffix}`');
    expect(pageSource).toContain('Reference: ${failure.requestId}.');
  });
});
