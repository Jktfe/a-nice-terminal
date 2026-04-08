import { json, error } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db';

export function GET({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  return json(session);
}

export async function PATCH({ params, request }: RequestEvent<{ id: string }>) {
  const body = await request.json();
  if (body.ttl) {
    queries.updateTtl(body.ttl, params.id);
  }
  if (body.name || body.status || body.archived !== undefined || body.meta) {
    queries.updateSession(
      body.name || null,
      body.status || null,
      body.archived !== undefined ? (body.archived ? 1 : 0) : null,
      body.meta ? JSON.stringify(body.meta) : null,
      params.id
    );
  }
  if (body.linked_chat_id !== undefined) {
    queries.setLinkedChat(params.id, body.linked_chat_id);
  }
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');

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
  }

  return json(session);
}

// Soft-delete: marks deleted_at, PTY keeps running, recoverable within TTL window
export function DELETE({ params }: RequestEvent<{ id: string }>) {
  const session = queries.getSession(params.id);
  if (!session) throw error(404, 'Session not found');
  queries.softDeleteSession(params.id);
  return new Response(null, { status: 204 });
}
