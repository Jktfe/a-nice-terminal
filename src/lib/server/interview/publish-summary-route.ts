// M2 #2 — Publish Summary Route Helper
//
// Pure DI helper that takes a linked-chat session id + summary input and:
//   1. Resolves the origin room from the linked chat's meta
//   2. Builds + validates the PublishSummary
//   3. Inserts a rendered markdown message into the origin room
//   4. Returns the summary, message id, and origin room id
//
// The route layer (POST /api/sessions/:id/publish-summary) is a thin wrapper.

import {
  buildPublishSummary,
  renderSummaryMarkdown,
  serializePublishSummary,
  type PublishSummary,
  type SummaryAnchor,
} from './publish-summary.js';

export interface PublishSummaryQueries {
  getSession: (id: string) => any;
  createMessage: (
    id: string,
    sessionId: string,
    role: string,
    content: string,
    format: string,
    status: string,
    senderId: string | null,
    target: string | null,
    replyTo: string | null,
    msgType: string,
    meta: string,
  ) => any;
}

export interface PublishSummaryRouteInput {
  title: string;
  findings?: string[];
  decisions?: string[];
  asks?: string[];
  actions?: string[];
  sources?: SummaryAnchor[];
  authoredBy?: string | null;
  // Optional override; defaults to /chat/<linkedChatId>.
  transcriptUrl?: string;
}

export type PublishSummaryRouteResult =
  | {
      ok: true;
      summary: PublishSummary;
      message_id: string;
      origin_room_id: string;
      linked_chat_id: string;
    }
  | { ok: false; error: 'chat_not_found' | 'invalid_chat_type' | 'no_origin_room' | 'invalid_input'; reason?: string };

function parseSessionMeta(raw: unknown): Record<string, unknown> {
  if (typeof raw !== 'string' || raw.length === 0) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function defaultIdGen(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function publishSummaryFromLinkedChat(
  q: PublishSummaryQueries,
  linkedChatId: string,
  input: PublishSummaryRouteInput,
  opts: { idGen?: () => string; nowMs?: () => number } = {},
): PublishSummaryRouteResult {
  const chat = q.getSession(linkedChatId);
  if (!chat) return { ok: false, error: 'chat_not_found' };
  if (chat.type !== 'chat') return { ok: false, error: 'invalid_chat_type', reason: chat.type };

  const meta = parseSessionMeta(chat.meta);
  const originRoomId = typeof meta.origin_room_id === 'string' ? meta.origin_room_id : null;
  if (!originRoomId) return { ok: false, error: 'no_origin_room' };

  const idGen = opts.idGen ?? defaultIdGen;
  const nowMs = opts.nowMs ?? (() => Date.now());

  let summary: PublishSummary;
  try {
    summary = buildPublishSummary({
      title: input.title,
      findings: input.findings,
      decisions: input.decisions,
      asks: input.asks,
      actions: input.actions,
      sources: input.sources,
      linkedChatId,
      originRoomId,
      authoredBy: input.authoredBy ?? null,
      generatedAtMs: nowMs(),
    });
  } catch (err: any) {
    return { ok: false, error: 'invalid_input', reason: err?.message ?? 'build failed' };
  }

  const transcriptUrl = input.transcriptUrl?.trim() || `/chat/${linkedChatId}`;
  const markdown = renderSummaryMarkdown(summary, { transcriptUrl });

  const messageId = idGen();
  q.createMessage(
    messageId,
    originRoomId,
    'system',
    markdown,
    'markdown',
    'sent',
    summary.authored_by,
    null,
    null,
    'publish_summary',
    JSON.stringify({
      source: 'publish_summary',
      linked_chat_id: linkedChatId,
      schema_version: summary.schema_version,
      summary: serializePublishSummary(summary),
    }),
  );

  return {
    ok: true,
    summary,
    message_id: messageId,
    origin_room_id: originRoomId,
    linked_chat_id: linkedChatId,
  };
}
