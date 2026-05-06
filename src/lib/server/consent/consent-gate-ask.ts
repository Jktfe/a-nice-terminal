// M3 #2 — Consent-Gated Ask Fan-Out
//
// When an inferred ask is auto-fanned-out to a participant, the fan-out
// checks consent_grants. If there's an active grant for the target, the
// ask is auto-answered (status → 'answered', answer_count bumped). If
// the grant is revoked/expired/exhausted, the ask is dismissed instead.
//
// This module owns the pure helper that makes the decision — no DB
// imports, fully testable with a fake queries object.

import {
  resolveConsentGrant,
  type ConsentGrantQueries,
  type ConsentGrant,
} from './grant-scope.js';

export type AskRow = {
  id: string;
  session_id: string;
  assigned_to: string;
  status: string;
  inferred: number | boolean;
  meta: string;
  title?: string | null;
  body?: string | null;
};

export interface AskQueries {
  updateAsk: (
    id: string,
    status: string | null,
    assignedTo: string | null,
    ownerKind: string | null,
    priority: string | null,
    answer: string | null,
    answerAction: string | null,
    answeredBy: string | null,
    meta: string | null,
  ) => void;
}

export interface ConsentGateQueries extends ConsentGrantQueries {
  listConsentGrantsByGrantee: (grantedTo: string) => ConsentGrant[];
}

export type ConsentGateOutcome =
  | { action: 'auto_answered'; grantId: string; grantTopic: string; remainingAnswers: number | null }
  | { action: 'dismissed'; grantId: string; reason: 'revoked' | 'expired' | 'exhausted' | 'not_found' }
  | { action: 'no_grant' };

// Topic inference from ask content. Simple heuristic: if the ask body
// references files → 'file-read'; URLs → 'web-fetch'; commands →
// 'command-exec'; otherwise 'memory-read' as the broadest default.
export function inferTopicFromAsk(ask: AskRow): string {
  const body = typeof ask.body === 'string' ? ask.body : '';
  const title = typeof ask.title === 'string' ? ask.title : '';
  const text = `${title} ${body}`.toLowerCase();

  if (/\b(read|open|view|show|cat|grep)\b.*\.(ts|js|py|rs|go|md|json|yaml)\b/.test(text)) return 'file-read';
  if (/\b(write|edit|save|modify|patch|update)\b.*\.(ts|js|py|rs|go|md|json|yaml)\b/.test(text)) return 'file-write';
  if (/\b(run|exec|execute|launch|start|invoke)\b.*\b(command|script|bin|cmd)\b/.test(text)) return 'command-exec';
  if (/https?:\/\//i.test(text)) return 'web-fetch';
  return 'memory-read';
}

// Resolve the assigned_to field to a handle that matches a grant's granted_to.
// Handles both bare handles (@codex) and plain names (codex).
export function normalizeGrantee(assignedTo: string): string {
  if (assignedTo.startsWith('@')) return assignedTo;
  return `@${assignedTo}`;
}

/**
 * Check consent grants for an inferred ask and either auto-answer or dismiss.
 *
 * - Finds active grants for the ask's assigned_to (grantee)
 * - Matches grant topic against the ask's inferred topic
 * - If an active grant is found: auto-answer the ask, bump the grant's answer_count
 * - If a grant is found but invalid: dismiss the ask
 * - If no grant at all: return 'no_grant' (ask proceeds normally)
 *
 * Returns the outcome so the caller can record it in message meta.
 */
export function consentGateAsk(
  q: ConsentGateQueries,
  aq: AskQueries,
  ask: AskRow,
  opts: { nowMs?: number } = {},
): ConsentGateOutcome {
  const grantee = normalizeGrantee(ask.assigned_to);
  const grants = q.listConsentGrantsByGrantee(grantee);

  if (grants.length === 0) return { action: 'no_grant' };

  // Find a grant matching the inferred topic, preferring exact match
  const inferredTopic = inferTopicFromAsk(ask);

  // Try exact topic match first, then any active grant as fallback
  let candidate: ConsentGrant | undefined = grants.find(
    (g) => g.topic === inferredTopic && g.status === 'active',
  );
  if (!candidate) {
    candidate = grants.find((g) => g.status === 'active');
  }

  if (!candidate) {
    // All grants are non-active — pick the first one to report the reason
    const first = grants[0];
    const resolved = resolveConsentGrant(q, first.id, { nowMs: opts.nowMs });
    if (!resolved.valid) {
      aq.updateAsk(ask.id, 'dismissed', null, null, null, `consent:${resolved.reason}`, 'dismiss', null, null);
      return { action: 'dismissed', grantId: first.id, reason: resolved.reason };
    }
    // Grant is valid but didn't match — treat as no_grant for this ask
    return { action: 'no_grant' };
  }

  // Resolve the candidate grant with bump
  const resolved = resolveConsentGrant(q, candidate.id, { bump: true, nowMs: opts.nowMs });

  if (!resolved.valid) {
    aq.updateAsk(ask.id, 'dismissed', null, null, null, `consent:${resolved.reason}`, 'dismiss', null, null);
    return { action: 'dismissed', grantId: candidate.id, reason: resolved.reason };
  }

  // Grant is valid — auto-answer the ask
  aq.updateAsk(
    ask.id,
    'answered',
    ask.assigned_to,
    null,
    null,
    `auto-answered by consent grant ${candidate.id} (${candidate.topic})`,
    'approve',
    ask.assigned_to,
    null,
  );

  return {
    action: 'auto_answered',
    grantId: candidate.id,
    grantTopic: candidate.topic,
    remainingAnswers: resolved.remainingAnswers,
  };
}
