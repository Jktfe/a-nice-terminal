import { describe, expect, it } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  hashToken,
  mintTokenSecret
} from './chatInviteCrypto';

describe('chatInviteCrypto', () => {
  describe('hashPassword + verifyPassword', () => {
    it('hashes a password with scrypt', () => {
      const hashed = hashPassword('secret123');
      expect(hashed).toMatch(/^scrypt\$16384\$8\$1\$/);
      expect(hashed.split('$').length).toBe(6);
    });

    it('verifies a correct password', () => {
      const hashed = hashPassword('my-password');
      expect(verifyPassword('my-password', hashed)).toBe(true);
    });

    it('rejects an incorrect password', () => {
      const hashed = hashPassword('correct-horse');
      expect(verifyPassword('wrong-horse', hashed)).toBe(false);
    });

    it('rejects a tampered hash format', () => {
      expect(verifyPassword('secret', 'plain$123')).toBe(false);
    });

    it('rejects non-scrypt hash prefix', () => {
      expect(verifyPassword('secret', 'argon2$16384$8$1$abc$def')).toBe(false);
    });

    it('throws on short password', () => {
      expect(() => hashPassword('123')).toThrow(/at least 4/);
    });

    it('throws on non-string password', () => {
      expect(() => hashPassword('')).toThrow(/at least 4/);
    });

    it('returns false for non-string inputs', () => {
      expect(verifyPassword(null as unknown as string, 'scrypt$...')).toBe(false);
      expect(verifyPassword('plain', null as unknown as string)).toBe(false);
    });

    it('produces different hashes for same password (random salt)', () => {
      const h1 = hashPassword('same-password');
      const h2 = hashPassword('same-password');
      expect(h1).not.toBe(h2);
      expect(verifyPassword('same-password', h1)).toBe(true);
      expect(verifyPassword('same-password', h2)).toBe(true);
    });
  });

  describe('hashToken', () => {
    it('produces a sha256 hex string', () => {
      const hash = hashToken('bearer-token-123');
      expect(hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('is deterministic', () => {
      const h1 = hashToken('deterministic');
      const h2 = hashToken('deterministic');
      expect(h1).toBe(h2);
    });

    it('produces different hashes for different inputs', () => {
      const h1 = hashToken('input-a');
      const h2 = hashToken('input-b');
      expect(h1).not.toBe(h2);
    });
  });

  describe('mintTokenSecret', () => {
    it('produces a 64-char hex string', () => {
      const secret = mintTokenSecret();
      expect(secret).toMatch(/^[0-9a-f]{64}$/);
    });

    it('produces unique secrets', () => {
      const s1 = mintTokenSecret();
      const s2 = mintTokenSecret();
      expect(s1).not.toBe(s2);
    });
  });
});
