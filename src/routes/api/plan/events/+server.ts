// POST /api/plan/events — append a single plan_* run_event.
//
// Body: { session_id, kind, payload, text?, raw_ref? }
//   kind: 'plan_section' | 'plan_decision' | 'plan_milestone'
//        | 'plan_acceptance' | 'plan_test'
//   payload: PlanEventPayload (see projector/types.ts)
//
// On success the row is appended via queries.appendRunEvent and a
// `run_event_created` envelope is broadcast to all WS clients joined to
// the session. /plan re-folds incoming events and re-renders.

import { json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { assertCanWrite } from '$lib/server/room-scope.js';
import {
  appendAndBroadcastPlanEvent,
  isPlanEventKind,
} from '$lib/server/plan-events.js';
import type { PlanEventPayload } from '$lib/server/projector/types.js';

export async function POST(event: RequestEvent) {
  assertCanWrite(event);

  let body: Record<string, unknown>;
  try {
    body = await event.request.json();
  } catch {
    return json({ error: 'invalid JSON body' }, { status: 400 });
  }

  const sessionId = typeof body.session_id === 'string' ? body.session_id : '';
  const kind = body.kind;
  if (!sessionId) {
    return json({ error: 'session_id required' }, { status: 400 });
  }
  if (!isPlanEventKind(kind)) {
    return json({ error: `invalid kind: ${String(kind)}` }, { status: 400 });
  }

  const payload = body.payload as PlanEventPayload | undefined;
  if (!payload || typeof payload !== 'object') {
    return json({ error: 'payload required' }, { status: 400 });
  }

  const text = typeof body.text === 'string' ? body.text : undefined;
  const rawRef = typeof body.raw_ref === 'string' ? body.raw_ref : null;

  const result = appendAndBroadcastPlanEvent({
    sessionId,
    kind,
    payload,
    text,
    rawRef,
  });

  if (!result.ok) {
    return json({ error: result.error, details: result.details }, { status: result.status });
  }
  return json({ event: result.event });
}
