// Phase A of server-split-2026-05-11 — ask row creation + meta
// rewrite + consent-gate path, extracted verbatim from the POST
// handler (lines 250-386 on origin/main fc95208). Lives in the
// persist library so ask creation is unambiguously Tier 1: a
// message and its asks are written in the same DB transaction, so a
// partial state (message in DB, ask missing) is impossible. Tier 2's
// runSideEffects must NEVER re-call inferAskFromMessage on replay —
// see serverSplit.md "Ask creation is Tier 1, ask broadcast is
// Tier 2" for the load-bearing reasoning.

import { queries } from '$lib/server/db';
import { createAskId } from '$lib/server/ask-ids';
import { inferAskFromMessage, titleFromAskContent } from '$lib/server/ask-inference';
import { consentGateAsk } from '$lib/server/consent/consent-gate-ask';
import type { CreatedAsk } from './types.js';

export interface AskWriteContext {
  sessionId: string;
  messageId: string;
  senderId: string | null;
  target: string | null;
  msgType: string;
  isChatBreak: boolean;
  content: string;
  explicitAsks: string[];
  inferred: string[];
  parsedMeta: Record<string, unknown>;
}

export interface AskWriteResult {
  createdAsks: CreatedAsk[];
  finalMetaJson: string;
  parsedMeta: Record<string, unknown>;
}

export function writeAsksForMessage(ctx: AskWriteContext): AskWriteResult {
  const createdAsks: CreatedAsk[] = [];
  const seenAskTitles = new Set<string>();
  const targetAssignee =
    typeof ctx.target === 'string' && ctx.target && ctx.target !== '@everyone'
      ? ctx.target
      : null;

  function createAskRow(draft: {
    title: string;
    body: string;
    recommendation: string | null;
    status: string;
    assignedTo: string;
    ownerKind: string;
    priority: string;
    inferred: boolean;
    confidence: number;
    meta: Record<string, unknown>;
  }) {
    const titleKey = draft.title.trim().toLowerCase();
    if (!titleKey || seenAskTitles.has(titleKey)) return;
    seenAskTitles.add(titleKey);

    const askId = createAskId();
    queries.createAsk(
      askId,
      ctx.sessionId,
      ctx.messageId,
      draft.title,
      draft.body,
      draft.recommendation,
      draft.status,
      draft.assignedTo,
      draft.ownerKind,
      draft.priority,
      ctx.senderId,
      draft.inferred ? 1 : 0,
      draft.confidence,
      JSON.stringify(draft.meta),
    );
    const ask = queries.getAsk(askId) as CreatedAsk | undefined;
    if (ask) createdAsks.push(ask);
  }

  for (const askText of ctx.explicitAsks) {
    createAskRow({
      title: titleFromAskContent(askText),
      body: askText,
      recommendation: null,
      status: 'open',
      assignedTo: targetAssignee || 'room',
      ownerKind: targetAssignee
        ? targetAssignee.toLowerCase().includes('james')
          ? 'human'
          : 'agent'
        : 'room',
      priority: 'normal',
      inferred: false,
      confidence: 1,
      meta: {
        source: 'explicit_asks_payload',
        source_message_id: ctx.messageId,
        source_sender_id: ctx.senderId,
      },
    });
  }

  for (const askText of ctx.explicitAsks.length === 0 ? ctx.inferred : []) {
    const draft = inferAskFromMessage({
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      content: askText,
      senderId: ctx.senderId,
      target: ctx.target,
      msgType: ctx.msgType,
      meta: ctx.parsedMeta,
    });
    createAskRow(
      draft ?? {
        title: titleFromAskContent(askText),
        body: askText,
        recommendation: null,
        status: 'candidate',
        assignedTo: targetAssignee || 'room',
        ownerKind: targetAssignee
          ? targetAssignee.toLowerCase().includes('james')
            ? 'human'
            : 'agent'
          : 'room',
        priority: 'low',
        inferred: true,
        confidence: 0.3,
        meta: {
          source: 'line_inferred_from_message',
          source_message_id: ctx.messageId,
          source_sender_id: ctx.senderId,
        },
      },
    );
  }

  if (!ctx.isChatBreak && createdAsks.length === 0) {
    const draft = inferAskFromMessage({
      sessionId: ctx.sessionId,
      messageId: ctx.messageId,
      content: ctx.content,
      senderId: ctx.senderId,
      target: ctx.target,
      msgType: ctx.msgType,
      meta: ctx.parsedMeta,
    });
    if (draft) createAskRow(draft);
  }

  const parsedMeta = { ...ctx.parsedMeta };

  if (createdAsks.length > 0) {
    const askListLen = (parsedMeta.asks as unknown[] | undefined)?.length ?? 0;
    const inferredLen = (parsedMeta.inferred_asks as unknown[] | undefined)?.length ?? 0;
    if (askListLen === 0 && inferredLen === 0) {
      parsedMeta.inferred_asks = createdAsks.map((ask) => ask.title);
      parsedMeta.asks_resolved = [];
    }
    parsedMeta.ask_ids = createdAsks.map((ask) => ask.id);
    parsedMeta.ask_id = createdAsks[0].id;
    parsedMeta.ask_status = createdAsks[0].status;
    parsedMeta.ask_assigned_to = createdAsks[0].assigned_to;
    parsedMeta.ask_owner_kind = createdAsks[0].owner_kind;

    // M3 #2: Consent-gated fan-out for inferred asks. Behaviour-identical
    // to the previous inline block. Failures here must not break the
    // message post — same swallow-and-continue policy.
    const consentOutcomes: Array<{ askId: string; outcome: unknown }> = [];
    for (const ask of createdAsks) {
      if (!ask.inferred) continue;
      try {
        const outcome = consentGateAsk(queries, queries, ask, { nowMs: Date.now() });
        consentOutcomes.push({ askId: ask.id, outcome });
      } catch {
        // Consent gate failure must never break the message post
      }
    }
    if (consentOutcomes.length > 0) {
      parsedMeta.consent_gates = consentOutcomes;
    }
  }

  const finalMetaJson = JSON.stringify(parsedMeta);
  return { createdAsks, finalMetaJson, parsedMeta };
}
