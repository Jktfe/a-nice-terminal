/**
 * Pure helpers for the @-mention tag strip in the chat composer.
 *
 * v3 parity (task #52): when the user @-mentions a handle, show a chip so
 * they can either remove it from the body or convert the bare @handle to a
 * bracketed [@handle] form. Bracketed mentions are informational and skip
 * the direct-broadcast route on the server.
 *
 * Body grammar:
 *   - Bare       `@handle`    — direct-broadcast; rendered as a primary chip
 *   - Bracketed  `[@handle]`  — informational; rendered as a muted chip
 *
 * A handle matches `[A-Za-z0-9_-]+`. The leading `@` must be at the start of
 * the body or follow whitespace, so emails (`a@b.com`) and embedded tokens
 * (`thing@x`) are not picked up as mentions.
 */

export type MentionTagKind = 'bare' | 'bracketed';

export type MentionTag = {
  handle: string;
  kind: MentionTagKind;
  startIndexInBody: number;
  endIndexInBody: number;
};

const HANDLE_BODY = '[A-Za-z0-9_-]+';

const BARE_PATTERN = new RegExp(`(^|\\s)@(${HANDLE_BODY})`, 'g');
const BRACKETED_PATTERN = new RegExp(`\\[@(${HANDLE_BODY})\\]`, 'g');

function collectBare(body: string): MentionTag[] {
  const tags: MentionTag[] = [];
  for (const match of body.matchAll(BARE_PATTERN)) {
    const leadingWhitespace = match[1] ?? '';
    const handleBody = match[2] ?? '';
    const matchStart = match.index ?? 0;
    const tokenStart = matchStart + leadingWhitespace.length;
    tags.push({
      handle: `@${handleBody}`,
      kind: 'bare',
      startIndexInBody: tokenStart,
      endIndexInBody: tokenStart + 1 + handleBody.length
    });
  }
  return tags;
}

function collectBracketed(body: string): MentionTag[] {
  const tags: MentionTag[] = [];
  for (const match of body.matchAll(BRACKETED_PATTERN)) {
    const handleBody = match[1] ?? '';
    const tokenStart = match.index ?? 0;
    tags.push({
      handle: `@${handleBody}`,
      kind: 'bracketed',
      startIndexInBody: tokenStart,
      endIndexInBody: tokenStart + 3 + handleBody.length
    });
  }
  return tags;
}

/** Returns all mention tags in body, ordered by appearance. */
export function detectMentionTags(body: string): MentionTag[] {
  const merged = [...collectBare(body), ...collectBracketed(body)];
  merged.sort((a, b) => a.startIndexInBody - b.startIndexInBody);
  return merged;
}

/** Replace the tag's slice in body with `replacement`. Pure. */
function replaceSliceInBody(body: string, tag: MentionTag, replacement: string): string {
  return body.slice(0, tag.startIndexInBody) + replacement + body.slice(tag.endIndexInBody);
}

/** Convert a bare `@handle` to bracketed `[@handle]` (informational). */
export function convertBareToBracketed(body: string, tag: MentionTag): string {
  if (tag.kind !== 'bare') return body;
  return replaceSliceInBody(body, tag, `[${tag.handle}]`);
}

/** Convert a bracketed `[@handle]` back to a bare `@handle` (direct-broadcast). */
export function convertBracketedToBare(body: string, tag: MentionTag): string {
  if (tag.kind !== 'bracketed') return body;
  return replaceSliceInBody(body, tag, tag.handle);
}

/**
 * Remove a mention token from body, also swallowing one trailing space so the
 * surrounding text reflows naturally. If no trailing space exists the slice
 * removal is enough.
 */
export function removeMentionFromBody(body: string, tag: MentionTag): string {
  const trailingSpaceIndex = tag.endIndexInBody;
  const hasTrailingSpace = body.charAt(trailingSpaceIndex) === ' ';
  const sliceEnd = hasTrailingSpace ? trailingSpaceIndex + 1 : trailingSpaceIndex;
  return body.slice(0, tag.startIndexInBody) + body.slice(sliceEnd);
}
