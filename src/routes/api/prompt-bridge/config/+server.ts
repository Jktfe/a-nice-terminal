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
  const body = await request.json();
  const current = getPromptBridgeConfig();
  const next = normalisePromptBridgeConfig({ ...current, ...(body?.config ?? body ?? {}) });
  return json({ config: setPromptBridgeConfig(next) });
}
