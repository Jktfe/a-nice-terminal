import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bcrypt from 'bcryptjs';
import { POST as loginPost } from './+server';
import { GET as meGet } from '../me/+server';
import { POST as logoutPost } from '../logout/+server';
import { POST as rotatePost } from '../rotate-password/+server';
import { POST as licencePost } from '../../license/validate/+server';
import { POST as licenceRefreshPost } from '../../license/refresh/+server';
import { resetAntchatAuthTokensForTests } from '$lib/server/antchatAuthStore';

const PREV_USERS_PATH = process.env.ANTCHAT_DEV_USERS_PATH;
const PREV_LICENCES_PATH = process.env.ANTCHAT_DEV_LICENCES_PATH;

let tmpDir: string;

function writeAuthFiles(options: { mustChangePassword?: boolean } = {}) {
  const usersPath = join(tmpDir, 'dev-users.json');
  const licencesPath = join(tmpDir, 'dev-licences.json');
  writeFileSync(usersPath, JSON.stringify({
    users: [
      {
        email: 'test@example.com',
        role: 'dev',
        password_hash: bcrypt.hashSync('correct-password', 12),
        must_change_password: options.mustChangePassword ?? false
      }
    ]
  }), 'utf8');
  writeFileSync(licencesPath, JSON.stringify({
    allowedEmails: ['test@example.com'],
    tier: 'dev',
    features: ['all']
  }), 'utf8');
  process.env.ANTCHAT_DEV_USERS_PATH = usersPath;
  process.env.ANTCHAT_DEV_LICENCES_PATH = licencesPath;
}

function eventForPost(url: string, body: unknown, headers: Record<string, string> = {}) {
  return {
    request: new Request(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body)
    }),
    url: new URL(url),
    params: {}
  } as never;
}

function eventForGet(url: string, headers: Record<string, string> = {}) {
  return {
    request: new Request(url, { method: 'GET', headers }),
    url: new URL(url),
    params: {}
  } as never;
}

async function capture(fn: () => Promise<Response> | Response): Promise<Response> {
  try {
    return await fn();
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

beforeEach(() => {
  tmpDir = mkdtempSync(join(tmpdir(), 'antchat-auth-'));
  resetAntchatAuthTokensForTests();
  writeAuthFiles();
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetAntchatAuthTokensForTests();
  rmSync(tmpDir, { recursive: true, force: true });
  if (PREV_USERS_PATH === undefined) delete process.env.ANTCHAT_DEV_USERS_PATH;
  else process.env.ANTCHAT_DEV_USERS_PATH = PREV_USERS_PATH;
  if (PREV_LICENCES_PATH === undefined) delete process.env.ANTCHAT_DEV_LICENCES_PATH;
  else process.env.ANTCHAT_DEV_LICENCES_PATH = PREV_LICENCES_PATH;
});

describe('POST /api/auth/login for Mac antchat', () => {
  it('returns token, user, and expiry for a valid email/password/licence triple', async () => {
    const response = await capture(() => loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'TEST@example.com',
      password: 'correct-password',
      license: 'new-model-ant-dev-test@example.com'
    })));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.token).toEqual(expect.any(String));
    expect(body.expiresAt).toEqual(expect.any(Number));
    expect(body.user).toEqual({
      id: 'test@example.com',
      email: 'test@example.com',
      displayName: 'Test',
      handle: '@test'
    });
  });

  it('rejects wrong passwords without leaking whether the user exists', async () => {
    const response = await capture(() => loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'test@example.com',
      password: 'wrong-password',
      license: 'NEW-MODEL-ANT-DEV-test@example.com'
    })));

    expect(response.status).toBe(401);
  });

  it('requires the licence email to match the login email', async () => {
    const response = await capture(() => loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'test@example.com',
      password: 'correct-password',
      license: 'NEW-MODEL-ANT-DEV-other@example.com'
    })));

    expect(response.status).toBe(403);
  });

  it('returns the future password-rotation shape only when the seed says to enforce it', async () => {
    writeAuthFiles({ mustChangePassword: true });

    const response = await capture(() => loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'test@example.com',
      password: 'correct-password',
      license: 'NEW-MODEL-ANT-DEV-test@example.com'
    })));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({
      requiresPasswordRotation: true,
      tempToken: expect.any(String)
    });
  });
});

describe('Mac antchat auth session endpoints', () => {
  async function login(): Promise<string> {
    const response = await loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'test@example.com',
      password: 'correct-password',
      license: 'NEW-MODEL-ANT-DEV-test@example.com'
    }));
    const body = await response.json();
    return body.token;
  }

  it('GET /api/auth/me resolves a bearer token to the user shape', async () => {
    const token = await login();

    const response = await capture(() => meGet(eventForGet('http://localhost/api/auth/me', {
      authorization: `Bearer ${token}`
    })));

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.user.email).toBe('test@example.com');
    expect(body.expiresAt).toEqual(expect.any(Number));
  });

  it('POST /api/auth/logout revokes the bearer token', async () => {
    const token = await login();

    const logout = await capture(() => logoutPost(eventForPost(
      'http://localhost/api/auth/logout',
      {},
      { authorization: `Bearer ${token}` }
    )));
    expect(logout.status).toBe(200);

    const me = await capture(() => meGet(eventForGet('http://localhost/api/auth/me', {
      authorization: `Bearer ${token}`
    })));
    expect(me.status).toBe(401);
  });

  it('POST /api/auth/rotate-password updates the stored password and returns a session', async () => {
    writeAuthFiles({ mustChangePassword: true });
    const loginResponse = await loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'test@example.com',
      password: 'correct-password',
      license: 'NEW-MODEL-ANT-DEV-test@example.com'
    }));
    const loginBody = await loginResponse.json();

    const rotate = await capture(() => rotatePost(eventForPost('http://localhost/api/auth/rotate-password', {
      tempToken: loginBody.tempToken,
      newPassword: 'new-password'
    })));
    expect(rotate.status).toBe(200);
    const rotateBody = await rotate.json();
    expect(rotateBody.token).toEqual(expect.any(String));
    expect(rotateBody.user.email).toBe('test@example.com');

    const secondLogin = await capture(() => loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'test@example.com',
      password: 'new-password',
      license: 'NEW-MODEL-ANT-DEV-test@example.com'
    })));
    expect(secondLogin.status).toBe(200);
  });
});

describe('POST /api/license/validate for Mac antchat', () => {
  it('returns the Swift LicenceValidationResponse shape for an allowlisted licence', async () => {
    const response = await capture(() => licencePost(eventForPost('http://localhost/api/license/validate', {
      licenseKey: 'NEW-MODEL-ANT-DEV-test@example.com'
    })));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      valid: true,
      tier: 'paid',
      expiresAt: null,
      features: ['all'],
      stripeCustomerId: null,
      upgradeUrl: null
    });
  });

  it('returns valid=false for unrecognised licences', async () => {
    const response = await capture(() => licencePost(eventForPost('http://localhost/api/license/validate', {
      licenseKey: 'NEW-MODEL-ANT-DEV-other@example.com'
    })));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ valid: false, tier: 'free' });
  });
});

describe('POST /api/license/refresh for Mac antchat', () => {
  async function login(): Promise<string> {
    const response = await loginPost(eventForPost('http://localhost/api/auth/login', {
      email: 'test@example.com',
      password: 'correct-password',
      license: 'NEW-MODEL-ANT-DEV-test@example.com'
    }));
    const body = await response.json();
    return body.token;
  }

  it('returns the licence shape for a local home-server bearer token', async () => {
    const token = await login();

    const response = await capture(() => licenceRefreshPost(eventForPost(
      'http://localhost/api/license/refresh',
      {},
      { authorization: `Bearer ${token}` }
    )));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: true,
      tier: 'paid',
      features: ['all']
    });
  });

  it('accepts an accounts-issued bearer token by resolving /api/auth/me upstream', async () => {
    const fetchMock = vi.fn(async () =>
      new Response(JSON.stringify({ user: { email: 'test@example.com' } }), { status: 200 })
    );
    vi.stubGlobal('fetch', fetchMock);

    const response = await capture(() => licenceRefreshPost(eventForPost(
      'http://localhost/api/license/refresh',
      {},
      { authorization: 'Bearer accounts_token_123' }
    )));

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      valid: true,
      tier: 'paid',
      features: ['all']
    });
    const cachedResponse = await capture(() => licenceRefreshPost(eventForPost(
      'http://localhost/api/license/refresh',
      {},
      { authorization: 'Bearer accounts_token_123' }
    )));
    expect(cachedResponse.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      'https://accounts.antonline.dev/api/auth/me',
      expect.objectContaining({
        headers: { authorization: 'Bearer accounts_token_123' }
      })
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
