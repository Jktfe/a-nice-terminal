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
import { assertCanWrite } from '$lib/server/room-scope';

const DEFAULT_VOICE_ID = process.env.ELEVENLABS_DEFAULT_VOICE_ID || '21m00Tcm4TlvDq8ikWAM';
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

  return new Response(upstream.body, {
    status: 200,
    headers: {
      'Content-Type': 'audio/mpeg',
      'Cache-Control': 'no-store',
    },
  });
}
