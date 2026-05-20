/**
 * GET /api/plans/evidence — Lane-D PLANS Evidence Harvest.
 *
 * Flat corpus of every `task.evidence[]` entry across non-deleted tasks,
 * with optional filters. Public-read (no auth — same model as
 * /api/plans/completions). Returns `{evidence, stats}` so the FE can
 * render a header counter + grouped list in one round-trip.
 *
 * Query params: ?kind=, ?planId=, ?q=, ?limit= (default 200, max 1000).
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listAllEvidence,
  evidenceStats,
  isEvidenceKind,
  type EvidenceListOpts
} from '$lib/server/planEvidenceStore';

export const GET: RequestHandler = async ({ url }) => {
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
  const evidence = listAllEvidence(opts);
  const stats = evidenceStats();
  return json({ evidence, stats });
};
