// POST /api/channel/register — register a channel handle → port mapping
// DELETE /api/channel/register?handle=@claude — deregister a channel
//
// Used by ant-channel.ts (and future MCP channel servers) to announce
// themselves so the message router can deliver @mention messages.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { queries } from '$lib/server/db';

function cleanString(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export const POST: RequestHandler = async ({ request }) => {
  let body: any;
  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON' }, { status: 400 });
  }

  try {
    const handle = cleanString(body?.handle);
    const port = body?.port;
    const session_id = cleanString(body?.session_id);

    if (!handle) {
      return json({ error: 'handle is required (string)' }, { status: 400 });
    }
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      return json({ error: 'port must be an integer from 1 to 65535' }, { status: 400 });
    }

    queries.registerChannel(handle, port, session_id || null);
    console.log(`[channel-registry] registered ${handle} on port ${port}${session_id ? ` (session ${session_id})` : ''}`);

    return json({ ok: true });
  } catch (e: any) {
    console.error('[channel-registry] POST error:', e);
    return json({ error: e?.message || 'internal error' }, { status: 500 });
  }
};

export const DELETE: RequestHandler = async ({ url }) => {
  try {
    const handle = url.searchParams.get('handle');

    if (!handle) {
      return json({ error: 'handle query param is required' }, { status: 400 });
    }

    queries.deregisterChannel(handle);
    console.log(`[channel-registry] deregistered ${handle}`);

    return json({ ok: true });
  } catch (e: any) {
    console.error('[channel-registry] DELETE error:', e);
    return json({ error: e?.message || 'internal error' }, { status: 500 });
  }
};
