// POST /api/sessions/:id/start-interview
//
// Multi-participant interview entry point (redesigned 2026-05-07). The :id
// path-param is the *primary* invitee terminal — for backward compat with the
// mic-icon flow that POSTs to a single terminal. Additional participants can
// be passed in the body. The route layer owns:
//   1. Calling the helper (creates chat + optional seed-message copy).
//   2. Pre-inviting each participant via the existing terminal-input path
//      (mirrors what addTerminalToRoom does in the chat UI).
// The helper itself is pure DI (no PTY access) — pre-invitation lives here.
//
// Request body:
//   {
//     origin_room_id?: string | null,
//     caller_handle?:  string | null,
//     seed_message_id?: string,        // optional — copy a message into the new chat
//     seed_text?:      string,         // optional — inline text seed (mutex with seed_message_id)
//     participants?:   string[]        // optional — additional terminal session IDs
//   }
//
// Response:
//   { ok: true, chat_id, chat_name, participants_invited, seed_posted, invite_failures? }
//   or  { ok: false, error: 'target_not_found' | 'invalid_target_type' }   (with HTTP status)

import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { startInterview } from '$lib/server/interview/start-interview.js';

interface InviteFailure {
  session_id: string;
  status: number | null;
  error: string;
}

async function inviteTerminal(
  fetchFn: typeof fetch,
  origin: string,
  terminalSessionId: string,
  newChatId: string,
  newChatName: string,
): Promise<InviteFailure | null> {
  // Mirrors addTerminalToRoom in src/routes/session/[id]/+page.svelte:632 —
  // shells `ant chat send <chat-id> --msg "..."` into the terminal so the
  // agent sees a join notification it can react to.
  try {
    const res = await fetchFn(`${origin}/api/sessions/${encodeURIComponent(terminalSessionId)}/terminal/input`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `ant chat send ${newChatId} --msg "Hello — you've been invited to ${newChatName}. Reply here to join the conversation."\n`,
      }),
    });
    if (!res.ok) {
      return {
        session_id: terminalSessionId,
        status: res.status,
        error: `terminal/input ${res.status}`,
      };
    }
    return null;
  } catch (e) {
    return {
      session_id: terminalSessionId,
      status: null,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

export async function POST(event: RequestEvent) {
  const { params, request, fetch: fetchFn, url } = event;
  const targetSessionId = params.id!;
  const body = await request.json().catch(() => ({}));

  const seed_message_id = typeof body?.seed_message_id === 'string' && body.seed_message_id.trim()
    ? body.seed_message_id
    : null;
  const seed_text = typeof body?.seed_text === 'string' && body.seed_text.trim()
    ? body.seed_text
    : null;
  const participants = Array.isArray(body?.participants)
    ? body.participants.filter((p: unknown): p is string => typeof p === 'string' && p.length > 0)
    : [];

  const result = startInterview(queries as any, targetSessionId, {
    origin_room_id: typeof body?.origin_room_id === 'string' ? body.origin_room_id : null,
    caller_handle:  typeof body?.caller_handle  === 'string' ? body.caller_handle  : null,
    seed_message_id,
    seed_text,
    participants,
  });

  if (!result.ok) {
    if (result.error === 'target_not_found')   throw error(404, 'Target session not found');
    if (result.error === 'invalid_target_type') throw error(400, 'Target session is not a terminal/chat/agent');
    // Should be unreachable — the union above is exhaustive — but guards
    // against future error variants accidentally falling through.
    throw error(500, `Unhandled start-interview error: ${(result as { error: string }).error}`);
  }

  // Pre-invite every participant terminal (best-effort; failures are reported
  // but don't fail the whole request — the chat still exists and the user can
  // re-invite from the participants strip).
  const invite_failures: InviteFailure[] = [];
  for (const sessionId of result.participants_invited) {
    const target = queries.getSession(sessionId);
    if (!target) continue;
    if (target.type !== 'terminal') continue;  // only PTY-backed terminals get the join command
    const failure = await inviteTerminal(fetchFn, url.origin, sessionId, result.chat_id, result.chat_name);
    if (failure) invite_failures.push(failure);
  }

  return json({
    ...result,
    invite_failures: invite_failures.length > 0 ? invite_failures : undefined,
  });
}
