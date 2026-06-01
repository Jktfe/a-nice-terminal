/**
 * operatorDisplayHandle — OUT-only display translation for the operator
 * sentinel.
 *
 * The internal operator identity is the `@you` sentinel (OPERATOR_HANDLE),
 * which is load-bearing across auth bypass (kill / agent-launch / vault),
 * kind detection, `whoCreatedIt`, and inbox-edge routing. It MUST NEVER be
 * rewritten in those paths.
 *
 * For demo / branding we render the operator under a human handle (e.g.
 * `@JWPK`) at the moment of serialization to the client. This function is the
 * ONLY place that translation happens, and it is applied ONLY to outbound,
 * human-readable label fields (`displayName`, `authorDisplayName`) — never to
 * the structural `handle` / `authorHandle` the client keys off, never to a
 * value written to the DB or compared in logic.
 *
 * Configured via `ANT_OPERATOR_DISPLAY_HANDLE`. This is deliberately a
 * SEPARATE var from `ANT_DEMO_HANDLE`: that one is the demo LOGIN identity
 * (demo-login binds the browser session to it and writes it into
 * author_handle / memberships), so overloading it to `@JWPK` would make
 * `@JWPK` the internal truth — the exact guardrail violation this split
 * avoids. Keep `ANT_DEMO_HANDLE` at its `@you` default.
 *
 * Unset (or empty) env var => identity passthrough, so production and tests
 * are unaffected unless the demo override is explicitly set.
 */

import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';

/**
 * Map a handle to its outbound display label. Returns the configured
 * `ANT_OPERATOR_DISPLAY_HANDLE` when `handle` is the operator sentinel,
 * otherwise the handle unchanged.
 *
 * @param handle - the stored/structural handle (or display-name source)
 * @returns the label to show the client (never used as a stored/compared key)
 */
export function operatorDisplayHandle(handle: string): string {
  const override = process.env.ANT_OPERATOR_DISPLAY_HANDLE;
  if (override && override.length > 0 && handle === OPERATOR_SENTINEL) {
    return override;
  }
  return handle;
}
