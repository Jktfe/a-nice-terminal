// POST /api/channel/register — register a channel handle → port mapping
// DELETE /api/channel/register?handle=@claude — deregister a channel
//
// Used by ant-channel.ts (and future MCP channel servers) to announce
// themselves so the message router can deliver @mention messages.

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { queries } from '$lib/server/db';

export const POST: RequestHandler = async ({ request }) => {
  try {
    const body = await request.json();
    const { handle, port, session_id } = body as {
      handle?: string;
      port?: number;
      session_id?: string;
    };

    if (!handle || typeof handle !== 'string') {
      return json({ error: 'handle is required (string)' }, { status: 400 });
    }
    if (!port || typeof port !== 'number') {
      return json({ error: 'port is required (number)' }, { status: 400 });
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
