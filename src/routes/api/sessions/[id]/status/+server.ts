import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';

// GET /api/sessions/:id/status
// Returns terminal cockpit status for a session while preserving the
// original needs_input/agent_status fields used by polling clients.

type SessionRow = Record<string, any>;

function parseMeta(meta: unknown): Record<string, unknown> {
  if (!meta) return {};
  if (typeof meta === 'object') return meta as Record<string, unknown>;
  try { return JSON.parse(String(meta)) as Record<string, unknown>; }
  catch { return {}; }
}

function publicSession(row: SessionRow | null | undefined) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    type: row.type,
    handle: row.handle ?? null,
    display_name: row.display_name ?? null,
    status: row.status ?? null,
    ttl: row.ttl ?? null,
    last_activity: row.last_activity ?? null,
    linked_chat_id: row.linked_chat_id ?? null,
    cli_flag: row.cli_flag ?? null,
    auto_forward_chat: row.auto_forward_chat ?? null,
  };
}

function resolveTerminalContext(session: SessionRow | null | undefined): {
  terminal: SessionRow | null;
  linkedChat: SessionRow | null;
} {
  if (!session) return { terminal: null, linkedChat: null };

  if (session.type === 'terminal') {
    return {
      terminal: session,
      linkedChat: session.linked_chat_id ? queries.getSession(session.linked_chat_id) as SessionRow | null : null,
    };
  }

  if (session.type === 'chat') {
    const meta = parseMeta(session.meta);
    const ownerId = typeof meta.auto_linked_terminal_id === 'string' ? meta.auto_linked_terminal_id : null;
    if (ownerId) {
      const terminal = queries.getSession(ownerId) as SessionRow | null;
      return { terminal, linkedChat: session };
    }

    const linkedTerminals = queries.getTerminalsByLinkedChat(session.id) as SessionRow[];
    if (linkedTerminals.length === 1) {
      return { terminal: linkedTerminals[0], linkedChat: session };
    }
  }

  return { terminal: null, linkedChat: session.type === 'chat' ? session : null };
}

export async function GET({ params }: RequestEvent<{ id: string }>) {
  const { getPendingEvent } = await import('$lib/server/agent-event-bus.js');
  const session = queries.getSession(params.id) as SessionRow | null;
  const { terminal, linkedChat } = resolveTerminalContext(session);
  const terminalId = terminal?.id ?? params.id;
  const status = getPendingEvent(terminalId);
  const mode = terminal
    ? (linkedChat ? 'private_terminal_input' : 'terminal')
    : (session?.type === 'chat' ? 'chatroom' : 'unknown');

  return json({
    ...status,
    session: publicSession(session),
    terminal: publicSession(terminal),
    linked_chat: publicSession(linkedChat),
    route: {
      mode,
      terminal_id: terminal?.id ?? null,
      linked_chat_id: linkedChat?.id ?? null,
      executes_in_terminal: !!terminal && !!linkedChat && terminal.auto_forward_chat !== 0,
    },
    capture: {
      status_source: status.agent_status ? 'driver_status_line' : 'none',
      interactive_source: status.needs_input ? 'agent_event_bus' : 'none',
      detected_at: status.agent_status?.detectedAt ?? null,
    },
  });
}
