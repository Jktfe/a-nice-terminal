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

  it('keeps non-credential account login failures visible when the stored-login fallback also fails', () => {
    expect(pageSource).toContain('shouldKeepAccountFailureAfterStoredFallback(');
    expect(pageSource).toContain("accountFailure.code && accountFailure.code !== 'invalid_credentials'");
    expect(pageSource).toContain('return accountResponse.status >= 500 && !storedResponse.ok;');
    expect(pageSource).toContain('response = accountResponse;');
    expect(pageSource).toContain('failure = accountFailure;');
  });
});
