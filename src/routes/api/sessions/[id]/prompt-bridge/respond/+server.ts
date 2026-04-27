import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { respondToPrompt } from '$lib/server/prompt-bridge.js';

export async function POST({ params, request }: RequestEvent<{ id: string }>) {
  const { text, response, enter } = await request.json();
  const value = typeof response === 'string' ? response : text;
  if (!value || typeof value !== 'string') {
    return json({ ok: false, error: 'text must be a non-empty string' }, { status: 400 });
  }

  const prompt = await respondToPrompt(params.id, value, { enter: enter !== false });
  return json({ ok: true, prompt });
}
