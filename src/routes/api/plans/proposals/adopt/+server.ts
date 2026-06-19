/**
 * POST /api/plans/proposals/adopt — M-ProposalTracks opt-in flow.
 *
 * Creates a plan_decision event when a human adopts a Proposal Track.
 * Body: { planId, taskId, ref, label }.
 * Returns: { decision }.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { appendPlanEvent } from '$lib/server/planModeStore';
import { getPlan } from '$lib/server/planStore';
import { getOperatorHandle } from '$lib/server/operatorHandle';
import { requireOperatorLikeAuth } from '$lib/server/operatorLikeAuth';

export const POST: RequestHandler = async ({ request }) => {
  requireOperatorLikeAuth(request);
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    throw error(400, 'JSON body required with planId, taskId, ref.');
  }

  const planId = body.planId;
  const taskId = body.taskId;
  const ref = body.ref;
  const label = body.label ?? 'Adopted proposal';

  if (typeof planId !== 'string' || planId.length === 0) {
    throw error(400, 'planId (string) required.');
  }
  if (typeof taskId !== 'string' || taskId.length === 0) {
    throw error(400, 'taskId (string) required.');
  }
  if (typeof ref !== 'string' || ref.length === 0) {
    throw error(400, 'ref (string) required.');
  }

  const plan = getPlan(planId);
  if (!plan) throw error(404, 'Plan not found.');

  const decision = {
    id: `decision-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    plan_id: planId,
    parent_id: taskId,
    kind: 'plan_decision' as const,
    title: `Adopt: ${label}`,
    body: `Proposal Track adopted. Ref: ${ref}`,
    status: 'done' as const,
    owner: getOperatorHandle(),
    order: Date.now(),
    author_handle: getOperatorHandle(),
    author_kind: 'human' as const,
    ts_millis: Date.now(),
    evidence: [{ kind: 'proposal' as const, ref, label }],
    provenance: { source: 'proposal_track', author: '@speedykimi' }
  };

  appendPlanEvent(decision);

  return json({ decision });
};
