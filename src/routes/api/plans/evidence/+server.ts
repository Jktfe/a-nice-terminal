/**
 * GET /api/plans/evidence — Lane-D PLANS Evidence Harvest.
 *
 * Flat corpus of every `task.evidence[]` entry across non-deleted tasks,
 * with optional filters. Returns `{evidence, stats}` so the FE can render a
 * header counter + grouped list in one round-trip.
 *
 * rv1 data-scoping fix: this used to be public-read and returned EVERY
 * evidence entry server-wide. An evidence row is now only visible when its
 * owning plan is attached to a room the caller is a member of; standalone
 * evidence (no planId) is operator-only by the same rule. The `stats`
 * counter is recomputed from the SCOPED rows so it can't leak the global
 * total. Admin-bearer keeps full access (containment, like /api/tasks).
 *
 * Query params: ?kind=, ?planId=, ?q=, ?limit= (default 200, max 1000).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listAllEvidence,
  isEvidenceKind,
  type EvidenceListOpts,
  type EvidenceRow,
  type EvidenceStats,
  type TaskEvidenceKind
} from '$lib/server/planEvidenceStore';
import { resolveReadableRoomScope } from '$lib/server/chatRoomReadGate';
import { listRoomsForPlan } from '$lib/server/planRoomLinkStore';

/**
 * Recompute the header counters over the rows the caller may actually see,
 * mirroring evidenceStats()'s shape so the FE counter cannot leak the global
 * total to a non-member.
 */
function statsForRows(rows: EvidenceRow[]): EvidenceStats {
  const byKind: Record<TaskEvidenceKind, number> = {
    run_event: 0,
    task: 0,
    url: 0,
    file: 0,
    chat_message: 0,
    proposal: 0,
    stage_focus: 0,
    stage_pause_context: 0,
    stage_feedback: 0,
    stage_alternative: 0,
    stage_alternative_decision: 0
  };
  let withLabel = 0;
  for (const row of rows) {
    byKind[row.kind] += 1;
    if (row.label && row.label.trim().length > 0) withLabel += 1;
  }
  return { byKind, total: rows.length, withLabel };
}

export const GET: RequestHandler = async ({ url, request }) => {
  const scope = await resolveReadableRoomScope(request);

  // Cache plan→readable resolution so a corpus with many rows sharing a plan
  // doesn't re-query plan_rooms per row.
  const planReadable = new Map<string, boolean>();
  const isRowReadable = (row: EvidenceRow): boolean => {
    if (scope.isAdminBearer) return true;
    if (row.planId === null) return false; // standalone evidence → operator-only
    const cached = planReadable.get(row.planId);
    if (cached !== undefined) return cached;
    const readable = listRoomsForPlan(row.planId).some((r) => scope.roomIds.has(r.roomId));
    planReadable.set(row.planId, readable);
    return readable;
  };

  // Stats are computed over the caller's FULL visible corpus (scope-filtered,
  // BEFORE query filters) so the header counter keeps its original "global"
  // semantics relative to what the caller may see — never the server-wide
  // total. The kind/planId/q/limit query filters narrow only the returned
  // `evidence` list, matching the pre-fix contract.
  const visibleAll = scope.isAdminBearer
    ? listAllEvidence()
    : listAllEvidence().filter(isRowReadable);
  const stats = statsForRows(visibleAll);

  const opts: EvidenceListOpts = {};
  const kindRaw = url.searchParams.get('kind');
  if (kindRaw && isEvidenceKind(kindRaw)) opts.kind = kindRaw;
  const planId = url.searchParams.get('planId');
  if (planId) opts.planId = planId;
  const q = url.searchParams.get('q');
  if (q) opts.q = q;
  const limitRaw = url.searchParams.get('limit');
  if (limitRaw !== null) {
    const parsed = Number.parseInt(limitRaw, 10);
    if (Number.isFinite(parsed)) opts.limit = parsed;
  }
  const filtered = listAllEvidence(opts);
  const evidence = scope.isAdminBearer ? filtered : filtered.filter(isRowReadable);

  return json({ evidence, stats });
};
