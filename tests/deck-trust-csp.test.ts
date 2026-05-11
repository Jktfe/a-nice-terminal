// B1 of main-app-improvements-2026-05-10 — focused tests for the CSP
// strings the deck proxy now attaches based on trust_mode. The proxy
// itself is integration-tested behind a live dev server; here we lock
// the policy text + the type guard so regressions in either are caught
// at unit-test speed.

import { describe, expect, it } from 'vitest';
import {
  cspForTrustMode,
  isDeckTrustMode,
  SAFE_CSP,
  TRUSTED_CSP,
} from '../src/lib/server/decks.js';

describe('isDeckTrustMode', () => {
  it('accepts the two canonical modes', () => {
    expect(isDeckTrustMode('safe')).toBe(true);
    expect(isDeckTrustMode('trusted')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isDeckTrustMode('Safe')).toBe(false);
    expect(isDeckTrustMode('off')).toBe(false);
    expect(isDeckTrustMode(true)).toBe(false);
    expect(isDeckTrustMode(null)).toBe(false);
    expect(isDeckTrustMode(undefined)).toBe(false);
    expect(isDeckTrustMode(1)).toBe(false);
  });
});

describe('cspForTrustMode', () => {
  it('safe mode returns the strict CSP with no JS or network', () => {
    const csp = cspForTrustMode('safe');
    expect(csp).toBe(SAFE_CSP);
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("script-src 'none'");
    expect(csp).toContain("connect-src 'none'");
    expect(csp).toContain("frame-src 'none'");
    expect(csp).toContain("base-uri 'none'");
    expect(csp).not.toContain('https:');
  });

  it('trusted mode returns the permissive CSP that still pins frame-ancestors', () => {
    const csp = cspForTrustMode('trusted');
    expect(csp).toBe(TRUSTED_CSP);
    expect(csp).toContain("'self'");
    expect(csp).toContain('https:');
    expect(csp).toContain("frame-ancestors 'self'");
    // Trusted does not include "'none'" anywhere — it would defeat the mode
    expect(csp).not.toContain("'none'");
  });
});
