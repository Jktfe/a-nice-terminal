/**
 * /api/verification/lenses/[lensId]/tag-rows — V2-server Phase A9 Slice 7b.
 *
 * GET -> 200 { rows: LensTagRow[] }
 *   List per-tag rows for the lens, creation-order ascending.
 *
 * POST body: {
 *   tag_id, tag_version?, expectation,
 *   min_verifier_count?, verifier_mix?, dispute_policy?, weight?, notes?,
 *   author_handle
 * }
 *   -> 201 { row: LensTagRow }
 *   -> 400 invalid input | orphan lens
 *
 * Auth: admin-bearer on POST (substrate boundary). GET is open read
 * (lens authoring shape is part of the trust surface, like tag audit).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  createLensTagRow,
  listLensTagRows
} from '$lib/server/lensTagRowsStore';
import type {
  LensTagDisputePolicy,
  LensTagExpectation
} from '$lib/server/lensTagRowsStore';
import { requireVerificationAuthorTier } from '$lib/server/featureGates';

const VALID_EXPECTATION = new Set<LensTagExpectation>([
  'required', 'forbidden', 'consensus-required', 'heuristic-allowed', 'out-of-scope'
]);
const VALID_DISPUTE_POLICY = new Set<LensTagDisputePolicy>([
  'majority', 'unanimous', 'any-pass', 'any-fail', 'escalate'
]);

function requireAdminBearer(request: Request): void {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) {
    throw error(401, 'Authorization: Bearer <admin-token> required');
  }
  const adminToken = process.env.ANT_ADMIN_BEARER;
  if (!adminToken || auth.slice(7) !== adminToken) {
    throw error(403, 'Admin bearer required');
  }
}

export const GET: RequestHandler = async ({ params }) => {
  const lensId = params.lensId;
  if (!lensId) throw error(400, 'lensId required');
  const rows = listLensTagRows(lensId);
  return json({ rows });
};

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminBearer(request);
  requireVerificationAuthorTier();
  const lensId = params.lensId;
  if (!lensId) throw error(400, 'lensId required');

  let body: Record<string, unknown>;
  try { body = await request.json(); }
  catch { throw error(400, 'JSON body required'); }

  const tagId = body.tag_id;
  const expectation = body.expectation as LensTagExpectation;
  const authorHandle = body.author_handle;
  if (typeof tagId !== 'string' || !tagId) throw error(400, 'tag_id (string) required');
  if (!VALID_EXPECTATION.has(expectation)) {
    throw error(400, `expectation must be one of: ${[...VALID_EXPECTATION].join(', ')}`);
  }
  if (typeof authorHandle !== 'string' || !authorHandle) {
    throw error(400, 'author_handle (string) required');
  }
  const disputePolicy = body.dispute_policy as LensTagDisputePolicy | undefined;
  if (disputePolicy && !VALID_DISPUTE_POLICY.has(disputePolicy)) {
    throw error(400, `dispute_policy must be one of: ${[...VALID_DISPUTE_POLICY].join(', ')}`);
  }
  const verifierMix = body.verifier_mix;
  if (verifierMix !== undefined && (!Array.isArray(verifierMix) || verifierMix.some((v) => typeof v !== 'string'))) {
    throw error(400, 'verifier_mix must be an array of strings');
  }
  const weight = body.weight;
  if (weight !== undefined && (typeof weight !== 'number' || !Number.isFinite(weight))) {
    throw error(400, 'weight must be a finite number');
  }
  const minVerifierCount = body.min_verifier_count;
  if (minVerifierCount !== undefined && (typeof minVerifierCount !== 'number' || !Number.isInteger(minVerifierCount) || minVerifierCount < 1)) {
    throw error(400, 'min_verifier_count must be a positive integer');
  }

  try {
    const row = createLensTagRow({
      lensId,
      tagId,
      tagVersion: typeof body.tag_version === 'number' ? body.tag_version : null,
      expectation,
      minVerifierCount: typeof minVerifierCount === 'number' ? minVerifierCount : undefined,
      verifierMix: Array.isArray(verifierMix) ? (verifierMix as string[]) : undefined,
      disputePolicy,
      weight: typeof weight === 'number' ? weight : undefined,
      notes: typeof body.notes === 'string' ? body.notes : null,
      createdBy: authorHandle
    });
    return json({ row }, { status: 201 });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    if (msg.includes('does not exist')) throw error(404, msg);
    throw error(400, `createLensTagRow failed: ${msg}`);
  }
};
