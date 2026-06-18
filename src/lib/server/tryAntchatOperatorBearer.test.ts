import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { writeFileSync, mkdtempSync, rmSync } from 'fs';
import { join } from 'path';
import { tmpdir } from 'os';
import { tryAntchatOperatorBearer } from './chatRoomAuthGate';
import { issueToken } from './antchatAuthStore';

// Trust-tier regression for the operator-email anchor (@ecoantcodex audit on
// e1c860e). The gate MUST decide operator status from the account email, never
// from a derived/canonicalised handle — a non-operator account can produce the
// operator handle via its email local-part (`jwpk`/`you`) or a stored override.
const OPERATOR_EMAIL = 'operator@example.com';

function bearerRequest(token: string): Request {
  return new Request('http://localhost/api/helper/pairing', {
    headers: { authorization: `Bearer ${token}` }
  });
}

describe('tryAntchatOperatorBearer — operator-email anchor', () => {
  let prevOperatorEmail: string | undefined;
  let prevDemoEmail: string | undefined;
  let prevDevUsers: string | undefined;
  let tmpDir: string;

  beforeEach(() => {
    prevOperatorEmail = process.env.ANT_OPERATOR_EMAIL;
    prevDemoEmail = process.env.ANT_DEMO_EMAIL;
    prevDevUsers = process.env.ANTCHAT_DEV_USERS_PATH;
    process.env.ANT_OPERATOR_EMAIL = OPERATOR_EMAIL;
    delete process.env.ANT_DEMO_EMAIL; // make ANT_OPERATOR_EMAIL the sole source

    // Seed dev-users so two NON-operator accounts carry operator-handle
    // overrides (@JWPK / @you). If the gate touched the handle, these would
    // pass; it must reject them on email.
    tmpDir = mkdtempSync(join(tmpdir(), 'antchat-users-'));
    const usersPath = join(tmpDir, 'dev-users.json');
    writeFileSync(
      usersPath,
      JSON.stringify({
        users: [
          { email: OPERATOR_EMAIL, handle: '@neutral-operator-handle' },
          { email: 'spoof-jwpk@example.com', handle: '@JWPK' },
          { email: 'spoof-you@example.com', handle: '@you' }
        ]
      })
    );
    process.env.ANTCHAT_DEV_USERS_PATH = usersPath;
  });

  afterEach(() => {
    restore('ANT_OPERATOR_EMAIL', prevOperatorEmail);
    restore('ANT_DEMO_EMAIL', prevDemoEmail);
    restore('ANTCHAT_DEV_USERS_PATH', prevDevUsers);
    rmSync(tmpDir, { recursive: true, force: true });
  });

  function restore(key: string, value: string | undefined) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }

  test('accepts the configured operator email', () => {
    const { token } = issueToken(OPERATOR_EMAIL);
    expect(tryAntchatOperatorBearer(bearerRequest(token))).toBe(true);
  });

  test('rejects an ordinary non-operator bearer', () => {
    const { token } = issueToken('ordinary@example.com');
    expect(tryAntchatOperatorBearer(bearerRequest(token))).toBe(false);
  });

  test('rejects an email whose local-part derives to @jwpk', () => {
    const { token } = issueToken('jwpk@example.com');
    expect(tryAntchatOperatorBearer(bearerRequest(token))).toBe(false);
  });

  test('rejects an email whose local-part derives to @you', () => {
    const { token } = issueToken('you@example.com');
    expect(tryAntchatOperatorBearer(bearerRequest(token))).toBe(false);
  });

  test('rejects a non-operator account with a stored @JWPK handle override', () => {
    const { token } = issueToken('spoof-jwpk@example.com');
    expect(tryAntchatOperatorBearer(bearerRequest(token))).toBe(false);
  });

  test('rejects a non-operator account with a stored @you handle override', () => {
    const { token } = issueToken('spoof-you@example.com');
    expect(tryAntchatOperatorBearer(bearerRequest(token))).toBe(false);
  });

  test('fails closed when no operator email is configured', () => {
    delete process.env.ANT_OPERATOR_EMAIL;
    delete process.env.ANT_DEMO_EMAIL;
    const { token } = issueToken(OPERATOR_EMAIL);
    expect(tryAntchatOperatorBearer(bearerRequest(token))).toBe(false);
  });

  test('rejects when no Authorization bearer is present', () => {
    expect(tryAntchatOperatorBearer(new Request('http://localhost/api/helper/pairing'))).toBe(false);
  });
});
