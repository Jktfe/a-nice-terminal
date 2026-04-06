import { json, error } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { nanoid } from 'nanoid';

export function GET({ params, url }) {
  const since = url.searchParams.get('since');
  const limit = parseInt(url.searchParams.get('limit') || '50');

  let messages;
  if (since) {
    messages = queries.getMessagesSince(params.id, since, limit);
  } else {
    messages = queries.listMessages(params.id);
  }
  return json({ messages });
}

export async function POST({ params, request }) {
  const { role, content, format } = await request.json();
  const id = nanoid();
  queries.createMessage(id, params.id, role, content, format || 'text', 'complete', '{}');

  // Update session timestamp
  queries.updateSession(null, null, null, null, params.id);

  return json({ id, session_id: params.id, role, content, format: format || 'text', status: 'complete' }, { status: 201 });
}
