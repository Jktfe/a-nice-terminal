import { queries } from '$lib/server/db.js';
import {
  PLAN_EVENT_KINDS,
  validatePlanPayloadString,
  type PlanEventKind,
} from './types.js';
import type {
  PlanEvent,
  PlanEventSource,
  PlanEventTrust,
} from '$lib/components/PlanView/types.js';

const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 2500;

type PlanRow = {
  id: number | string;
  session_id: string;
  ts_ms: number;
  source: string;
  trust: string;
  kind: string;
  text?: string | null;
  payload: string;
  raw_ref?: string | null;
  created_at?: string | null;
};

type PlanRefRow = {
  session_id: string;
  plan_id: string;
  event_count: number;
  updated_ts_ms: number;
};

export type PlanRef = {
  session_id: string;
  plan_id: string;
  event_count: number;
  updated_ts_ms: number;
};

export type PlanViewData = {
  source: 'live' | 'empty';
  session_id: string | null;
  plan_id: string | null;
  events: PlanEvent[];
  plans: PlanRef[];
  errors: Array<{ id: string; kind: string; errors: string[] }>;
  warnings: string[];
  limit: number;
};

function clampLimit(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number.parseInt(value ?? '', 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function normalizePlanRef(row: PlanRefRow): PlanRef {
  return {
    session_id: row.session_id,
    plan_id: row.plan_id,
    event_count: Number(row.event_count) || 0,
    updated_ts_ms: Number(row.updated_ts_ms) || 0,
  };
}

function isPlanEventKind(kind: string): kind is PlanEventKind {
  return (PLAN_EVENT_KINDS as readonly string[]).includes(kind);
}

function normalizePlanEvent(
  row: PlanRow,
): { event?: PlanEvent; warning?: string; error?: { id: string; kind: string; errors: string[] } } {
  if (!isPlanEventKind(row.kind)) {
    return { warning: `ignored non-plan event kind ${row.kind} at run_event ${row.id}` };
  }

  const validated = validatePlanPayloadString(row.payload);
  if (!validated.ok) {
    return {
      error: {
        id: String(row.id),
        kind: row.kind,
        errors: validated.errors,
      },
    };
  }

  return {
    event: {
      id: String(row.id),
      session_id: row.session_id,
      ts: Number(row.ts_ms),
      ts_ms: Number(row.ts_ms),
      source: row.source as PlanEventSource,
      trust: row.trust as PlanEventTrust,
      kind: row.kind,
      text: row.text ?? '',
      payload: validated.value,
      raw_ref: row.raw_ref ?? undefined,
      created_at: row.created_at ?? null,
    },
  };
}

export function listPlanRefs(limit = 50): PlanRef[] {
  return (queries.listPlanRefs([...PLAN_EVENT_KINDS], limit) as PlanRefRow[])
    .map(normalizePlanRef);
}

export function getPlanViewData(input?: {
  sessionId?: string | null;
  planId?: string | null;
  limit?: string | number | null;
}): PlanViewData {
  const limit = clampLimit(input?.limit);
  const plans = listPlanRefs(50);
  let sessionId = input?.sessionId?.trim() || null;
  let planId = input?.planId?.trim() || null;

  if (planId && !sessionId) {
    const matchingPlan = plans.find((p) => p.plan_id === planId);
    sessionId = matchingPlan?.session_id ?? null;
  }

  if (!sessionId || !planId) {
    const latest = plans[0];
    sessionId = latest?.session_id ?? sessionId;
    planId = latest?.plan_id ?? planId;
  }

  if (!sessionId || !planId) {
    return {
      source: 'empty',
      session_id: sessionId,
      plan_id: planId,
      events: [],
      plans,
      errors: [],
      warnings: [],
      limit,
    };
  }

  const rows = queries.getPlanEvents(
    sessionId,
    planId,
    [...PLAN_EVENT_KINDS],
    limit,
  ) as PlanRow[];
  const warnings: string[] = [];
  const errors: Array<{ id: string; kind: string; errors: string[] }> = [];
  const events: PlanEvent[] = [];
  for (const row of rows) {
    const normalized = normalizePlanEvent(row);
    if (normalized.warning) warnings.push(normalized.warning);
    if (normalized.error) errors.push(normalized.error);
    if (normalized.event) events.push(normalized.event);
  }

  return {
    source: events.length > 0 ? 'live' : 'empty',
    session_id: sessionId,
    plan_id: planId,
    events,
    plans,
    errors,
    warnings,
    limit,
  };
}
