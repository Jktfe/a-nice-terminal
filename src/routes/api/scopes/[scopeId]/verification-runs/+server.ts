/**
 * /api/scopes/[scopeId]/verification-runs — V2-server Phase A9 (Slice 7a).
 *
 * Consumed by `ant verify <scope> --lens <lens>` CLI verb. Records a
 * verdict against verification_observations (append-only — never
 * mutates an existing row).
 *
 * POST body: {
 *   lens_id: string,
 *   claim_anchor: string,        // typically `artefact:<id>#<frag>` or similar
 *   claim_text: string,
 *   status: 'pending'|'running'|'passed'|'failed'|'waived'
 *         |'dispute'|'insufficient_evidence'|'retag_required',
 *   verifier_handle: string,
 *   verifier_kind: 'human'|'agent'|'system'|'automated',
 *   score?: number | null,
 *   result_json?: string | null,
 *   parent_observation_id?: string | null,   // chain link for corrections
 *   dispute_reason?: string | null,          // required when status='dispute'
 *   run_by?: string | null                   // defaults to verifier_handle
 * }
 *   -> 201 { verdict: VerificationVerdict }
 *   -> 400 invalid body / orphan parent / dispute without reason
 *   -> 401/403 auth failures
 *
 * GET /api/scopes/[scopeId]/verification-runs?lens=<lensId>&claim=<anchor>
 *   -> 200 { effective: VerificationVerdict | null, chain: VerificationVerdict[] }
 *
 * scopeId param is currently advisory (server-side store keys by
 * lens_id + claim_anchor). When scope-level authz lands (F1/F2),
 * scopeId will become the org-namespace gate.
 *
 * Auth: admin-bearer (substrate boundary until F1/F2 org-admin gating).
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  getEffectiveVerdict,
  listVerdictChain,
  recordVerdict
} from '$lib/server/verificationVerdictsStore';
import type { VerdictStatus, VerifierKind } from '$lib/server/verificationVerdictsStore';

const VALID_STATUS = new Set<VerdictStatus>([
  'pending', 'running', 'passed', 'failed', 'waived',
  'dispute', 'insufficient_evidence', 'retag_required'
]);
const VALID_VERIFIER_KIND = new Set<VerifierKind>(['human', 'agent', 'system', 'automated']);

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

export const POST: RequestHandler = async ({ request }) => {
  requireAdminBearer(request);

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }

  const lensId = body.lens_id;
  const claimAnchor = body.claim_anchor;
  const claimText = body.claim_text;
  const status = body.status as VerdictStatus;
  const verifierHandle = body.verifier_handle;
  const verifierKind = body.verifier_kind as VerifierKind;

  if (typeof lensId !== 'string' || !lensId
      || typeof claimAnchor !== 'string' || !claimAnchor
      || typeof claimText !== 'string'
      || typeof verifierHandle !== 'string' || !verifierHandle) {
    throw error(400, 'lens_id, claim_anchor, claim_text, verifier_handle (all strings) required');
  }
  if (!VALID_STATUS.has(status)) {
    throw error(400, `status must be one of: ${[...VALID_STATUS].join(', ')}`);
  }
  if (!VALID_VERIFIER_KIND.has(verifierKind)) {
    throw error(400, `verifier_kind must be one of: ${[...VALID_VERIFIER_KIND].join(', ')}`);
  }

  try {
    const verdict = recordVerdict({
      lensId,
      claimAnchor,
      claimText,
      status,
      verifierHandle,
      verifierKind,
      score: typeof body.score === 'number' ? body.score : null,
      resultJson: typeof body.result_json === 'string' ? body.result_json : null,
      parentObservationId: typeof body.parent_observation_id === 'string' ? body.parent_observation_id : null,
      disputeReason: typeof body.dispute_reason === 'string' ? body.dispute_reason : null,
      runBy: typeof body.run_by === 'string' ? body.run_by : null
    });
    return json({ verdict }, { status: 201 });
  } catch (cause) {
    const msg = cause instanceof Error ? cause.message : String(cause);
    throw error(400, `recordVerdict failed: ${msg}`);
  }
};

export const GET: RequestHandler = async ({ request, url }) => {
  requireAdminBearer(request);
  const lensId = url.searchParams.get('lens');
  const claimAnchor = url.searchParams.get('claim');
  if (!lensId || !claimAnchor) {
    throw error(400, 'lens + claim query params required');
  }
  const effective = getEffectiveVerdict(lensId, claimAnchor);
  const chain = listVerdictChain(lensId, claimAnchor);
  return json({ effective, chain });
};
