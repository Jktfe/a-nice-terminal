// ANT v3 — Server Hooks
// Handles WebSocket upgrades and middleware

import type { Handle } from '@sveltejs/kit';
import { wsHandler } from '$lib/server/ws-handler';

// Initialize WebSocket handler (wires PTY output to broadcast)
wsHandler.init();

export const handle: Handle = async ({ event, resolve }) => {
  // Tailscale IP check (optional — only enforce if ANT_TAILSCALE_ONLY is set)
  if (process.env.ANT_TAILSCALE_ONLY === 'true') {
    const ip = event.request.headers.get('x-forwarded-for') ||
               event.getClientAddress();
    const isTailscale = ip != null && (ip.startsWith('100.') || ip === '127.0.0.1' || ip === '::1');
    if (!isTailscale) {
      return new Response('Forbidden', { status: 403 });
    }
  }

  // API key check — enforced for external API calls only, not browser UI (same-origin)
  const apiKey = process.env.ANT_API_KEY;
  if (apiKey && event.url.pathname.startsWith('/api/')) {
    const origin = event.request.headers.get('origin');
    const isSameOrigin = origin === event.url.origin || !origin;
    if (!isSameOrigin) {
      const provided = event.request.headers.get('authorization')?.replace('Bearer ', '') ||
                       event.request.headers.get('x-api-key') ||
                       event.url.searchParams.get('apiKey');
      if (provided !== apiKey) {
        return new Response(JSON.stringify({ error: 'Invalid or missing API key' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        });
      }
    }
  }

  return resolve(event);
};

// Note: WebSocket upgrade handling depends on the runtime.
// With Bun, you'd handle it in the Bun.serve() config.
// With Node adapter, you'd attach to the httpServer in a custom server.
// Export the wsHandler for use in custom server setup:
export { wsHandler };
