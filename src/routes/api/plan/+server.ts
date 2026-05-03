import { error, json } from '@sveltejs/kit';
import type { RequestEvent } from '@sveltejs/kit';
import { queries } from '$lib/server/db.js';
import {
  PLAN_EVENT_KINDS,
  validatePlanPayload,
  type PlanEventKind,
  type PlanEventPayload,
} from '$lib/server/projector/types.js';

const DEFAULT_PLAN_ID = 'ant-r4';
const DEFAULT_LIMIT = 1000;
const MAX_LIMIT = 2000;

type RunEventRow = {
  id: number | string;
  session_id: string;
  ts_ms: number;
  source: string;
  trust: string;
  kind: string;
  text?: string | null;
  payload: string | Record<string, unknown> | null;
  raw_ref?: string | null;
  created_at?: string | null;
};

export type PlanApiEvent = {
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
  created_at?: string | null;
};

type PlanApiError = {
  id: string;
  kind: string;
  errors: string[];
};

function parseLimit(raw: string | null): number {
  const parsed = Number.parseInt(raw || String(DEFAULT_LIMIT), 10);
  if (!Number.isFinite(parsed)) return DEFAULT_LIMIT;
  return Math.max(1, Math.min(MAX_LIMIT, parsed));
}

function parsePayload(raw: RunEventRow['payload']): unknown {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(raw); }
  catch { return null; }
}

function normalizePlanRow(row: RunEventRow): { event: PlanApiEvent | null; error: PlanApiError | null } {
  const id = String(row.id);
  const payload = parsePayload(row.payload);
  const validated = validatePlanPayload(payload);
  if (!validated.ok) {
    return {
      event: null,
      error: { id, kind: row.kind, errors: validated.errors },
    };
  }

  return {
    event: {
      id,
      session_id: row.session_id,
      ts: row.ts_ms,
      ts_ms: row.ts_ms,
      source: row.source,
      trust: row.trust,
      kind: row.kind as PlanEventKind,
      text: row.text ?? '',
      payload: validated.value,
      raw_ref: row.raw_ref ?? null,
      created_at: row.created_at ?? null,
    },
    error: null,
  };
}

function sessionHasPlan(sessionId: string, planId: string): boolean {
  const rows = queries.getPlanEvents(sessionId, planId, [...PLAN_EVENT_KINDS], 1) as RunEventRow[];
  return rows.length > 0;
}

function findPlanSession(planId: string): string | null {
  const sessions = queries.listSessions() as Array<{ id: string }>;
  for (const session of sessions) {
    if (sessionHasPlan(session.id, planId)) return session.id;
  }
  return null;
}

export function GET({ url }: RequestEvent) {
  const planId = url.searchParams.get('plan_id')?.trim() || DEFAULT_PLAN_ID;
  const requestedSessionId = url.searchParams.get('session_id')?.trim() || null;
  const limit = parseLimit(url.searchParams.get('limit'));

  const sessionId = requestedSessionId ?? findPlanSession(planId);
  if (requestedSessionId && !queries.getSession(requestedSessionId)) {
    throw error(404, 'Session not found');
  }

  const rows = sessionId
    ? queries.getPlanEvents(sessionId, planId, [...PLAN_EVENT_KINDS], limit) as RunEventRow[]
    : [];
  const normalized = rows.map(normalizePlanRow);
  const events = normalized.flatMap((entry) => entry.event ? [entry.event] : []);
  const errors = normalized.flatMap((entry) => entry.error ? [entry.error] : []);

  return json({
    session_id: sessionId,
    plan_id: planId,
    limit,
    count: events.length,
    events,
    errors,
  });
}
