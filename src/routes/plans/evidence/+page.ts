/**
 * /plans/evidence — Lane-D PLANS Evidence Harvest page loader.
 *
 * Parses ?kind / ?planId / ?q from the URL so links are shareable and
 * filter state survives a refresh, then proxies them to the public-read
 * /api/plans/evidence endpoint. depends() on url so goto({invalidateAll})
 * isn't required when the FE pushes new query params.
 */

import type { PageLoad } from './$types';
import type { EvidenceRef } from '$lib/server/planModeStore';
import type {
  EvidenceRow,
  EvidenceStats
} from '$lib/server/planEvidenceStore';

type EvidenceResponse = { evidence: EvidenceRow[]; stats: EvidenceStats };

const KINDS: ReadonlySet<EvidenceRef['kind']> = new Set<EvidenceRef['kind']>([
  'run_event',
  'task',
  'url',
  'file',
  'chat_message'
]);

export const load: PageLoad = async ({ fetch, url }) => {
  const kindRaw = url.searchParams.get('kind');
  const kind: EvidenceRef['kind'] | null =
    kindRaw && KINDS.has(kindRaw as EvidenceRef['kind'])
      ? (kindRaw as EvidenceRef['kind'])
      : null;
  const planId = url.searchParams.get('planId');
  const q = url.searchParams.get('q');

  const qs = new URLSearchParams();
  if (kind) qs.set('kind', kind);
  if (planId) qs.set('planId', planId);
  if (q) qs.set('q', q);
  const suffix = qs.toString();

  const res = await fetch(`/api/plans/evidence${suffix ? `?${suffix}` : ''}`);
  const data: EvidenceResponse = res.ok
    ? ((await res.json()) as EvidenceResponse)
    : {
        evidence: [],
        stats: {
          byKind: { run_event: 0, task: 0, url: 0, file: 0, chat_message: 0 },
          total: 0,
          withLabel: 0
        }
      };

  return {
    evidence: data.evidence,
    stats: data.stats,
    filter: { kind, planId, q }
  };
};
