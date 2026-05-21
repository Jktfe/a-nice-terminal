import { afterEach, describe, expect, it } from 'vitest';
import { requireAdminAuth } from './chatInviteAuth';

describe('chatInviteAuth', () => {
  const ORIGINAL_TOKEN = process.env.ANT_ADMIN_TOKEN;

  afterEach(() => {
    if (ORIGINAL_TOKEN === undefined) delete process.env.ANT_ADMIN_TOKEN;
    else process.env.ANT_ADMIN_TOKEN = ORIGINAL_TOKEN;
  });

  it('throws 503 when ANT_ADMIN_TOKEN is unset', () => {
    delete process.env.ANT_ADMIN_TOKEN;
    const req = new Request('http://localhost/');
    try {
      requireAdminAuth(req);
      expect.fail('should have thrown');
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(503);
    }
  });

  it('throws 503 when ANT_ADMIN_TOKEN is empty', () => {
    process.env.ANT_ADMIN_TOKEN = '';
    const req = new Request('http://localhost/');
    try {
      requireAdminAuth(req);
      expect.fail('should have thrown');
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(503);
    }
  });

  it('throws 401 when authorization header is missing', () => {
    process.env.ANT_ADMIN_TOKEN = 'secret-token';
    const req = new Request('http://localhost/');
    try {
      requireAdminAuth(req);
      expect.fail('should have thrown');
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(401);
    }
  });

  it('throws 401 when authorization header is wrong', () => {
    process.env.ANT_ADMIN_TOKEN = 'secret-token';
    const req = new Request('http://localhost/', {
      headers: { authorization: 'Bearer wrong-token' }
    });
    try {
      requireAdminAuth(req);
      expect.fail('should have thrown');
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(401);
    }
  });

  it('throws 401 when bearer prefix is missing', () => {
    process.env.ANT_ADMIN_TOKEN = 'secret-token';
    const req = new Request('http://localhost/', {
      headers: { authorization: 'secret-token' }
    });
    try {
      requireAdminAuth(req);
      expect.fail('should have thrown');
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(401);
    }
  });

  it('succeeds when token matches', () => {
    process.env.ANT_ADMIN_TOKEN = 'secret-token';
    const req = new Request('http://localhost/', {
      headers: { authorization: 'Bearer secret-token' }
    });
    expect(() => requireAdminAuth(req)).not.toThrow();
  });

  it('succeeds with a long token', () => {
    const longToken = 'a'.repeat(64);
    process.env.ANT_ADMIN_TOKEN = longToken;
    const req = new Request('http://localhost/', {
      headers: { authorization: `Bearer ${longToken}` }
    });
    expect(() => requireAdminAuth(req)).not.toThrow();
  });

  it('throws 401 on length mismatch (timing-safe)', () => {
    process.env.ANT_ADMIN_TOKEN = 'short';
    const req = new Request('http://localhost/', {
      headers: { authorization: 'Bearer longer-string' }
    });
    try {
      requireAdminAuth(req);
      expect.fail('should have thrown');
    } catch (e: unknown) {
      expect((e as { status: number }).status).toBe(401);
    }
  });
});
