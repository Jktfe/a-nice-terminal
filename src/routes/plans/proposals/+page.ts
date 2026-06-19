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

async function loadFailureMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as { message?: unknown } | null;
  const message = typeof body?.message === 'string' ? body.message.trim() : '';
  return message || `HTTP ${response.status}`;
}

export const load: PageLoad = async ({ fetch }) => {
  try {
    const res = await fetch('/api/plans/evidence?kind=proposal');
    if (!res.ok) {
      return {
        proposals: [],
        total: 0,
        proposalsFetchFailed: true,
        proposalsFetchMessage: await loadFailureMessage(res)
      };
    }
    const data = (await res.json()) as EvidenceResponse;

    return {
      proposals: data.evidence,
      total: data.stats.total,
      proposalsFetchFailed: false,
      proposalsFetchMessage: ''
    };
  } catch (cause) {
    return {
      proposals: [],
      total: 0,
      proposalsFetchFailed: true,
      proposalsFetchMessage: cause instanceof Error ? cause.message : 'Network error'
    };
  }
};
