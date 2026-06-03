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
