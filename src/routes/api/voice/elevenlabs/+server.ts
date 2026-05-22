// ElevenLabs TTS proxy for the Interview-Lite voice mode (m3 a3-settings).
//
// Browser POSTs `{ text, voice_id?, model_id? }` here; the server holds the
// ELEVENLABS_API_KEY env var and pipes the audio response back to the client.
// Keeping the key server-side prevents quota theft from anyone snooping the
// network tab and keeps the secret out of client bundles.
//
// GET on the same URL returns availability so the UI can pick the right
// provider on load (interview-lite plan: global config, not per-user; no
// settings UI — just the env var).
//
// This file was ripped in commit e49f2c6 ("rip out interview + voice mode
// entirely") and revived for the interview-lite redesign. The shape is
// identical to the original; only the consumer changed (InterviewModal
// instead of the deleted VoiceModeBar).

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { resolveBrowserSessionSecretIgnoringRoom } from '$lib/server/browserSessionStore';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { homedir } from 'node:os';

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_DEFAULT_MODEL_ID || 'eleven_turbo_v2_5';
const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';
const DEFAULT_STAGE_PROVIDER = process.env.ANT_STAGE_VOICE_PROVIDER || 'elevenlabs';
const DEFAULT_STAGE_AUTOPLAY = process.env.ANT_STAGE_VOICE_AUTOPLAY !== 'false';

// SvelteKit only allows GET/POST/etc as named exports from +server.ts files.
// Helpers must be `_`-prefixed (or unexported). Prefixed so build passes;
// internal call site updated below. Codex's WIP — leaving function shape
// intact, just renaming the export.
export function _resolveElevenLabsCachePath(input: {
  text: string;
  voiceId: string;
  modelId: string;
}): { path: string; key: string } {
  const cacheRoot = process.env.ANT_VOICE_CACHE_DIR || join(homedir(), '.ant', 'cache', 'voice');
  mkdirSync(cacheRoot, { recursive: true });
  const key = createHash('sha256')
    .update(JSON.stringify({
      provider: 'elevenlabs',
      text: input.text,
      voiceId: input.voiceId,
      modelId: input.modelId
    }))
    .digest('hex');
  return { key, path: join(cacheRoot, `${key}.mp3`) };
}

function readCookie(request: Request, name: string): string | null {
  const header = request.headers.get('cookie');
  if (!header) return null;
  for (const part of header.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}

function requireBrowserSession(event: RequestEvent): void {
  // Gate the proxy behind any valid browser session — stops anonymous
  // abuse of the ELEVENLABS_API_KEY. Room-agnostic: TTS is global so
  // we don't need a room scope, just "is this a logged-in client".
  const cookie = readCookie(event.request, 'ant_browser_session');
  if (!cookie) throw error(403, 'Browser session required.');
  const resolved = resolveBrowserSessionSecretIgnoringRoom(cookie);
  if (!resolved) throw error(403, 'Invalid browser session.');
}

export function GET() {
  return json({
    available: !!process.env.ELEVENLABS_API_KEY,
    stage_provider: DEFAULT_STAGE_PROVIDER,
    stage_autoplay: DEFAULT_STAGE_AUTOPLAY,
    browser_fallback_allowed: DEFAULT_STAGE_PROVIDER === 'browser',
    default_voice_id: DEFAULT_VOICE_ID,
    default_model_id: DEFAULT_MODEL_ID,
  });
}

export async function POST(event: RequestEvent) {
  requireBrowserSession(event);

  const apiKey = process.env.ELEVENLABS_API_KEY;
  if (!apiKey) {
    throw error(503, 'ELEVENLABS_API_KEY not configured on the server');
  }

  let body: { text?: unknown; voice_id?: unknown; model_id?: unknown };
  try {
    body = await event.request.json();
  } catch {
    throw error(400, 'invalid JSON body');
  }

  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) throw error(400, 'text required');

  const voiceId = typeof body.voice_id === 'string' && body.voice_id ? body.voice_id : DEFAULT_VOICE_ID;
  const modelId = typeof body.model_id === 'string' && body.model_id ? body.model_id : DEFAULT_MODEL_ID;
  const cache = _resolveElevenLabsCachePath({ text, voiceId, modelId });

  if (existsSync(cache.path)) {
    const audio = await readFile(cache.path);
    return new Response(audio, {
      status: 200,
      headers: {
        'Content-Type': 'audio/mpeg',
        'Cache-Control': 'private, max-age=31536000, immutable',
        'X-ANT-Voice-Cache': 'hit',
        'X-ANT-Voice-Cache-Key': cache.key
      },
    });
  }

  const upstream = await fetch(`${ELEVENLABS_BASE}/text-to-speech/${encodeURIComponent(voiceId)}`, {
    method: 'POST',
    headers: {
      'xi-api-key': apiKey,
      'Content-Type': 'application/json',
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: modelId,
      voice_settings: {
        stability: 0.5,
        similarity_boost: 0.75,
      },
    }),
  });

  if (!upstream.ok) {
    const errBody = await upstream.text().catch(() => '');
    throw error(upstream.status, `ElevenLabs upstream: ${errBody.slice(0, 200) || upstream.statusText}`);
  }

  const audio = Buffer.from(await upstream.arrayBuffer());
  mkdirSync(dirname(cache.path), { recursive: true });
  await writeFile(cache.path, audio);

  return new Response(audio, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'private, max-age=31536000, immutable',
      'X-ANT-Voice-Cache': 'miss',
      'X-ANT-Voice-Cache-Key': cache.key
    },
  });
}
