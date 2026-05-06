// Plan event emit + broadcast helper.
//
// Mirrors the deck audit pipeline (decks.ts:515) and the ask bridge
// (ask-events.ts) — append a row to run_events and broadcast a
// `run_event_created` envelope so /plan can re-fold without a refresh.
//
// We deliberately do NOT introduce new event-type strings. The projector
// fold function in plan-view.ts only recognises:
//   plan_section · plan_decision · plan_milestone · plan_acceptance · plan_test
// Status flips are emitted as fresh events that share the same identity
// (acceptance_id / milestone_id) — plan-view.ts:dedupePlanEvents keeps the
// latest by ts_ms.

import { queries } from './db.js';
import { broadcast } from './ws-broadcast.js';
import {
  PLAN_EVENT_KINDS,
  validatePlanPayload,
  type PlanEventKind,
  type PlanEventPayload,
} from './projector/types.js';

export type AppendPlanEventResult =
  | { ok: true; event: PlanEventEnvelope }
  | { ok: false; status: number; error: string; details?: string[] };

export interface PlanEventEnvelope {
  id: string;
  session_id: string;
  ts: number;
  ts_ms: number;
  source: string;
  trust: string;
  kind: PlanEventKind;
  text: string;
  payload: PlanEventPayload;
  raw_ref: string | null;
  created_at: string | null;
}

const VALID_KINDS = new Set<string>(PLAN_EVENT_KINDS);

export function isPlanEventKind(kind: unknown): kind is PlanEventKind {
  return typeof kind === 'string' && VALID_KINDS.has(kind);
}

interface AppendArgs {
  sessionId: string;
  kind: PlanEventKind;
  payload: PlanEventPayload;
  text?: string;
  rawRef?: string | null;
  source?: string;
  trust?: string;
  // Caller-provided ts_ms — used by PATCH to ensure the new row's ts is
  // strictly greater than the previous row's, so the projector dedupe
  // (latest ts_ms wins) picks up the patch even when Date.now() lands in
  // the same millisecond as the original write.
  tsMs?: number;
}

export function appendAndBroadcastPlanEvent(args: AppendArgs): AppendPlanEventResult {
  if (!isPlanEventKind(args.kind)) {
    return { ok: false, status: 400, error: `unknown plan event kind: ${args.kind}` };
  }

  const validated = validatePlanPayload(args.payload);
  if (!validated.ok) {
    return { ok: false, status: 400, error: 'invalid plan payload', details: validated.errors };
  }

  if (!args.sessionId) {
    return { ok: false, status: 400, error: 'session_id is required' };
  }

  const session = queries.getSession(args.sessionId);
  if (!session) {
    return { ok: false, status: 404, error: 'session not found' };
  }

  const text = args.text ?? validated.value.title ?? '';
  // ts_ms must monotonically advance for any given identity so the projector
  // dedupe (latest ts_ms wins) picks up the patch. Date.now() can repeat in a
  // hot loop or between two same-ms appends; floor it on the explicit tsMs
  // hint (PATCH supplies prev_ts + 1) so the patched row always sorts after
  // the seed.
  const tsMs = typeof args.tsMs === 'number' && Number.isFinite(args.tsMs)
    ? Math.max(args.tsMs, Date.now())
    : Date.now();

  let row: any;
  try {
    row = queries.appendRunEvent(
      args.sessionId,
      tsMs,
      args.source ?? 'json',
      args.trust ?? 'high',
      args.kind,
      text,
      JSON.stringify(validated.value),
      args.rawRef ?? null,
    );
  } catch (err) {
    return {
      ok: false,
      status: 500,
      error: 'failed to append plan run_event',
      details: [String((err as Error)?.message ?? err)],
    };
  }

  const envelope: PlanEventEnvelope = {
    id: String(row.id),
    session_id: row.session_id,
    ts: Number(row.ts_ms),
    ts_ms: Number(row.ts_ms),
    source: row.source,
    trust: row.trust,
    kind: row.kind as PlanEventKind,
    text: row.text ?? '',
    payload: validated.value,
    raw_ref: row.raw_ref ?? null,
    created_at: row.created_at ?? null,
  };

  try {
    broadcast(args.sessionId, {
      type: 'run_event_created',
      sessionId: args.sessionId,
      event: envelope,
    });
  } catch (err) {
    // Live broadcast is a nice-to-have; the row is durable. Log and continue.
    console.error('[plan-events] broadcast failed', err);
  }

  return { ok: true, event: envelope };
}
