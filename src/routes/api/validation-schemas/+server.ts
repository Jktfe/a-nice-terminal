import { json, error } from '@sveltejs/kit';
import type { RequestHandler } from './$types';
import {
  listValidationSchemas,
  seedValidationSchemas,
  type ValidationSchemaVisibility
} from '$lib/server/validationLensStore';
import { tryAdminBearer } from '$lib/server/chatRoomAuthGate';
import { bearerTokenFromHeader } from '$lib/server/antchatAuthStore';
import { resolveAccountsBearerIdentity } from '$lib/server/accountsBearerIdentity';

async function visibilityForRequest(request: Request): Promise<ValidationSchemaVisibility> {
  if (tryAdminBearer(request)) {
    return { isAdmin: true };
  }
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) {
    return { isAdmin: false, handles: [] };
  }
  const identity = await resolveAccountsBearerIdentity(token);
  if (!identity) {
    throw error(401, 'Authentication required.');
  }
  return {
    isAdmin: false,
    handles: identity.handles,
    ...(identity.orgId && { orgId: identity.orgId })
  };
}

export const GET: RequestHandler = async ({ request }) => {
  seedValidationSchemas(); // idempotent
  const visibleTo = await visibilityForRequest(request);
  const schemas = listValidationSchemas({ visibleTo });
  return json({ schemas });
};
