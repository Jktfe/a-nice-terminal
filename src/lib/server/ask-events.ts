// M1 close-out item 1: asks → run_events bridge.
//
// Asks live in their own `asks` table for query speed and structured filtering.
// The Plan View evidence model and the unified evidence timeline both read from
// `run_events`, so without a bridge an ask cannot be referenced as evidence on
// a plan_test, milestone, or decision.
//
// This helper emits a high-trust json run_event for each ask lifecycle hop:
//   ask_created  — POST /api/asks, POST /api/sessions/.../asks, inferred from messages
//   ask_updated  — PATCH /api/asks/[id], DELETE /api/asks/[id] (soft-dismiss)
//
// raw_ref points back at the asks table row (`ask:<id>`) so consumers can pivot
// from a run_event to the live ask row when statuses or answers move on.

import { queries } from './db.js';

type AskRow = {
  id: string;
  session_id: string;
  title: string;
  status: string;
  assigned_to?: string | null;
  owner_kind?: string | null;
  priority?: string | null;
  inferred?: number | boolean | null;
  confidence?: number | string | null;
  answer?: string | null;
  answer_action?: string | null;
};

type EmitOptions = {
  previousStatus?: string | null;
  action?: string | null;
};

export type AskRunEventKind = 'ask_created' | 'ask_updated';

export function emitAskRunEvent(
  kind: AskRunEventKind,
  ask: AskRow,
  options: EmitOptions = {},
): void {
  const payload: Record<string, unknown> = {
    ask_id: ask.id,
    title: ask.title,
    status: ask.status,
    assigned_to: ask.assigned_to ?? null,
    owner_kind: ask.owner_kind ?? null,
    priority: ask.priority ?? null,
    inferred: ask.inferred === 1 || ask.inferred === true,
    confidence:
      typeof ask.confidence === 'number'
        ? ask.confidence
        : Number(ask.confidence ?? 0),
  };

  if (options.previousStatus != null && options.previousStatus !== ask.status) {
    payload.previous_status = options.previousStatus;
  }
  if (options.action) {
    payload.action = options.action;
  }
  if (kind === 'ask_updated' && ask.answer) {
    payload.answer = ask.answer;
  }
  if (ask.answer_action) {
    payload.answer_action = ask.answer_action;
  }

  try {
    queries.appendRunEvent(
      ask.session_id,
      Date.now(),
      'json',
      'high',
      kind,
      ask.title,
      JSON.stringify(payload),
      `ask:${ask.id}`,
    );
  } catch (err) {
    // Capture-coverage parity is the point of this bridge; a failure to emit
    // shouldn't break the underlying ask write. Log and move on.
    console.error('[ask-events] failed to emit run_event', kind, ask.id, err);
  }
}
