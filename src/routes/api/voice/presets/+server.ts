import { error, json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { requireAdminAuth } from '$lib/server/chatInviteAuth';
import { listVoicePresets, saveVoicePreset } from '$lib/server/voicePresetStore';

export const GET: RequestHandler = ({ request }) => {
  requireAdminAuth(request);
  return json({ presets: listVoicePresets() });
};

export const POST: RequestHandler = async ({ request }) => {
  requireAdminAuth(request);
  const payload = (await request.json().catch(() => null)) as
    | {
        id?: unknown;
        name?: unknown;
        provider?: unknown;
        voiceId?: unknown;
        voice_id?: unknown;
        modelId?: unknown;
        model_id?: unknown;
        notes?: unknown;
        sampleText?: unknown;
        sample_text?: unknown;
      }
    | null;
  if (!payload) throw error(400, 'JSON body required.');

  try {
    const preset = saveVoicePreset({
      id: typeof payload.id === 'string' ? payload.id : null,
      name: typeof payload.name === 'string' ? payload.name : '',
      provider: typeof payload.provider === 'string' ? payload.provider : 'elevenlabs',
      voiceId: typeof payload.voiceId === 'string'
        ? payload.voiceId
        : (typeof payload.voice_id === 'string' ? payload.voice_id : ''),
      modelId: typeof payload.modelId === 'string'
        ? payload.modelId
        : (typeof payload.model_id === 'string' ? payload.model_id : null),
      notes: typeof payload.notes === 'string' ? payload.notes : null,
      sampleText: typeof payload.sampleText === 'string'
        ? payload.sampleText
        : (typeof payload.sample_text === 'string' ? payload.sample_text : null)
    });
    return json({ preset }, { status: 201 });
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    throw error(400, message);
  }
};
