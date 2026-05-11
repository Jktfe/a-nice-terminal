// Phase A of server-split-2026-05-11 — input normalization for
// writeMessage. Lifted from +server.ts POST handler steps 1-5 with
// no behaviour change.

import { CHAT_BREAK_MSG_TYPE } from '$lib/server/chat-context';
import { ensureTrailingMentionBoundary } from '$lib/utils/mentions';
import { inferAsks } from '$lib/server/asks-inference';
import type { MessageInput } from './types.js';
import { WriteMessageError } from './types.js';

export interface NormalizedMessageInput {
  sessionId: string;
  role: string;
  content: string;
  format: string;
  senderId: string | null;
  target: string | null;
  replyTo: string | null;
  msgType: string;
  isChatBreak: boolean;
  explicitAsks: string[];
  inferred: string[];
  parsedMeta: Record<string, unknown>;
  metaJson: string;
}

export function normalizeMessageInput(input: MessageInput): NormalizedMessageInput {
  const msgType = input.msgType || 'message';
  const normalizedContent =
    msgType === 'message' && typeof input.content === 'string'
      ? ensureTrailingMentionBoundary(input.content)
      : input.content;
  const replyTo = input.replyTo || null;

  const metaJson =
    input.meta === undefined
      ? '{}'
      : typeof input.meta === 'string'
      ? input.meta
      : JSON.stringify(input.meta ?? {});
  let parsedMeta: Record<string, unknown> = {};
  try { parsedMeta = JSON.parse(metaJson || '{}'); } catch {}

  const isChatBreak = msgType === CHAT_BREAK_MSG_TYPE;
  const explicitAsks: string[] =
    !isChatBreak && Array.isArray(input.asks)
      ? input.asks
          .filter((s): s is string => typeof s === 'string' && s.trim().length > 0)
          .map((s) => s.trim())
      : [];
  const inferred =
    !isChatBreak && typeof normalizedContent === 'string'
      ? inferAsks(normalizedContent, explicitAsks)
      : [];

  // Carry the ask hints through meta so the consumer can use them after
  // ask creation flips this to `inferred_asks`/`asks_resolved` shapes.
  parsedMeta.asks = explicitAsks;
  parsedMeta.inferred_asks = inferred;
  parsedMeta.asks_resolved = [];

  // Urgent/focus-bypass requires an explicit reason. Match the existing
  // HTTP handler's 400 behaviour — surfaces as WriteMessageError so the
  // POST route can translate it back to the 400 response shape.
  const urgentRequested =
    parsedMeta.urgent === true ||
    parsedMeta.urgent_bypass === true ||
    parsedMeta.focus_bypass === true;
  const reasonField =
    typeof parsedMeta.urgent_reason === 'string'
      ? parsedMeta.urgent_reason.trim()
      : typeof parsedMeta.bypass_reason === 'string'
      ? parsedMeta.bypass_reason.trim()
      : typeof parsedMeta.reason === 'string'
      ? parsedMeta.reason.trim()
      : '';
  if (urgentRequested && !reasonField) {
    throw new WriteMessageError('urgent/focus bypass requires a reason', 400);
  }

  return {
    sessionId: input.sessionId,
    role: input.role,
    content: normalizedContent,
    format: input.format || 'text',
    senderId: input.senderId || null,
    target: input.target || null,
    replyTo,
    msgType,
    isChatBreak,
    explicitAsks,
    inferred,
    parsedMeta,
    metaJson: JSON.stringify(parsedMeta),
  };
}
