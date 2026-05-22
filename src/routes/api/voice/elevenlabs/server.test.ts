import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { _resolveElevenLabsCachePath as resolveElevenLabsCachePath } from './+server';

let cacheDir = '';
const originalCacheDir = process.env.ANT_VOICE_CACHE_DIR;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), 'ant-voice-cache-'));
  process.env.ANT_VOICE_CACHE_DIR = cacheDir;
});

afterEach(() => {
  if (cacheDir) rmSync(cacheDir, { recursive: true, force: true });
  if (originalCacheDir === undefined) delete process.env.ANT_VOICE_CACHE_DIR;
  else process.env.ANT_VOICE_CACHE_DIR = originalCacheDir;
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
