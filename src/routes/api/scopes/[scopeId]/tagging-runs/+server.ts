/**
 * /api/scopes/[scopeId]/tagging-runs — V2-server Phase A9 (Slice 7a).
 *
 * Consumed by `ant tags apply <scope>` CLI verb. One POST starts a
 * run + writes N tag_applications + completes the run, all as one
 * server-side transaction so partial-tag state can't leak out.
 *
 * Two shapes supported per request:
 *
 * 1. **Atomic batch** (typical CLI use):
 *      POST body: {
 *        scope_kind: 'artefact'|'message'|'file'|'document'|'room',
 *        initiator_handle: '@a',
 *        initiator_kind: 'human'|'agent'|'system',
 *        run_reason?: string,
 *        applications: [{
 *          tag_id: string,
 *          tag_version: number,
 *          target_anchor_id: string,
 *          target_claim_id?: string | null,
 *          applied_reason?: string | null,
 *          applicator_handle: string,
 *          applicator_kind: 'human'|'agent'|'system'
 *        }, ...]
 *      }
 *      -> 201 { run: TaggingRun, applications: TagApplication[] }
 *
 *  2. **Start-only** (when applications stream in via separate POSTs):
 *      POST body: { scope_kind, initiator_handle, initiator_kind,
 *        run_reason?: string }
 *      -> 201 { run: TaggingRun, applications: [] }
 *
 * Auth: admin-bearer for now. Org-admin gating arrives with F1/F2
 * license-time namespace provisioning; until then admin-bearer is the
 * substrate boundary.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  applyTag,
  completeTaggingRun,
  startTaggingRun
} from '$lib/server/tagApplicationsStore';
import type { TaggingRunScopeKind, ApplicatorKind, TagApplication } from '$lib/server/tagApplicationsStore';

const VALID_SCOPE_KINDS = new Set<TaggingRunScopeKind>([
  'artefact', 'message', 'file', 'document', 'room'
]);
const VALID_ACTOR_KINDS = new Set<ApplicatorKind>(['human', 'agent', 'system']);

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

export const POST: RequestHandler = async ({ request, params }) => {
  requireAdminBearer(request);
  const scopeId = params.scopeId;
  if (!scopeId) throw error(400, 'scopeId required');

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    throw error(400, 'JSON body required');
  }

  const scopeKind = body.scope_kind as TaggingRunScopeKind;
  if (!VALID_SCOPE_KINDS.has(scopeKind)) {
    throw error(400, `scope_kind must be one of: ${[...VALID_SCOPE_KINDS].join(', ')}`);
  }
  const initiatorHandle = body.initiator_handle as string;
  const initiatorKind = body.initiator_kind as ApplicatorKind;
  if (!initiatorHandle || !VALID_ACTOR_KINDS.has(initiatorKind)) {
    throw error(400, 'initiator_handle + initiator_kind (human/agent/system) required');
  }

  const run = startTaggingRun({
    scopeId,
    scopeKind,
    initiatorHandle,
    initiatorKind,
    runReason: typeof body.run_reason === 'string' ? body.run_reason : null
  });

  const applicationsInput = Array.isArray(body.applications) ? body.applications : [];
  const writtenApplications: TagApplication[] = [];
  for (const app of applicationsInput) {
    if (!app || typeof app !== 'object') {
      throw error(400, 'each application must be an object');
    }
    const a = app as Record<string, unknown>;
    const tagId = a.tag_id;
    const tagVersion = a.tag_version;
    const targetAnchorId = a.target_anchor_id;
    const applicatorHandle = a.applicator_handle;
    const applicatorKind = a.applicator_kind as ApplicatorKind;
    if (typeof tagId !== 'string' || typeof tagVersion !== 'number'
        || typeof targetAnchorId !== 'string' || typeof applicatorHandle !== 'string'
        || !VALID_ACTOR_KINDS.has(applicatorKind)) {
      throw error(400, 'application requires: tag_id (string), tag_version (number), target_anchor_id (string), applicator_handle (string), applicator_kind (human/agent/system)');
    }
    try {
      const written = applyTag({
        tagId,
        tagVersion,
        targetAnchorId,
        targetClaimId: typeof a.target_claim_id === 'string' ? a.target_claim_id : null,
        applicatorHandle,
        applicatorKind,
        appliedReason: typeof a.applied_reason === 'string' ? a.applied_reason : null,
        taggingRunId: run.id
      });
      writtenApplications.push(written);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : String(cause);
      throw error(400, `applyTag failed: ${msg}`);
    }
  }

  // Auto-complete if applications were submitted in the same call (atomic batch).
  // Start-only mode (no applications array) leaves the run in-flight so
  // subsequent POSTs can add more applications before manual completion.
  let finalRun = run;
  if (applicationsInput.length > 0) {
    const completed = completeTaggingRun(run.id);
    if (completed) finalRun = completed;
  }

  return json({ run: finalRun, applications: writtenApplications }, { status: 201 });
};
