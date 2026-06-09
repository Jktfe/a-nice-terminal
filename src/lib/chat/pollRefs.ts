/**
 * Inline poll blocks for chat messages.
 *
 * A message embeds a live poll the same way it embeds a code fence or a
 * GFM table: a fenced block tagged `ant-poll` whose body is a voteId.
 *
 *   ```ant-poll
 *   vote_abc123
 *   ```
 *
 * MessageRow extracts the voteIds BEFORE markdown rendering (so the raw
 * fence never reaches `renderMarkdown`) and mounts one <PollWidget> per
 * id alongside the sanitized HTML. `{@html}` can't mount a Svelte
 * component, so the poll renders as a sibling of the message body, not
 * inside its string — the same constraint the table-wrap pattern works
 * around in renderMarkdown.ts.
 *
 * The fence is the wire format the vote-create receipt emits, so a vote
 * surfaces as a live poll in-thread the moment it opens.
 */

// A voteId is a single safe token (randomUUID() hex+dashes, or a
// vote_-prefixed id). We refuse anything else so a malformed fence can't
// drive a widget mount with attacker-shaped input.
const SAFE_VOTE_ID = /^[A-Za-z0-9_-]+$/;

// Fenced block: optional indent, ```ant-poll, newline, inner, newline,
// closing ```. Multiline + case-insensitive so ```ANT-POLL also matches.
const POLL_FENCE_RE = /^[ \t]*```[ \t]*ant-poll[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gim;

export type PollExtraction = {
  /** Distinct, valid voteIds referenced, in first-seen order. */
  voteIds: string[];
  /** The message body with every ant-poll fence removed + whitespace tidied. */
  body: string;
};

/**
 * Pull every `ant-poll` fence out of a raw message body.
 * Returns the referenced voteIds (deduped, first-seen order) and the
 * body with those fences stripped so the markdown renderer never sees
 * them. Invalid/empty fences are dropped silently and leave no widget.
 */
export function extractPollRefs(raw: string | null | undefined): PollExtraction {
  if (!raw) return { voteIds: [], body: '' };
  const voteIds: string[] = [];
  const seen = new Set<string>();
  const stripped = raw.replace(POLL_FENCE_RE, (_match, inner: string) => {
    const id = firstToken(inner);
    if (id && SAFE_VOTE_ID.test(id) && !seen.has(id)) {
      seen.add(id);
      voteIds.push(id);
    }
    return '';
  });
  // Removed fences leave runs of blank lines behind; collapse to a single
  // gap and trim the edges so a poll-only message renders no empty body.
  const body = stripped.replace(/\n{3,}/g, '\n\n').trim();
  return { voteIds, body };
}

function firstToken(inner: string): string {
  for (const line of inner.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}
