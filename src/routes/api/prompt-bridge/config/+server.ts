import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import {
  getPromptBridgeConfig,
  normalisePromptBridgeConfig,
  setPromptBridgeConfig,
} from '$lib/server/prompt-bridge.js';

export function GET() {
  return json({ config: getPromptBridgeConfig() });
}

export async function PUT({ request }: RequestEvent) {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }
  const current = getPromptBridgeConfig();
  const next = normalisePromptBridgeConfig({ ...current, ...(body?.config ?? body ?? {}) });
  return json({ config: setPromptBridgeConfig(next) });
}
