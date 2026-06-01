/**
 * /plans/proposals — M-ProposalTracks surface.
 *
 * Loads evidence refs of kind 'proposal' across all tasks.
 * Reuses the public-read /api/plans/evidence endpoint with
 * ?kind=proposal filter.
 */

import type { PageLoad } from './$types';
import type { EvidenceRow } from '$lib/server/planEvidenceStore';

type EvidenceResponse = { evidence: EvidenceRow[]; stats: { total: number } };

export const load: PageLoad = async ({ fetch }) => {
  const res = await fetch('/api/plans/evidence?kind=proposal');
  const data: EvidenceResponse = res.ok
    ? ((await res.json()) as EvidenceResponse)
    : { evidence: [], stats: { total: 0 } };

  return {
    proposals: data.evidence,
    total: data.stats.total
  };
};
