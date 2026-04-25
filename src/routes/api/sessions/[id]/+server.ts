import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';
import { autoLinkedTerminalId, isAutoLinkedChatForTerminal } from '$lib/server/linked-chat';
import { SESSIONS_CHANNEL } from '$lib/ws-channels';
import { buildLinkedChatName, normalizeSessionName } from '$lib/utils/session-naming';

function findConflictingSession(name: string, excludeIds: string[] = []) {
  const comparable = normalizeSessionName(name).toLowerCase();
  return queries.listSessions().find((session: any) => {
    if (excludeIds.includes(session.id)) return false;
    return normalizeSessionName(session.name).toLowerCase() === comparable;
  });
}

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  return json(session);
}

export async function PATCH({ params, request }: RequestEvent<{ id: string }>) {
  const currentSession = queries.getSession(params.id);
  if (!currentSession) throw error(404, 'Session not found');

  const body = await request.json();
  const nextName = typeof body.name === 'string' ? normalizeSessionName(body.name) : null;
  if (body.name !== undefined && !nextName) {
    return json({ error: 'Session name is required' }, { status: 400 });
  }

  let autoLinkedChat: any | null = null;
  if (currentSession.type === 'terminal' && currentSession.linked_chat_id) {
    const linkedChat = queries.getSession(currentSession.linked_chat_id);
    if (linkedChat && isAutoLinkedChatForTerminal((linkedChat as any).meta, params.id)) {
      autoLinkedChat = linkedChat;
    }
  }

  if (nextName && nextName !== currentSession.name) {
    const conflictingSession = findConflictingSession(nextName, [params.id]);
    if (conflictingSession) {
      return json({ error: `"${nextName}" already exists` }, { status: 409 });
    }
    if (autoLinkedChat) {
      const linkedChatName = buildLinkedChatName(nextName);
      const conflictingLinkedChat = findConflictingSession(linkedChatName, [autoLinkedChat.id]);
      if (conflictingLinkedChat) {
        return json({ error: `"${linkedChatName}" already exists` }, { status: 409 });
      }
    }
  }

  if (body.ttl) {
    queries.updateTtl(body.ttl, params.id);
  }
  if (nextName || body.status || body.archived !== undefined || body.meta !== undefined) {
    queries.updateSession(
      nextName || null,
      body.status || null,
      body.archived !== undefined ? (body.archived ? 1 : 0) : null,
      body.meta !== undefined
        ? (typeof body.meta === 'string' ? body.meta : JSON.stringify(body.meta))
        : null,
      params.id
    );
  }
  if (body.linked_chat_id !== undefined) {
    const nextLinkedChatId = body.linked_chat_id || null;
    queries.setLinkedChat(params.id, nextLinkedChatId);
    if (
      currentSession.type === 'terminal' &&
      autoLinkedChat &&
      nextLinkedChatId !== autoLinkedChat.id
    ) {
      queries.updateSession(null, null, 1, null, autoLinkedChat.id);
    }
  }
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');

  if (nextName && nextName !== currentSession.name && autoLinkedChat) {
    queries.updateSession(buildLinkedChatName(nextName), null, null, null, autoLinkedChat.id);
  }

  // Auto-export to memory palace when a session is archived
  if (body.archived === true) {
    const { maybeWriteSessionSummary } = await import('$lib/server/capture/obsidian-writer.js');
    // Export this session
    maybeWriteSessionSummary(params.id);
    // Also export its linked chat (or if this is a chat, export linked terminals)
    if ((session as any).linked_chat_id) {
      maybeWriteSessionSummary((session as any).linked_chat_id);
    } else {
      // This might be a chat — find any terminals that link to it and export them too
      const linkedTerminals = queries.getTerminalsByLinkedChat(params.id) as any[];
      for (const t of linkedTerminals) {
        maybeWriteSessionSummary(t.id);
      }
    }

    // Cascade archive only across the private terminal <-> auto-linked chat
    // pair. Shared chatrooms can have many participants and must not archive
    // terminals just because they appear in room routing.
    if ((session as any).type === 'terminal' && autoLinkedChat) {
      queries.updateSession(null, null, 1, null, autoLinkedChat.id);
    } else if ((session as any).type === 'chat') {
      const terminalId = autoLinkedTerminalId((session as any).meta);
      const terminal = terminalId ? queries.getSession(terminalId) as any : null;
      if (terminal?.type === 'terminal') {
        maybeWriteSessionSummary(terminal.id);
        queries.updateSession(null, null, 1, null, terminal.id);
        const { ptyClient } = await import('$lib/server/pty-client.js');
        ptyClient.kill(terminal.id);
      }
    }

    // Tear down the live PTY + tmux session now that the summary is captured.
    // Without this, archive leaves the tmux session + its zsh/claude child
    // running forever — the daemon doesn't prune on archive. Must run *after*
    // maybeWriteSessionSummary above, which reads from the live tmux pane.
    if ((session as any).type === 'terminal') {
      const { ptyClient } = await import('$lib/server/pty-client.js');
      ptyClient.kill(params.id);
    }
  }

  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });

  return json(session);
}

// Soft-delete: marks deleted_at, PTY keeps running, recoverable within TTL window
export async function DELETE({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  queries.softDeleteSession(params.id);
  const { broadcast } = await import('$lib/server/ws-broadcast.js');
  broadcast(SESSIONS_CHANNEL, { type: 'sessions_changed' });
  return new Response(null, { status: 204 });
}
