import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { getPendingPrompt } from '$lib/server/prompt-bridge.js';

export function GET({ params }: RequestEvent<{ id: string }>) {
  return json({
    pending: getPendingPrompt(params.id),
  });
}
