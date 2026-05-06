// PATCH /api/plan/events/[id] — update a plan_* run_event.
//
// run_events is append-only. The projector dedupes by event identity
// (acceptance_id / milestone_id / slug-of-title) and keeps the latest
// ts_ms. So "patching" actually appends a fresh row with the same identity
// fields and the merged payload — the UI then renders the new latest.
//
// Body fields are merged onto the prior payload; only the keys present in
// the request body are overridden. Unknown keys are ignored. Title and
// payload-level fields can be renamed in one call.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import { assertCanWrite } from '$lib/server/room-scope.js';
import { appendAndBroadcastPlanEvent } from '$lib/server/plan-events.js';
import {
  PLAN_EVENT_KINDS,
  type PlanEventKind,
  type PlanEventPayload,
  type PlanStatus,
} from '$lib/server/projector/types.js';

const PATCHABLE_KEYS: ReadonlyArray<keyof PlanEventPayload> = [
  'title',
  'body',
  'order',
  'status',
  'owner',
  'parent_id',
  'milestone_id',
  'acceptance_id',
  'evidence',
  'provenance',
];

type RunEventRow = {
  id: number | string;
  session_id: string;
  ts_ms: number;
  source: string;
  trust: string;
  kind: string;
  text: string | null;
  payload: string | null;
  raw_ref: string | null;
  created_at: string | null;
};

function parsePayload(raw: unknown): Record<string, unknown> | null {
  if (!raw) return null;
  if (typeof raw === 'object') return raw as Record<string, unknown>;
  try {
    const v = JSON.parse(String(raw));
    return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export async function PATCH(event: RequestEvent<{ id: string }>) {
  assertCanWrite(event);

  const row = queries.getRunEvent(event.params.id) as RunEventRow | undefined;
  if (!row) {
    return json({ error: 'plan event not found' }, { status: 404 });
  }
  const prevPayload = parsePayload(row.payload);
  if (!prevPayload || typeof prevPayload.plan_id !== 'string') {
    return json({ error: 'event payload missing plan_id' }, { status: 422 });
  }

  let body: Record<string, unknown>;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  // Determine which fields are being patched.
  const patch: Record<string, unknown> = {};
  for (const key of PATCHABLE_KEYS) {
    if (key in body) patch[key] = body[key];
  }

  // Allow shorthand `done`/`status` toggles for milestones.
  if (typeof body.done === 'boolean') {
    patch.status = body.done ? ('done' as PlanStatus) : ('planned' as PlanStatus);
  }

  if (Object.keys(patch).length === 0) {
    return json({ error: 'no patchable fields supplied' }, { status: 400 });
  }

  const merged = { ...prevPayload, ...patch } as unknown as PlanEventPayload;

  // Force ts_ms strictly greater than the latest existing plan event for
  // this session+plan so the projector dedupe (latest ts_ms wins) always
  // prefers the patch — covers cases where Date.now() repeats within a
  // millisecond and where multiple patches land in fast succession.
  const planId = typeof prevPayload.plan_id === 'string' ? prevPayload.plan_id : null;
  let latestTs = Number(row.ts_ms);
  if (planId) {
    const existing = queries.getPlanEvents(
      row.session_id,
      planId,
      [...PLAN_EVENT_KINDS],
      2000,
    ) as Array<{ ts_ms: number }>;
    for (const e of existing) {
      if (e.ts_ms > latestTs) latestTs = e.ts_ms;
    }
  }
  const tsMs = Math.max(Date.now(), latestTs + 1);

  const result = appendAndBroadcastPlanEvent({
    sessionId: row.session_id,
    kind: row.kind as PlanEventKind,
    payload: merged,
    text: typeof body.text === 'string' ? body.text : (typeof patch.title === 'string' ? patch.title : (row.text ?? undefined)),
    rawRef: typeof body.raw_ref === 'string' ? body.raw_ref : null,
    tsMs,
  });

  if (!result.ok) {
    return json({ error: result.error, details: result.details }, { status: result.status });
  }
  return json({ event: result.event });
}
