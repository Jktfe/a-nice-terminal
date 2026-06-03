/**
 * Test-only fixtures for the org email→handle map.
 *
 * The real org emails were moved OUT of source (PII) into the
 * `ANT_ORG_HANDLE_MAP` env var, read by chatRoomReadGate. Tests that exercise
 * email→handle expansion use these fake `example.test` fixtures plus
 * `installFixtureOrgHandleMap()` to reproduce the mapping deterministically,
 * so no real address appears anywhere in the repo.
 *
 * Handles (e.g. @you, @jamesK) are pseudonymous identifiers, not PII, and are
 * intentionally retained.
 */
export const FIXTURE_OPERATOR_EMAIL = 'demo-operator@example.test';
export const FIXTURE_OPERATOR_M5_EMAIL = 'demo-operator-m5@example.test';
export const FIXTURE_MARK_EMAIL = 'demo-mark@example.test';
export const FIXTURE_STEVE_EMAIL = 'demo-steve@example.test';

export const FIXTURE_ORG_HANDLE_MAP: Record<string, string[]> = {
  [FIXTURE_OPERATOR_EMAIL]: ['@JWPK', '@jamesK', '@you', '@james'],
  [FIXTURE_OPERATOR_M5_EMAIL]: ['@jamesm5'],
  [FIXTURE_MARK_EMAIL]: ['@mark'],
  [FIXTURE_STEVE_EMAIL]: ['@stevo', '@jstephenson']
};

/**
 * Install the fixture org map into `process.env.ANT_ORG_HANDLE_MAP` for a
 * test. Call inside `beforeEach`. Pair with a matching `afterEach` restore if
 * the suite is sensitive to env leakage across files.
 */
export function installFixtureOrgHandleMap(): void {
  process.env.ANT_ORG_HANDLE_MAP = JSON.stringify(FIXTURE_ORG_HANDLE_MAP);
}
