// ElevenLabs TTS proxy.
//
// Browser POSTs `{ text, voice_id?, model_id? }` here; the server holds the
// ELEVENLABS_API_KEY env var and pipes the audio response back to the client.
// Keeping the key server-side prevents quota theft from anyone snooping the
// network tab and keeps the secret out of client bundles.
//
// GET on the same URL returns availability so the UI can render a "configure
// ELEVENLABS_API_KEY to use" hint without the user having to attempt a TTS
// call to find out it's not wired up.

import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { assertCanWrite } from '$lib/server/room-scope';

// Default voice — ElevenLabs "Rachel" (English, female, conversational).
// Change via env or per-request body if a different default is preferred.
const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';

// `eleven_turbo_v2_5` is the latency-optimised model — best for interactive
// back-and-forth where ms-of-first-audio matters more than fidelity. Bump to
// `eleven_multilingual_v2` for higher quality at the cost of latency.
const DEFAULT_MODEL_ID = process.env.ELEVENLABS_DEFAULT_MODEL_ID || 'eleven_turbo_v2_5';

const ELEVENLABS_BASE = 'https://api.elevenlabs.io/v1';

export function GET() {
  return json({
    available: !!process.env.ELEVENLABS_API_KEY,
    default_voice_id: DEFAULT_VOICE_ID,
    default_model_id: DEFAULT_MODEL_ID,
  });
}

export async function POST(event: RequestEvent) {
  assertCanWrite(event);

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
      // Conservative defaults — high stability + similarity gives consistent
      // voice across calls. Tune via env if you want more expressiveness.
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

  // Stream the audio back. Setting Cache-Control: no-store because each
  // utterance is one-shot — the client revokes the blob URL after playback.
  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
