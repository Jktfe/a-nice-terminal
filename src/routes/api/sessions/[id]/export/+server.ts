import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { maybeWriteSessionSummary } from '$lib/server/capture/obsidian-writer.js';

export async function POST({ params }: RequestEvent<{ id: string }>) {
  await maybeWriteSessionSummary(params.id);
  return json({ ok: true });
}
