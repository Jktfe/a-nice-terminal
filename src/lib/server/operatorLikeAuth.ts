import { error } from '@sveltejs/kit';
import {
  tryAdminBearer,
  tryAntchatOperatorBearer,
  tryOperatorSession
} from './chatRoomAuthGate';
import { bearerTokenFromHeader, normalizeAntchatEmail } from './antchatAuthStore';
import { resolveAccountsBearerIdentity } from './accountsBearerIdentity';
import { getOperatorEmail } from './operatorEmail';
import { getOperatorHandle } from './operatorHandle';

export function hasOperatorLikeAuth(request: Request): boolean {
  return tryAdminBearer(request) || tryOperatorSession(request) || tryAntchatOperatorBearer(request);
}

export async function hasOperatorLikeAuthAsync(request: Request): Promise<boolean> {
  if (hasOperatorLikeAuth(request)) return true;
  return tryAccountsOperatorBearer(request);
}

export function requireOperatorLikeAuth(
  request: Request,
  message = 'admin-bearer or operator session required'
): void {
  if (hasOperatorLikeAuth(request)) return;
  throw error(401, message);
}

export async function requireOperatorLikeAuthAsync(
  request: Request,
  message = 'admin-bearer or operator session required'
): Promise<void> {
  if (await hasOperatorLikeAuthAsync(request)) return;
  throw error(401, message);
}

export async function resolveOperatorLikeActorHandle(request: Request): Promise<string | null> {
  if (!(await hasOperatorLikeAuthAsync(request))) return null;
  return getOperatorHandle();
}

async function tryAccountsOperatorBearer(request: Request): Promise<boolean> {
  const operatorEmail = getOperatorEmail();
  if (!operatorEmail) return false;
  const token = bearerTokenFromHeader(request.headers.get('authorization'));
  if (!token) return false;
  const identity = await resolveAccountsBearerIdentity(token);
  if (!identity) return false;
  return normalizeAntchatEmail(identity.email) === normalizeAntchatEmail(operatorEmail);
}
