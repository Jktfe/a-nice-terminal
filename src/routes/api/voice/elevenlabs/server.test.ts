import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { POST, _resolveElevenLabsCachePath as resolveElevenLabsCachePath } from './+server';
import { resetIdentityDbForTests } from '$lib/server/db';
import { createChatRoom, resetChatRoomStoreForTests } from '$lib/server/chatRoomStore';
import { createDeck, resetDeckStoreForTests } from '$lib/server/deckStore';

let cacheDir = '';
const originalCacheDir = process.env.ANT_VOICE_CACHE_DIR;
const originalApiKey = process.env.ELEVENLABS_API_KEY;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'ant-voice-cache-'));
  process.env.ANT_VOICE_CACHE_DIR = cacheDir;
  process.env.ANT_FRESH_DB_PATH = ':memory:';
  process.env.ELEVENLABS_API_KEY = 'test-elevenlabs-key';
  resetIdentityDbForTests();
  resetChatRoomStoreForTests();
  resetDeckStoreForTests();
});

afterEach(() => {
  vi.unstubAllGlobals();
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  if (originalCacheDir === undefined) delete process.env.ANT_VOICE_CACHE_DIR;
  else process.env.ANT_VOICE_CACHE_DIR = originalCacheDir;
  if (originalApiKey === undefined) delete process.env.ELEVENLABS_API_KEY;
  else process.env.ELEVENLABS_API_KEY = originalApiKey;
});

describe('ElevenLabs voice cache', () => {
  it('keys cached audio by text, voice id, and model id without exposing text in the filename', async () => {
    const first = resolveElevenLabsCachePath({
      text: 'Explain the logic behind slide one.',
      voiceId: 'voice-a',
      modelId: 'model-a'
    });
    const second = resolveElevenLabsCachePath({
      text: 'Explain the logic behind slide one.',
      voiceId: 'voice-a',
      modelId: 'model-a'
    });
    const differentVoice = resolveElevenLabsCachePath({
      text: 'Explain the logic behind slide one.',
      voiceId: 'voice-b',
      modelId: 'model-a'
    });

    expect(first.path).toBe(second.path);
    expect(first.path).not.toBe(differentVoice.path);
    expect(first.path).toContain(cacheDir);
    expect(first.path).not.toContain('Explain');
  });

  it('creates the cache directory before returning the path', async () => {
    const nested = join(cacheDir, 'nested-cache');
    process.env.ANT_VOICE_CACHE_DIR = nested;

    const resolved = resolveElevenLabsCachePath({ text: 'hello', voiceId: 'v', modelId: 'm' });

    expect(existsSync(nested)).toBe(true);
    await readFile(resolved.path).catch((error: NodeJS.ErrnoException) => {
      expect(error.code).toBe('ENOENT');
    });
  });
});

async function runPost(body: Record<string, unknown>): Promise<Response> {
  const request = new Request('http://localhost/api/voice/elevenlabs', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body)
  });
  try {
    return (await POST({ request } as never)) as Response;
  } catch (thrown) {
    if (thrown instanceof Response) return thrown;
    const failure = thrown as { status?: number; body?: { message?: string } };
    if (typeof failure?.status === 'number') {
      return new Response(JSON.stringify(failure.body ?? {}), { status: failure.status });
    }
    throw thrown;
  }
}

describe('ElevenLabs voice access', () => {
  it('allows password-deck Stage viewers to generate audio without a browser session', async () => {
    const room = createChatRoom({ name: 'stage voice', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Safari voice deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Visible', speakerNotes: 'Narration' }]
    });
    vi.stubGlobal('fetch', vi.fn(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { 'content-type': 'audio/mpeg' }
      })
    ));

    const response = await runPost({
      text: 'Narration',
      deck_id: deck.id,
      deck_password: 'stage-demo'
    });

    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('audio/mpeg');
    expect(await response.arrayBuffer()).toHaveProperty('byteLength', 3);
    expect(fetch).toHaveBeenCalledOnce();
    expect((fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0][0]).toBe(
      'https://api.elevenlabs.io/v1/text-to-speech/41b1bEgfCyhbIxCRSOh7'
    );
  });

  it('rejects a wrong deck password before calling ElevenLabs', async () => {
    const room = createChatRoom({ name: 'stage voice', whoCreatedIt: '@you' });
    const deck = createDeck({
      roomId: room.id,
      title: 'Safari voice deck',
      accessPassword: 'stage-demo',
      slides: [{ id: 's1', title: 'Slide 1', content: 'Visible', speakerNotes: 'Narration' }]
    });
    vi.stubGlobal('fetch', vi.fn());

    const response = await runPost({
      text: 'Narration',
      deck_id: deck.id,
      deck_password: 'wrong'
    });

    expect(response.status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });
});
