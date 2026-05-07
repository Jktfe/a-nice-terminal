// Interview Mode — Start Interview (multi-participant redesign 2026-05-07)
//
// Creates a fresh, independent chatroom seeded with optional context. Unlike
// the original 2026-04-xx implementation, this version does NOT set
// linked_chat_id on the target — interview is no longer a 1:1 pairing. The
// new chat carries `meta.interview = true` plus optional seed metadata and
// a `participants_seed` audit trail. The route layer is responsible for
// pre-inviting participants via the existing chat-injection adapter; this
// helper just creates the chat and (optionally) copies the seed message.
//
// DI-friendly: queries are passed in so tests don't need a real db.

export interface CreateMessageInput {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  msgType?: string;
  meta?: string | null;
  senderId?: string | null;
}

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
  // Optional — used only when opts.seed_message_id is set. Helper gracefully
  // skips seed copy if these aren't provided (e.g. a leaner test fake).
  getMessage?: (id: string) => any;
  createMessage?: (input: CreateMessageInput) => any;
}

export interface StartInterviewOpts {
  origin_room_id?: string | null;
  caller_handle?: string | null;
  // If set, the new chat's first message is a copy of this message's content
  // posted as role='system' with meta.seed_from = { message_id, room_id, sender_id }.
  seed_message_id?: string | null;
  // If set (and seed_message_id is not), the new chat's first message is this
  // text posted as role='system'. Mutually exclusive with seed_message_id —
  // seed_message_id wins if both are provided.
  seed_text?: string | null;
  // Additional terminal session IDs to invite. The path-param target is always
  // included; participants is for *additional* agents in the same interview.
  participants?: string[];
}

export type StartInterviewResult =
  | {
      ok: true;
      chat_id: string;
      chat_name: string;
      participants_invited: string[];
      seed_posted: boolean;
    }
  | {
      ok: false;
      error: 'target_not_found' | 'invalid_target_type';
    };

const VALID_TARGET_TYPES = new Set(['terminal', 'chat', 'agent']);
const PREFIX_RE = /^Interview:\s/i;

function defaultIdGen(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

function dedupePreservingOrder(ids: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push(id);
  }
  return out;
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

  // Recursion is allowed under the new model (interview about an interview is
  // a coherent operation), but we DO de-duplicate the chat-name prefix so the
  // old "Interview: Interview: Interview: ANTchat" disaster can't happen.
  const displayName = target.display_name || target.name || target.handle || 'agent';
  const chatName = PREFIX_RE.test(displayName) ? displayName : `Interview: ${displayName}`;

  const participants_invited = dedupePreservingOrder([
    targetSessionId,
    ...(opts.participants ?? []),
  ]);

  const meta: Record<string, unknown> = {
    interview: true,
    origin_room_id: opts.origin_room_id ?? null,
    caller_handle: opts.caller_handle ?? null,
    started_at_ms: nowMs(),
    participants_seed: participants_invited,
  };
  if (opts.seed_message_id) meta.seed_message_id = opts.seed_message_id;
  if (opts.seed_text && !opts.seed_message_id) meta.seed_text = opts.seed_text;

  const chatId = idGen();
  q.createSession(chatId, chatName, 'chat', 'forever', null, null, JSON.stringify(meta));

  // Seed-message copy. seed_message_id wins over seed_text. Both are best-
  // effort: if the seed message can't be loaded, we still return ok=true with
  // seed_posted=false so the caller can decide whether to surface a warning.
  let seed_posted = false;
  if (opts.seed_message_id && q.getMessage && q.createMessage) {
    try {
      const orig = q.getMessage(opts.seed_message_id);
      if (orig && typeof orig.content === 'string' && orig.content.trim().length > 0) {
        q.createMessage({
          id: idGen(),
          sessionId: chatId,
          role: 'system',
          content: orig.content,
          msgType: 'message',
          meta: JSON.stringify({
            seed_from: {
              message_id: orig.id ?? opts.seed_message_id,
              room_id: orig.session_id ?? null,
              sender_id: orig.sender_id ?? null,
            },
          }),
        });
        seed_posted = true;
      }
    } catch {
      // Swallow — seed copy is best-effort.
    }
  } else if (opts.seed_text && q.createMessage) {
    const trimmed = opts.seed_text.trim();
    if (trimmed.length > 0) {
      q.createMessage({
        id: idGen(),
        sessionId: chatId,
        role: 'system',
        content: trimmed,
        msgType: 'message',
        meta: JSON.stringify({ seed_text_inline: true }),
      });
      seed_posted = true;
    }
  }

  return {
    ok: true,
    chat_id: chatId,
    chat_name: chatName,
    participants_invited,
    seed_posted,
  };
}
