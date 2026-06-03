/**
 * The internal operator handle.
 *
 * This is the canonical, load-bearing identity of the human operator across
 * the whole substrate: it is what gets written into `chat_messages
 * .author_handle`, `chat_rooms.whoCreatedIt`, membership rows, and what every
 * server-side operator check compares against (auth bypass on kill /
 * agent-launch / vault, kind detection, inbox-edge routing). It MUST NOT be
 * rewritten in any of those paths.
 *
 * The old implementation used `@you` here and sometimes displayed it as a
 * friendlier label. The clean identity model is simpler: the operator is
 * structurally `@JWPK` everywhere.
 *
 * This module is client-safe (no `$lib/server` imports) precisely so the
 * render layer (e.g. `MessageRowHeader.svelte`) can reference the same literal
 * the server uses, instead of duplicating the `@JWPK` string and risking
 * drift. The server-side `OPERATOR_HANDLE` in `allowlistGuard.ts` re-exports
 * this so there is a single source of truth.
 */
export const OPERATOR_SENTINEL = '@JWPK';

/**
 * Canonical operator handle for MEMBERSHIP/OWNERSHIP comparisons.
 *
 * The identity migration moved the operator's stored membership + ownership to
 * `@JWPK`, but clients (and some stored defaults) still present the legacy
 * `@you` sentinel. This maps the legacy sentinel to the canonical operator
 * handle so an operator-sent `@you` resolves against an `@JWPK` membership —
 * the same `@you -> @JWPK` canonicalisation the post path already applies.
 * Transitional until `@you` is fully retired; after that this is a no-op for
 * the already-canonical handle.
 */
export function canonicalOperatorHandle(handle: string): string {
  return handle === '@you' ? OPERATOR_SENTINEL : handle;
}

export function canonicalOperatorHandleForMembers(
  handle: string,
  members: Iterable<{ handle: string }>
): string {
  const canonicalHandle = canonicalOperatorHandle(handle);
  if (canonicalHandle === handle) return handle;
  for (const member of members) {
    if (member.handle === canonicalHandle) return canonicalHandle;
  }
  return handle;
}
