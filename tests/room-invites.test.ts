import { describe, it, expect } from 'vitest';
import {
  hashPassword,
  verifyPassword,
  parseKinds,
  serializeKinds,
  mintToken,
  hashToken,
} from '../src/lib/server/room-invites';

describe('hashPassword + verifyPassword', () => {
  it('verifies a freshly hashed password', () => {
    const stored = hashPassword('correct horse battery staple');
    expect(verifyPassword('correct horse battery staple', stored)).toBe(true);
  });

  it('rejects the wrong password', () => {
    const stored = hashPassword('alpha');
    expect(verifyPassword('beta', stored)).toBe(false);
  });

  it('rejects an empty password against a real hash', () => {
    const stored = hashPassword('something');
    expect(verifyPassword('', stored)).toBe(false);
  });

  it('rejects a malformed stored hash', () => {
    expect(verifyPassword('anything', 'not$even$close')).toBe(false);
  });

  it('rejects garbage in the stored hash without throwing', () => {
    expect(verifyPassword('anything', '')).toBe(false);
    expect(verifyPassword('anything', 'plain-text')).toBe(false);
  });

  it('produces a different hash each time (random salt)', () => {
    const a = hashPassword('same');
    const b = hashPassword('same');
    expect(a).not.toBe(b);
    expect(verifyPassword('same', a)).toBe(true);
    expect(verifyPassword('same', b)).toBe(true);
  });

  it('throws on too-short passwords', () => {
    expect(() => hashPassword('abc')).toThrow();
  });

  it('encodes the scrypt parameters in the stored format', () => {
    const stored = hashPassword('whatever');
    expect(stored.startsWith('scrypt$')).toBe(true);
    const parts = stored.split('$');
    expect(parts.length).toBe(6);
    expect(parts[0]).toBe('scrypt');
    expect(Number(parts[1])).toBeGreaterThan(0); // N
    expect(Number(parts[2])).toBeGreaterThan(0); // r
    expect(Number(parts[3])).toBeGreaterThan(0); // p
  });
});

describe('parseKinds', () => {
  it('returns [] for null/undefined/empty', () => {
    expect(parseKinds(null)).toEqual([]);
    expect(parseKinds(undefined)).toEqual([]);
    expect(parseKinds('')).toEqual([]);
  });

  it('parses a single valid kind', () => {
    expect(parseKinds('cli')).toEqual(['cli']);
  });

  it('parses multiple kinds in order', () => {
    expect(parseKinds('cli,mcp,web')).toEqual(['cli', 'mcp', 'web']);
  });

  it('trims whitespace around each kind', () => {
    expect(parseKinds(' cli , mcp ')).toEqual(['cli', 'mcp']);
  });

  it('drops unknown kinds silently', () => {
    expect(parseKinds('cli,rss,mcp')).toEqual(['cli', 'mcp']);
  });

  it('drops every entry if all are unknown', () => {
    expect(parseKinds('rss,xml')).toEqual([]);
  });
});

describe('serializeKinds', () => {
  it('returns the all-kinds default when input is undefined', () => {
    expect(serializeKinds(undefined)).toBe('cli,mcp,web');
  });

  it('returns the all-kinds default when input is empty', () => {
    expect(serializeKinds([])).toBe('cli,mcp,web');
  });

  it('serializes a single kind', () => {
    expect(serializeKinds(['cli'])).toBe('cli');
  });

  it('deduplicates repeated kinds', () => {
    expect(serializeKinds(['cli', 'cli', 'mcp'])).toBe('cli,mcp');
  });

  it('falls back to default if all entries are invalid (defensive)', () => {
    expect(serializeKinds(['nope' as any])).toBe('cli,mcp,web');
  });
});

describe('mintToken + hashToken', () => {
  it('mints a plaintext that begins with the ant_t_ prefix', () => {
    const { plaintext } = mintToken();
    expect(plaintext.startsWith('ant_t_')).toBe(true);
  });

  it('mint returns a SHA-256 hash that matches hashToken on the plaintext', () => {
    const { plaintext, hash } = mintToken();
    expect(hashToken(plaintext)).toBe(hash);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different plaintexts on each mint', () => {
    const a = mintToken();
    const b = mintToken();
    expect(a.plaintext).not.toBe(b.plaintext);
    expect(a.hash).not.toBe(b.hash);
  });

  it('hashToken is deterministic for the same input', () => {
    expect(hashToken('ant_t_fixed')).toBe(hashToken('ant_t_fixed'));
  });
});
