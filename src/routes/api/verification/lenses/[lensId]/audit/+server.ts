/**
 * /api/verification/lenses/:lensId/audit — read lens change history.
 *
 * Owners can inspect archived lens history. Public active lenses expose their
 * audit trail to readers so consumers can see who changed the verification bar.
 */

import { json } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listValidationSchemaAuditForSchema } from '$lib/server/validationLensStore';
import { requireAuditReadableLens, resolveLensActor } from '$lib/server/verificationLensApi';

export const GET: RequestHandler = ({ params, request }) => {
  const actor = resolveLensActor(request, null);
  const lens = requireAuditReadableLens(params.lensId, actor);
  return json({ audit: listValidationSchemaAuditForSchema(lens.id) });
};
