/**
 * chatInviteAuth — shared admin-bearer auth helper for chat-invites routes.
 *
 * Lifted from src/routes/api/chat-invites/+server.ts:requireAdminAuth in the
 * M3.7b room-invite slice so the new revoke route can reuse the EXACT same
 * auth check rather than handcrafting a parallel path (per coordinator risk
 * flag 2026-05-13). Mirrors the identityGate.ts extraction pattern from
 * M3.b.5 T2.
 *
 * Behaviour is intentionally unchanged from the original helper:
 *   - 503 if ANT_ADMIN_TOKEN env is unset (fail-closed by default).
 *   - 401 on missing/wrong/short-circuited bearer (timingSafeEqual).
 *   - throws via SvelteKit's error() so caller gets a Response.
 *
 * The token VALUE is never logged or returned (per the canonical
 * secret-in-argv discipline).
 */
import { error } from '@sveltejs/kit';
import { timingSafeEqual } from 'crypto';

function adminBearerMatches(request: Request): boolean | null {
  const configured = process.env.ANT_ADMIN_TOKEN;
  if (!configured || configured.length === 0) return null;
  const header = request.headers.get('authorization') ?? '';
  const supplied = header.startsWith('Bearer ') ? header.slice(7) : '';
  if (supplied.length === 0) return false;
  const a = Buffer.from(supplied);
  const b = Buffer.from(configured);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function isAdminRequest(request: Request): boolean {
  return adminBearerMatches(request) === true;
}

export function requireAdminAuth(request: Request): void {
  const match = adminBearerMatches(request);
  if (match === null) {
    throw error(503, 'admin not configured');
  }
  if (!match) {
    throw error(401, 'admin auth required');
  }
}
