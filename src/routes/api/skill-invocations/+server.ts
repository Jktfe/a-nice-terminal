/**
 * /api/skill-invocations — append-only audit log of skill invocations.
 *
 * Per the corrected architecture (JWPK eiw05zdurz msg_pgp1n75ufb +
 * msg_o1e307juug 2026-05-28):
 *
 * Skills are TASK DEFINITIONS that agents (or users via interactive
 * pages) execute. Both paths post a skill_invocations audit row here
 * to record "skill X was followed by handler Y at time T". The
 * substrate-level audit captures the skill-as-followed-protocol
 * context; the per-row tag_applications + verification_observations
 * already record the discrete tag/verdict actions with their own
 * applicator_handle.
 *
 * POST body:
 *   {
 *     skill_id: string,             // e.g. 'create-verification-lens'
 *     invoker_handle: string,       // who executed the skill
 *     invoker_kind: 'human'|'agent'|'system',
 *     scope_id: string,             // org or 'global' for system-scoped
 *     requirements: string,         // raw input text (or '' for page-driven)
 *     input_json: string,           // full input as JSON string
 *     output_json: string,          // full output as JSON string
 *     output_lens_id?: string,      // for create-verification-lens success
 *     error_kind?: string,          // for refusals / failures
 *     model_used?: string,          // optional — what model the agent ran
 *     cost_estimate_usd?: number    // optional — caller-reported cost
 *   }
 *   -> 201 { invocation: SkillInvocation }
 *
 * Auth: admin-bearer for now. Page surfaces (which act as the user)
 * + agent terminals both have admin-bearer at this stage; F1/F2 will
 * introduce org-scoped auth.
 *
 * GET ?scope=&invoker=&skill=&since=&limit= — read audit feed.
 * Open read per substrate trust-surface model.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listSkillInvocations,
  recordSkillInvocation
} from '$lib/server/skillInvocationsStore';
import type { InvokerKind } from '$lib/server/skillInvocationsStore';

const VALID_INVOKER_KIND = new Set<InvokerKind>(['human', 'agent', 'system']);

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_TOKEN;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const POST: RequestHandler = async ({ request }) => {
  requireAdminBearer(request);

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { throw error(400, 'JSON body required'); }

  const skillId = body.skill_id;
  const invokerHandle = body.invoker_handle;
  const invokerKind = body.invoker_kind as InvokerKind;
  const scopeId = body.scope_id;
  const requirements = body.requirements;
  const inputJson = body.input_json;
  const outputJson = body.output_json;

  if (typeof skillId !== 'string' || !skillId) throw error(400, 'skill_id (string) required');
  if (typeof invokerHandle !== 'string' || !invokerHandle) {
    throw error(400, 'invoker_handle (string) required');
  }
  if (!VALID_INVOKER_KIND.has(invokerKind)) {
    throw error(400, `invoker_kind must be one of: ${[...VALID_INVOKER_KIND].join(', ')}`);
  }
  if (typeof scopeId !== 'string' || !scopeId) throw error(400, 'scope_id (string) required');
  if (typeof requirements !== 'string') throw error(400, 'requirements (string) required');
  if (typeof inputJson !== 'string') throw error(400, 'input_json (string) required');
  if (typeof outputJson !== 'string') throw error(400, 'output_json (string) required');

  const invocation = recordSkillInvocation({
    skillId,
    invokerHandle,
    invokerKind,
    scopeId,
    requirements,
    inputJson,
    outputJson,
    outputLensId: typeof body.output_lens_id === 'string' ? body.output_lens_id : null,
    errorKind: typeof body.error_kind === 'string' ? body.error_kind : null,
    modelUsed: typeof body.model_used === 'string' ? body.model_used : null,
    costEstimateUsd: typeof body.cost_estimate_usd === 'number' ? body.cost_estimate_usd : null
  });
  return json({ invocation }, { status: 201 });
};

export const GET: RequestHandler = async ({ url }) => {
  const scope = url.searchParams.get('scope');
  const invoker = url.searchParams.get('invoker');
  const skill = url.searchParams.get('skill');
  const sinceParam = url.searchParams.get('since');
  const limitParam = url.searchParams.get('limit');

  const since = sinceParam ? Number(sinceParam) : undefined;
  if (since !== undefined && !Number.isFinite(since)) {
    throw error(400, 'since must be a number (ms)');
  }
  const limit = limitParam ? Number(limitParam) : undefined;
  if (limit !== undefined && !Number.isFinite(limit)) {
    throw error(400, 'limit must be a number');
  }

  const invocations = listSkillInvocations({
    scopeId: scope ?? undefined,
    invokerHandle: invoker ?? undefined,
    skillId: skill ?? undefined,
    since,
    limit
  });
  return json({ invocations });
};
