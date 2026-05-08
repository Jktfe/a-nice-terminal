import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import {
  BrowserTTSProvider,
  ElevenLabsTTSProvider,
  makeTTSProvider,
  resolvePreferredProvider,
} from '../src/lib/voice/interview-tts';

// These tests pin the provider abstraction's *contract* — no real
// network, no real speech synthesis. The integration with the modal
// is verified via Chrome smoke separately.

describe('makeTTSProvider', () => {
  it('returns BrowserTTSProvider for "browser"', () => {
    const p = makeTTSProvider('browser');
    expect(p.name).toBe('browser');
  });
  it('returns ElevenLabsTTSProvider for "elevenlabs"', () => {
    const p = makeTTSProvider('elevenlabs');
    expect(p.name).toBe('elevenlabs');
  });
});

describe('BrowserTTSProvider', () => {
  it('reports unavailable when window.speechSynthesis is missing', () => {
    const p = new BrowserTTSProvider();
    // jsdom-free vitest config — window doesn't exist in test env
    expect(p.available()).toBe(false);
  });

  it('returns a no-op handle when unavailable so callers can drop null-guards', () => {
    const p = new BrowserTTSProvider();
    const handle = p.speak('hello');
    expect(typeof handle.cancel).toBe('function');
    expect(handle.cancel).not.toThrow();
    // Browser TTS never exposes a cacheable URL, so audioUrl resolves
    // to null even when the provider is available — the consumer uses
    // that as a "this provider can't be cached" signal.
  });

  it('audioUrl always resolves to null (no cacheable blob)', async () => {
    const p = new BrowserTTSProvider();
    const handle = p.speak('hi');
    await expect(handle.audioUrl()).resolves.toBeNull();
  });
});

describe('ElevenLabsTTSProvider availability', () => {
  let originalFetch: typeof fetch | undefined;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete (globalThis as Record<string, unknown>).fetch;
  });

  it('returns false when /api/voice/elevenlabs reports available:false', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: false }),
    } as unknown as Response);
    const p = new ElevenLabsTTSProvider();
    await expect(p.available()).resolves.toBe(false);
  });

  it('returns true when /api/voice/elevenlabs reports available:true', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true }),
    } as unknown as Response);
    const p = new ElevenLabsTTSProvider();
    await expect(p.available()).resolves.toBe(true);
  });

  it('caches the availability check (single fetch across multiple calls)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true }),
    } as unknown as Response);
    globalThis.fetch = fetchMock;
    const p = new ElevenLabsTTSProvider();
    await p.available();
    await p.available();
    await p.available();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('returns false on fetch error (network/cors/server-down)', async () => {
    globalThis.fetch = vi.fn().mockRejectedValue(new Error('network'));
    const p = new ElevenLabsTTSProvider();
    await expect(p.available()).resolves.toBe(false);
  });

  it('returns false when the GET endpoint returns non-2xx', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);
    const p = new ElevenLabsTTSProvider();
    await expect(p.available()).resolves.toBe(false);
  });
});

describe('resolvePreferredProvider', () => {
  let originalFetch: typeof fetch | undefined;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => {
    if (originalFetch) globalThis.fetch = originalFetch;
    else delete (globalThis as Record<string, unknown>).fetch;
  });

  it('picks ElevenLabs when the global config exposes it', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: true }),
    } as unknown as Response);
    // resolvePreferredProvider short-circuits to BrowserTTSProvider when
    // window is undefined, so we synth a minimal window here.
    (globalThis as Record<string, unknown>).window = {};
    const provider = await resolvePreferredProvider();
    expect(provider.name).toBe('elevenlabs');
    delete (globalThis as Record<string, unknown>).window;
  });

  it('falls back to BrowserTTSProvider when ElevenLabs reports unavailable', async () => {
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ available: false }),
    } as unknown as Response);
    (globalThis as Record<string, unknown>).window = {};
    const provider = await resolvePreferredProvider();
    expect(provider.name).toBe('browser');
    delete (globalThis as Record<string, unknown>).window;
  });

  it('falls back to BrowserTTSProvider on the server (no window)', async () => {
    const provider = await resolvePreferredProvider();
    expect(provider.name).toBe('browser');
  });
});
