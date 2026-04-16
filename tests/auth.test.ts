import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Test the auth logic extracted from hooks.server.ts
// We test the logic directly rather than importing the SvelteKit handle,
// since that requires the full SvelteKit runtime.

interface AuthCheck {
  tailscaleOnly: boolean;
  clientIp: string | null;
  pathname: string;
  apiKey: string | undefined;
  origin: string | null;
  urlOrigin: string;
  providedKey: string | null;
}

function checkTailscale(opts: { tailscaleOnly: boolean; clientIp: string | null }): 'pass' | 'forbidden' {
  if (!opts.tailscaleOnly) return 'pass';
  const ip = opts.clientIp;
  const isTailscale = ip != null && (ip.startsWith('100.') || ip === '127.0.0.1' || ip === '::1');
  return isTailscale ? 'pass' : 'forbidden';
}

function checkApiKey(opts: {
  apiKey: string | undefined;
  pathname: string;
  origin: string | null;
  urlOrigin: string;
  providedKey: string | null;
}): 'pass' | 'unauthorized' {
  if (!opts.apiKey) return 'pass';
  if (!opts.pathname.startsWith('/api/')) return 'pass';
  const isSameOrigin = opts.origin === opts.urlOrigin || !opts.origin;
  if (isSameOrigin) return 'pass';
  return opts.providedKey === opts.apiKey ? 'pass' : 'unauthorized';
}

describe('Tailscale IP gating', () => {
  it('allows any IP when tailscaleOnly is false', () => {
    expect(checkTailscale({ tailscaleOnly: false, clientIp: '192.168.1.1' })).toBe('pass');
  });

  it('allows Tailscale IPs (100.x.x.x)', () => {
    expect(checkTailscale({ tailscaleOnly: true, clientIp: '100.64.0.1' })).toBe('pass');
  });

  it('allows localhost IPv4', () => {
    expect(checkTailscale({ tailscaleOnly: true, clientIp: '127.0.0.1' })).toBe('pass');
  });

  it('allows localhost IPv6', () => {
    expect(checkTailscale({ tailscaleOnly: true, clientIp: '::1' })).toBe('pass');
  });

  it('rejects non-Tailscale IPs when enforced', () => {
    expect(checkTailscale({ tailscaleOnly: true, clientIp: '192.168.1.1' })).toBe('forbidden');
  });

  it('rejects null IP when enforced', () => {
    expect(checkTailscale({ tailscaleOnly: true, clientIp: null })).toBe('forbidden');
  });
});

describe('API key authentication', () => {
  const apiKey = 'test-secret-key-123';

  it('passes when no API key is configured', () => {
    expect(checkApiKey({
      apiKey: undefined,
      pathname: '/api/sessions',
      origin: 'https://evil.com',
      urlOrigin: 'https://localhost:6458',
      providedKey: null,
    })).toBe('pass');
  });

  it('passes for non-API routes', () => {
    expect(checkApiKey({
      apiKey,
      pathname: '/session/abc',
      origin: 'https://evil.com',
      urlOrigin: 'https://localhost:6458',
      providedKey: null,
    })).toBe('pass');
  });

  it('passes for same-origin requests (browser UI)', () => {
    expect(checkApiKey({
      apiKey,
      pathname: '/api/sessions',
      origin: 'https://localhost:6458',
      urlOrigin: 'https://localhost:6458',
      providedKey: null,
    })).toBe('pass');
  });

  it('passes for requests with no origin header (same-origin)', () => {
    expect(checkApiKey({
      apiKey,
      pathname: '/api/sessions',
      origin: null,
      urlOrigin: 'https://localhost:6458',
      providedKey: null,
    })).toBe('pass');
  });

  it('passes for cross-origin with correct key', () => {
    expect(checkApiKey({
      apiKey,
      pathname: '/api/sessions',
      origin: 'https://other.com',
      urlOrigin: 'https://localhost:6458',
      providedKey: apiKey,
    })).toBe('pass');
  });

  it('rejects cross-origin with wrong key', () => {
    expect(checkApiKey({
      apiKey,
      pathname: '/api/sessions',
      origin: 'https://other.com',
      urlOrigin: 'https://localhost:6458',
      providedKey: 'wrong-key',
    })).toBe('unauthorized');
  });

  it('rejects cross-origin with no key', () => {
    expect(checkApiKey({
      apiKey,
      pathname: '/api/sessions',
      origin: 'https://other.com',
      urlOrigin: 'https://localhost:6458',
      providedKey: null,
    })).toBe('unauthorized');
  });
});
