import { queries } from '$lib/server/db.js';
import {
  PLAN_EVENT_KINDS,
  validatePlanPayloadString,
  type PlanEventKind,
  type PlanStatus,
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
  status?: PlanStatus;
  archived: boolean;
};

export type PlanViewData = {
  source: 'live' | 'empty';
  session_id: string | null;
  plan_id: string | null;
  archived: boolean;
  include_archived: boolean;
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
    archived: false,
  };
}

export function parseIncludeArchived(value: string | boolean | null | undefined): boolean {
  if (typeof value === 'boolean') return value;
  const normalized = (value ?? '').trim().toLowerCase();
  return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'all';
}

function isPlanEventKind(kind: string): kind is PlanEventKind {
  return (PLAN_EVENT_KINDS as readonly string[]).includes(kind);
}

function slug(value: string | undefined | null): string {
  return (value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9.]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Identity key for status-update supersession. When two events share the same
// identity, the one with the larger ts_ms wins — that lets a status flip
// (planned → active → done) be emitted as a fresh append-only event without
// stacking duplicates in the UI.
function planEventIdentity(ev: PlanEvent): string {
  const p = ev.payload;
  switch (ev.kind) {
    case 'plan_section':
      return `section:${p.acceptance_id || slug(p.title)}`;
    case 'plan_milestone':
      return `milestone:${p.milestone_id || slug(p.title)}`;
    case 'plan_acceptance':
      return `acceptance:${p.milestone_id ?? ''}:${p.acceptance_id || slug(p.title)}`;
    case 'plan_test':
      return `test:${p.milestone_id ?? ''}:${slug(p.title) || `o${p.order}`}`;
    case 'plan_decision':
      return `decision:${p.parent_id ?? ''}:${slug(p.title) || `o${p.order}`}`;
    default:
      return `evt:${ev.id}`;
  }
}

function dedupePlanEvents(events: PlanEvent[]): PlanEvent[] {
  const latest = new Map<string, PlanEvent>();
  for (const ev of events) {
    const key = planEventIdentity(ev);
    const prev = latest.get(key);
    const evTs = ev.ts_ms ?? 0;
    const prevTs = prev?.ts_ms ?? 0;
    if (!prev || evTs > prevTs) latest.set(key, ev);
  }
  return Array.from(latest.values());
}

export function planArchiveStatus(events: PlanEvent[]): { archived: boolean; status?: PlanStatus } {
  const sections = dedupePlanEvents(events).filter((ev) => ev.kind === 'plan_section');
  const archived = sections.some((ev) => ev.payload.status === 'archived');
  return {
    archived,
    status: archived ? 'archived' : sections.find((ev) => ev.payload.status)?.payload.status,
  };
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

function loadPlanEvents(sessionId: string, planId: string, limit = MAX_LIMIT): PlanEvent[] {
  const rows = queries.getPlanEvents(
    sessionId,
    planId,
    [...PLAN_EVENT_KINDS],
    limit,
  ) as PlanRow[];
  const events: PlanEvent[] = [];
  for (const row of rows) {
    const normalized = normalizePlanEvent(row);
    if (normalized.event) events.push(normalized.event);
  }
  return events;
}

function enrichPlanRef(row: PlanRefRow): PlanRef {
  const ref = normalizePlanRef(row);
  const archiveStatus = planArchiveStatus(loadPlanEvents(ref.session_id, ref.plan_id));
  return {
    ...ref,
    status: archiveStatus.status,
    archived: archiveStatus.archived,
  };
}

export function listPlanRefs(
  limit = 50,
  options: { includeArchived?: boolean } = {},
): PlanRef[] {
  const discoveryLimit = options.includeArchived ? limit : Math.max(limit * 4, 200);
  const refs = (queries.listPlanRefs([...PLAN_EVENT_KINDS], discoveryLimit) as PlanRefRow[])
    .map(enrichPlanRef);
  const visible = options.includeArchived ? refs : refs.filter((ref) => !ref.archived);
  return visible.slice(0, limit);
}

export function getPlanViewData(input?: {
  sessionId?: string | null;
  planId?: string | null;
  limit?: string | number | null;
  includeArchived?: string | boolean | null;
}): PlanViewData {
  const limit = clampLimit(input?.limit);
  const includeArchived = parseIncludeArchived(input?.includeArchived);
  let plans = listPlanRefs(50, { includeArchived });
  let sessionId = input?.sessionId?.trim() || null;
  let planId = input?.planId?.trim() || null;
  const explicitPlanRequest = Boolean(sessionId || planId);

  if (planId && !sessionId) {
    const matchingPlan =
      plans.find((p) => p.plan_id === planId) ??
      listPlanRefs(250, { includeArchived: true }).find((p) => p.plan_id === planId);
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
      archived: false,
      include_archived: includeArchived,
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

  const deduped = dedupePlanEvents(events);
  const archiveStatus = planArchiveStatus(deduped);

  if (explicitPlanRequest && archiveStatus.archived && !includeArchived) {
    const selected = listPlanRefs(250, { includeArchived: true }).find(
      (p) => p.session_id === sessionId && p.plan_id === planId,
    );
    if (selected && !plans.some((p) => p.session_id === selected.session_id && p.plan_id === selected.plan_id)) {
      plans = [selected, ...plans].slice(0, 50);
    }
  }

  return {
    source: deduped.length > 0 ? 'live' : 'empty',
    session_id: sessionId,
    plan_id: planId,
    archived: archiveStatus.archived,
    include_archived: includeArchived,
    events: deduped,
    plans,
    errors,
    warnings,
    limit,
  };
}
