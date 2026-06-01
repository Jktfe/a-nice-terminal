/**
 * Plan Mode endpoint — HTTP surface over planModeStore.
 *
 *   GET    /api/plan/:planId
 *     → 200 { events: PlanEvent[] }  projected events, latest-wins per
 *                                    identity key, sorted by parent_id
 *                                    then order. Empty array for unknown
 *                                    plan_id (plans are created by their
 *                                    first event, not pre-registered).
 *
 *   POST   /api/plan/:planId         body { event: PlanEvent }
 *     → 200 { event: PlanEvent }     appended event, server-injected
 *                                    monotonic ts_millis
 *     → 400                          missing/malformed body, missing
 *                                    required fields, bad enum, plan_id
 *                                    mismatch URL ↔ body
 *
 * Server-injected ts_millis uses a module-level monotonic counter so two
 * appends from the same server never share a timestamp. Resolves the
 * pm-store R2 tie-break note: latest-wins projection always has a strict
 * winner.
 *
 * Backs the Plan Mode contract §3 projection + append rules. Backend
 * only — no CLI, no UI in this slice. CLI verbs land via pm-cli-write;
 * UI lands via pm-route.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  appendPlanEvent,
  projectPlanEvents,
  type EvidenceRef,
  type PlanAuthorKind,
  type PlanEvent,
  type PlanEventKind,
  type PlanStatus,
  type ProvenanceRef
} from '$lib/server/planModeStore';

const ALLOWED_KINDS: ReadonlySet<PlanEventKind> = new Set([
  'plan_section',
  'plan_decision',
  'plan_milestone',
  'plan_acceptance',
  'plan_test'
]);

const ALLOWED_STATUSES: ReadonlySet<PlanStatus> = new Set([
  'planned',
  'active',
  'blocked',
  'passing',
  'failing',
  'done',
  'archived'
]);

const ALLOWED_AUTHOR_KINDS: ReadonlySet<PlanAuthorKind> = new Set([
  'agent',
  'human',
  'system'
]);

let lastIssuedTsMillis = 0;

function issueMonotonicTsMillis(): number {
  const candidate = Date.now();
  const next = candidate > lastIssuedTsMillis ? candidate : lastIssuedTsMillis + 1;
  lastIssuedTsMillis = next;
  return next;
}

async function parseRequiredJsonBody(request: Request): Promise<Record<string, unknown>> {
  const requestBodyText = await request.text();
  if (requestBodyText.length === 0) {
    throw error(400, 'Body must be a JSON object.');
  }
  try {
    const parsed = JSON.parse(requestBodyText);
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw error(400, 'Body must be a JSON object.');
    }
    return parsed as Record<string, unknown>;
  } catch (parseFailure) {
    if (parseFailure instanceof SyntaxError) {
      throw error(400, 'Body must be valid JSON.');
    }
    throw parseFailure;
  }
}

function requireString(source: Record<string, unknown>, field: string): string {
  const value = source[field];
  if (typeof value !== 'string' || value.length === 0) {
    throw error(400, `Field ${field} must be a non-empty string.`);
  }
  return value;
}

function requireFiniteNumber(source: Record<string, unknown>, field: string): number {
  const value = source[field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw error(400, `Field ${field} must be a finite number.`);
  }
  return value;
}

function asPlanEventKind(value: unknown): PlanEventKind {
  if (typeof value !== 'string' || !ALLOWED_KINDS.has(value as PlanEventKind)) {
    throw error(400, 'Field kind must be one of the allowed PlanEventKind values.');
  }
  return value as PlanEventKind;
}

function asOptionalStatus(value: unknown): PlanStatus | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string' || !ALLOWED_STATUSES.has(value as PlanStatus)) {
    throw error(400, 'Field status must be one of the allowed PlanStatus values.');
  }
  return value as PlanStatus;
}

function asAuthorKind(value: unknown): PlanAuthorKind {
  if (typeof value !== 'string' || !ALLOWED_AUTHOR_KINDS.has(value as PlanAuthorKind)) {
    throw error(400, 'Field author_kind must be one of agent | human | system.');
  }
  return value as PlanAuthorKind;
}

function asEvidenceList(value: unknown): EvidenceRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw error(400, 'Field evidence must be an array when present.');
  }
  return value as EvidenceRef[];
}

function asOptionalString(value: unknown, field: string): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') {
    throw error(400, `Field ${field} must be a string when present.`);
  }
  return value;
}

function asOptionalProvenance(value: unknown): ProvenanceRef | undefined {
  if (value === undefined) return undefined;
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw error(400, 'Field provenance must be an object when present.');
  }
  return value as ProvenanceRef;
}

function buildPlanEventFromBody(
  body: Record<string, unknown>,
  planIdFromUrl: string
): PlanEvent {
  const planIdInBody = requireString(body, 'plan_id');
  if (planIdInBody !== planIdFromUrl) {
    throw error(400, 'Body plan_id must match URL planId.');
  }
  return {
    id: requireString(body, 'id'),
    plan_id: planIdFromUrl,
    parent_id: asOptionalString(body.parent_id, 'parent_id'),
    kind: asPlanEventKind(body.kind),
    title: requireString(body, 'title'),
    body: asOptionalString(body.body, 'body'),
    status: asOptionalStatus(body.status),
    owner: asOptionalString(body.owner, 'owner'),
    milestone_id: asOptionalString(body.milestone_id, 'milestone_id'),
    acceptance_id: asOptionalString(body.acceptance_id, 'acceptance_id'),
    order: requireFiniteNumber(body, 'order'),
    author_handle: requireString(body, 'author_handle'),
    author_kind: asAuthorKind(body.author_kind),
    ts_millis: issueMonotonicTsMillis(),
    evidence: asEvidenceList(body.evidence),
    provenance: asOptionalProvenance(body.provenance)
  };
}

export const GET: RequestHandler = async ({ params }) => {
  const planIdFromUrl = params.planId ?? '';
  const events = projectPlanEvents(planIdFromUrl);
  return json({ events });
};

export const POST: RequestHandler = async ({ params, request }) => {
  const planIdFromUrl = params.planId ?? '';
  if (planIdFromUrl.length === 0) {
    throw error(400, 'URL planId must be non-empty.');
  }
  const body = await parseRequiredJsonBody(request);
  const event = buildPlanEventFromBody(body, planIdFromUrl);
  appendPlanEvent(event);
  return json({ event });
};
