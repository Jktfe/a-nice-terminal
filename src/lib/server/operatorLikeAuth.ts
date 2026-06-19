import { error } from '@sveltejs/kit';
import {
  tryAdminBearer,
  tryAntchatOperatorBearer,
  tryOperatorSession
} from './chatRoomAuthGate';

export function hasOperatorLikeAuth(request: Request): boolean {
  return tryAdminBearer(request) || tryOperatorSession(request) || tryAntchatOperatorBearer(request);
}

export function requireOperatorLikeAuth(
  request: Request,
  message = 'admin-bearer or operator session required'
): void {
  if (hasOperatorLikeAuth(request)) return;
  throw error(401, message);
}
