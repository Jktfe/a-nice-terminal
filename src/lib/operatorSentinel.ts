/**
 * The internal operator sentinel handle.
 *
 * This is the canonical, load-bearing identity of the human operator across
 * the whole substrate: it is what gets written into `chat_messages
 * .author_handle`, `chat_rooms.whoCreatedIt`, membership rows, and what every
 * server-side operator check compares against (auth bypass on kill /
 * agent-launch / vault, kind detection, inbox-edge routing). It MUST NOT be
 * rewritten in any of those paths.
 *
 * Display layers MAY render it under a human handle (see
 * `operatorDisplayHandle()` + the `ANT_OPERATOR_DISPLAY_HANDLE` env var), but
 * that translation is OUT-only and never flows back into a stored or compared
 * value.
 *
 * This module is client-safe (no `$lib/server` imports) precisely so the
 * render layer (e.g. `MessageRowHeader.svelte`) can reference the same literal
 * the server uses, instead of duplicating the `'@you'` string and risking
 * drift. The server-side `OPERATOR_HANDLE` in `allowlistGuard.ts` re-exports
 * this so there is a single source of truth.
 */
export const OPERATOR_SENTINEL = '@you';
