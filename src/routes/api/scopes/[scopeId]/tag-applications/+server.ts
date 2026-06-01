/**
 * /api/scopes/[scopeId]/tag-applications — V2-server endpoint (D2 unblock).
 *
 * GET — list tag_applications for filter combinations:
 *   ?anchor=<anchorId>           List applications for one anchor.
 *   ?claim=<claimId>             List applications for one claim
 *                                 (relational tags: source.supports-claim,
 *                                 source.refutes-claim).
 *   ?run=<taggingRunId>          List applications written during one
 *                                 tagging run (audit/dispatch UI).
 *
 * Exactly ONE filter must be supplied. The substrate's listApplicationsFor
 * functions are keyed by anchor / claim / run respectively — no combined
 * scan path so we keep the contract narrow.
 *
 * scopeId is currently advisory (post-F1/F2 it becomes the org-namespace
 * gate); read access is open per the substrate trust-surface model.
 * Tag applications are part of the verification audit trail — visible
 * for review without auth, same as tag definitions + lens authoring shape.
 *
 * Consumer surface: D2 tag overlay (iOS), M12 right-click flag (Mac),
 * Verification Tags page audit feed.
 */

import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listApplicationsForAnchor,
  listApplicationsForClaim,
  listApplicationsForRun
} from '$lib/server/tagApplicationsStore';

export const GET: RequestHandler = async ({ url }) => {
  const anchor = url.searchParams.get('anchor');
  const claim = url.searchParams.get('claim');
  const run = url.searchParams.get('run');

  const supplied = [anchor, claim, run].filter((v) => v !== null && v !== '');
  if (supplied.length === 0) {
    throw error(
      400,
      'exactly one of ?anchor=<anchorId> | ?claim=<claimId> | ?run=<runId> required'
    );
  }
  if (supplied.length > 1) {
    throw error(
      400,
      'supply exactly one filter — combined anchor+claim+run scans not supported'
    );
  }

  if (anchor) return json({ applications: listApplicationsForAnchor(anchor) });
  if (claim) return json({ applications: listApplicationsForClaim(claim) });
  if (run) return json({ applications: listApplicationsForRun(run) });

  // Unreachable given the filter checks above; satisfies the type system.
  throw error(400, 'no filter resolved');
};
