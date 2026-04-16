import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { buildAutoLinkedChatMeta } from '$lib/server/linked-chat';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';
import { buildLinkedChatName, normalizeSessionName } from '$lib/utils/session-naming';
import { nanoid } from 'nanoid';

function findConflictingSession(name: string, excludeIds: string[] = []) {
  const comparable = normalizeSessionName(name).toLowerCase();
  return queries.listSessions().find((session: any) => {
    if (excludeIds.includes(session.id)) return false;
    return normalizeSessionName(session.name).toLowerCase() === comparable;
  });
}

export function GET() {
  const sessions = queries.listSessions();
  const recoverable = queries.listRecoverable();
  return json({ sessions, recoverable });
}

export async function POST({ request }: RequestEvent) {
  const { name, type, ttl = '15m', workspace_id, root_dir, meta } = await request.json();
  const normalizedName = normalizeSessionName(name ?? '');
  if (!normalizedName) {
    return json({ error: 'Session name is required' }, { status: 400 });
  }
  const conflictingSession = findConflictingSession(normalizedName);
  if (conflictingSession) {
    return json({ error: `"${normalizedName}" already exists` }, { status: 409 });
  }
  if (type === 'terminal') {
    const linkedChatName = buildLinkedChatName(normalizedName);
    const conflictingLinkedChat = findConflictingSession(linkedChatName);
    if (conflictingLinkedChat) {
      return json({ error: `"${linkedChatName}" already exists` }, { status: 409 });
    }
  }

  const metaJson = typeof meta === 'string' ? meta : JSON.stringify(meta ?? {});
  const id = nanoid();
  queries.createSession(id, normalizedName, type, ttl, workspace_id || null, root_dir || null, metaJson);

  if (type === 'terminal') {
    const linkedChatName = buildLinkedChatName(normalizedName);
    const chatId = nanoid();
    queries.createSession(
      chatId,
      linkedChatName,
      'chat',
      ttl,
      workspace_id || null,
      root_dir || null,
      JSON.stringify(buildAutoLinkedChatMeta(id))
    );
    queries.setLinkedChat(id, chatId);
  }

  const session = queries.getSession(id);
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });
  return json(session, { status: 201 });
}
