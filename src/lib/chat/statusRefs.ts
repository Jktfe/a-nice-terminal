/**
 * Inline status boards for chat messages.
 *
 * A status board (the `/status-poll` milestone tracker, JWPK msg_39mnm7blal)
 * embeds a live board the same way a poll embeds one: a fenced block tagged
 * `ant-status` whose body is a board id.
 *
 *   ```ant-status
 *   status_abc123
 *   ```
 *
 * This mirrors `pollRefs` (the `ant-poll` fence) exactly — same extraction
 * rail, same MessageRow mount path — but resolves to a StatusBoard widget
 * instead of a PollWidget. The board id is a vote id with `kind:'status'`
 * (participant→state is the same shape as voter→choice, so the status board
 * reuses the vote store rather than a parallel persistence path).
 *
 * Kept as a sibling of pollRefs rather than a shared generic so the live,
 * verified poll (`pollRefs.ts`) is never touched while this lands; the two
 * can fold into one `extractFenceRefs(body, tag)` helper once both are stable.
 */

// A board id is a single safe token (a vote id: randomUUID hex+dashes, or a
// status_-prefixed id). Anything else is refused so a malformed fence can't
// drive a widget mount with attacker-shaped input.
const SAFE_BOARD_ID = /^[A-Za-z0-9_-]+$/;

// Fenced block: optional indent, ```ant-status, newline, inner, newline,
// closing ```. Multiline + case-insensitive.
const STATUS_FENCE_RE = /^[ \t]*```[ \t]*ant-status[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gim;

export type StatusExtraction = {
  /** Distinct, valid board ids referenced, in first-seen order. */
  boardIds: string[];
  /** The message body with every ant-status fence removed + whitespace tidied. */
  body: string;
};

/**
 * Pull every `ant-status` fence out of a raw message body. Returns the
 * referenced board ids (deduped, first-seen order) and the body with those
 * fences stripped so the markdown renderer never sees them. Invalid/empty
 * fences are dropped silently and leave no widget.
 */
export function extractStatusRefs(raw: string | null | undefined): StatusExtraction {
  if (!raw) return { boardIds: [], body: '' };
  const boardIds: string[] = [];
  const seen = new Set<string>();
  const stripped = raw.replace(STATUS_FENCE_RE, (_match, inner: string) => {
    const id = firstToken(inner);
    if (id && SAFE_BOARD_ID.test(id) && !seen.has(id)) {
      seen.add(id);
      boardIds.push(id);
    }
    return '';
  });
  const body = stripped.replace(/\n{3,}/g, '\n\n').trim();
  return { boardIds, body };
}

function firstToken(inner: string): string {
  for (const line of inner.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}
