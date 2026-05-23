import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import { listValidationSchemas, seedValidationSchemas } from '$lib/server/validationLensStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';

// Containment-first per banked policy: any caller with the admin bearer can
// read the schema list. Schema scope (org/user/public) is a planned slice
// from JWPK's 2026-05-23 dictation; until that lands, treat the list as
// auth-required and let the future scope filter open up specific rows.
export const GET: RequestHandler = async ({ request }) => {
  if (!tryAdminBearer(request)) {
    throw error(401, 'Authentication required.');
  }
  seedValidationSchemas(); // idempotent
  const schemas = listValidationSchemas();
  return json({ schemas });
};
