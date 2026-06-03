/**
 * operatorDisplayHandle — legacy OUT-only display translation for the operator.
 *
 * The clean identity model makes the operator structurally `@JWPK`, so this is
 * normally a no-op. It remains as a compatibility wrapper for older display
 * code that still calls through it.
 *
 * Configured via `ANT_OPERATOR_DISPLAY_HANDLE`. This is deliberately a
 * Unset (or empty) env var => identity passthrough, so production and tests
 * are unaffected unless the demo override is explicitly set.
 */

import { OPERATOR_SENTINEL } from '$lib/operatorSentinel';

/**
 * Map a handle to its outbound display label. Returns the configured
 * `ANT_OPERATOR_DISPLAY_HANDLE` when `handle` is the operator handle,
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
