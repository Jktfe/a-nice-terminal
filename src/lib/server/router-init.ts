// ANT v3 — Router Initialisation
//
// Creates the MessageRouter singleton and registers all 4 delivery adapters.
// Called once from server.ts at startup. Uses getRouter() which is backed by
// globalThis to survive Vite module duplication.

import { getRouter } from './message-router.js';
import { WsBroadcastAdapter } from './adapters/ws-broadcast-adapter.js';
import { PtyInjectionAdapter } from './adapters/pty-injection-adapter.js';
import { McpChannelAdapter } from './adapters/mcp-channel-adapter.js';
import { LinkedChatAdapter } from './adapters/linked-chat-adapter.js';

let initialised = false;

export function initRouter(): void {
  if (initialised) return;
  initialised = true;

  const router = getRouter();
  router.register(new WsBroadcastAdapter());
  router.register(new PtyInjectionAdapter());
  router.register(new McpChannelAdapter());
  router.register(new LinkedChatAdapter());

  console.log('[message-router] initialised with 4 adapters');
}
