import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { buildAutoLinkedChatMeta } from '$lib/server/linked-chat';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';
import { buildLinkedChatName, normalizeSessionName } from '$lib/utils/session-naming';
import { nanoid } from 'nanoid';

/** Derive a handle-safe alias from a session name. */
function deriveAlias(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/** Auto-assign a unique handle to a session, derived from its name. */
function autoAssignHandle(sessionId: string, name: string): void {
  const base = deriveAlias(name);
  if (!base) return;
  for (let i = 0; i < 10; i++) {
    const candidate = i === 0 ? base : `${base}-${i + 1}`;
    const existing = queries.getSessionByHandle(`@${candidate}`);
    if (!existing || existing.id === sessionId) {
      queries.setAlias(sessionId, candidate);
      return;
    }
  }
}

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

  // Auto-assign handle for terminals (and their linked chats)
  if (type === 'terminal') {
    try { autoAssignHandle(id, normalizedName); } catch {}

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
    try { autoAssignHandle(chatId, linkedChatName); } catch {}
  }

  const session = queries.getSession(id);
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });
  void import('$lib/server/capture/registry-writer.js').then((m) => m.scheduleRegistryUpdate());
  return json(session, { status: 201 });
}
