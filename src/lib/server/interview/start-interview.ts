// Interview Mode — Start Interview
//
// M2 #1: clicking "Start interview" on an agent card, or @-mentioning an agent
// with the interview prefix in a room, creates (or focuses) a linked side chat
// between the human caller and the agent. The wire side of M2 #1 — pure, DI-
// friendly, no direct db imports so tests can pass a fake queries object.
//
// The route layer (POST /api/sessions/:id/start-interview) and the agent-card
// UI button both call this helper. "Created" vs "focused" lets the UI decide
// whether to navigate-or-focus the existing chat instead of opening a new one.

export interface StartInterviewQueries {
  getSession: (id: string) => any;
  createSession: (
    id: string,
    name: string,
    type: string,
    ttl: string,
    workspaceId: string | null,
    rootDir: string | null,
    meta: string,
  ) => any;
  setLinkedChat: (sessionId: string, chatId: string) => any;
}

export interface StartInterviewOpts {
  origin_room_id?: string | null;
  caller_handle?: string | null;
}

export type StartInterviewResult =
  | { ok: true; created: true;  linked_chat_id: string; target_session_id: string; chat_name: string }
  | { ok: true; created: false; linked_chat_id: string; target_session_id: string }
  | { ok: false; error: 'target_not_found' | 'invalid_target_type' };

const VALID_TARGET_TYPES = new Set(['terminal', 'chat', 'agent']);

function defaultIdGen(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function startInterview(
  q: StartInterviewQueries,
  targetSessionId: string,
  opts: StartInterviewOpts = {},
  idGen: () => string = defaultIdGen,
  nowMs: () => number = () => Date.now(),
): StartInterviewResult {
  const target = q.getSession(targetSessionId);
  if (!target) return { ok: false, error: 'target_not_found' };
  if (!VALID_TARGET_TYPES.has(target.type)) return { ok: false, error: 'invalid_target_type' };

  if (target.linked_chat_id) {
    return {
      ok: true,
      created: false,
      linked_chat_id: target.linked_chat_id,
      target_session_id: targetSessionId,
    };
  }

  const chatId = idGen();
  const displayName = target.display_name || target.name || target.handle || 'agent';
  const chatName = `Interview: ${displayName}`;
  const meta = JSON.stringify({
    interview: true,
    origin_room_id: opts.origin_room_id ?? null,
    caller_handle: opts.caller_handle ?? null,
    started_at_ms: nowMs(),
  });
  q.createSession(chatId, chatName, 'chat', 'forever', null, null, meta);
  q.setLinkedChat(targetSessionId, chatId);
  return {
    ok: true,
    created: true,
    linked_chat_id: chatId,
    target_session_id: targetSessionId,
    chat_name: chatName,
  };
}
