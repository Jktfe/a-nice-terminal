/**
 * authDeprecation — M3.6a-v1 deprecation-window helper per JWPK Q1 lock
 * (2-week deprecation window with X-Auth-Deprecation header + warning logs;
 * strict-403 flip after cutover).
 *
 * Used by chat-room write routes that previously accepted legacy client-
 * supplied authorHandle without server-resolved identity. During the
 * warning phase the route still returns 200/201 but tags the response with
 * X-Auth-Deprecation and logs a server-side warning. After the cutover
 * date the helper returns strict=true and the route throws 403 with the
 * Q3 hint body.
 *
 * Window cutover defaults to 2026-05-28T00:00:00Z (ship+14d). Tests override
 * via ANT_AUTH_DEPRECATION_CUTOVER_MS env so both phases can be exercised
 * without time travel.
 *
 * Per Q2 lock the helper is ONLY called when both cookie + pidChain failed
 * to resolve. Cookie-present-invalid (M3.6a-v0 strict) is handled by the
 * caller BEFORE this helper fires — the helper never executes when a
 * present-but-invalid cookie has already 403'd.
 */
import { error } from '@sveltejs/kit';

const DEFAULT_CUTOVER_ISO = '2026-05-28T00:00:00.000Z';
export const AUTH_DEPRECATION_HEADER = 'x-auth-deprecation';
export const AUTH_DEPRECATION_HINT_BODY =
  'Server-resolved identity required. POST /api/chat-rooms/{roomId}/browser-session first, or supply a valid pidChain.';

export type DeprecationVerdict = {
  /** strict mode active — caller should throw 403 with hintBody. */
  strict: boolean;
  /** When in warning phase, set this header on the response. */
  headerName: string;
  headerValue: string;
  /** 403 body to throw with when strict. */
  hintBody: string;
};

function cutoverMs(): number {
  const override = process.env.ANT_AUTH_DEPRECATION_CUTOVER_MS;
  if (override && override.length > 0) {
    const parsed = Number(override);
    if (Number.isFinite(parsed)) return parsed;
  }
  return new Date(DEFAULT_CUTOVER_ISO).getTime();
}

export function evaluateDeprecation(routeLabel: string, now: number = Date.now()): DeprecationVerdict {
  const strict = now >= cutoverMs();
  const headerValue = strict
    ? `enforced;route=${routeLabel}`
    : `warning;route=${routeLabel};cutover=${new Date(cutoverMs()).toISOString()}`;
  if (!strict) {
    console.warn(`[auth-deprecation] ${routeLabel} accepted a request without server-resolved identity; strict flip at ${new Date(cutoverMs()).toISOString()}`);
  }
  return { strict, headerName: AUTH_DEPRECATION_HEADER, headerValue, hintBody: AUTH_DEPRECATION_HINT_BODY };
}

/**
 * Convenience: caller passes the route label; helper either throws 403 (strict)
 * OR returns the header pair to attach to a success response (warning).
 * Returns null in strict phase only after throwing — TypeScript discriminator.
 */
export function applyDeprecationOrThrow(routeLabel: string): { headerName: string; headerValue: string } {
  const verdict = evaluateDeprecation(routeLabel);
  if (verdict.strict) throw error(403, verdict.hintBody);
  return { headerName: verdict.headerName, headerValue: verdict.headerValue };
}
