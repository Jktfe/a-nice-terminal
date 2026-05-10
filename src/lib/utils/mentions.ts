export interface MentionHandle {
  handle: string;
  name: string;
}

function normaliseHandle(handle: string): string {
  const trimmed = handle.trim();
  return trimmed.startsWith('@') ? trimmed : `@${trimmed}`;
}

function isHandleBoundary(ch: string | undefined): boolean {
  return !ch || !/[A-Za-z0-9_.-]/.test(ch);
}

function isBracketed(text: string, index: number, handleLength: number): boolean {
  return text[index - 1] === '[' && text[index + handleLength] === ']';
}

function findActiveHandle(text: string, handle: string): boolean {
  const lowerText = text.toLowerCase();
  const lowerHandle = handle.toLowerCase();
  let index = lowerText.indexOf(lowerHandle);

  while (index !== -1) {
    const before = text[index - 1];
    const after = text[index + handle.length];
    if (isHandleBoundary(before) && isHandleBoundary(after) && !isBracketed(text, index, handle.length)) {
      return true;
    }
    index = lowerText.indexOf(lowerHandle, index + handle.length);
  }

  return false;
}

export function activeRoutingMentions(text: string, handles: MentionHandle[]): MentionHandle[] {
  return handles.filter((item) => findActiveHandle(text, normaliseHandle(item.handle)));
}

export function mentionLiteralMatchesHandle(typedMention: string, selectedHandle: string): boolean {
  const typed = typedMention.trim();
  const selected = selectedHandle.trim();
  if (!typed || !selected) return false;
  return normaliseHandle(typed).toLowerCase() === normaliseHandle(selected).toLowerCase();
}

export function shouldCompleteMentionOnEnter(input: {
  typedMention: string | null;
  selectedHandle: string | null;
  navigated: boolean;
}): boolean {
  if (input.navigated) return true;
  if (!input.typedMention || !input.selectedHandle) return true;
  return !mentionLiteralMatchesHandle(input.typedMention, input.selectedHandle);
}

export function ensureTrailingMentionBoundary(text: string): string {
  if (/\s$/.test(text)) return text;
  return /(?:^|\s)@[\w.-]+$/.test(text) ? `${text} ` : text;
}

// ── Autocomplete helpers (used by MessageInput + GridSlot composers) ──
// Extracted so both composers share one fuzzy/scored implementation
// instead of diverging into substring-only or hand-rolled regex passes.

const MENTION_TRIGGER_RE = /@([\w.-]*)$/;

/** Score how well `query` matches `target`. Higher is better; 0 means no match.
 *  Tiers: exact=1000, prefix=500, substring=200, subsequence=50+.
 *  Empty query returns 1 so all entries pass through with stable ordering. */
export function fuzzyScoreMention(query: string, target: string): number {
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  if (!q) return 1;
  if (t === q) return 1000;
  if (t.startsWith(q)) return 500 - (t.length - q.length);
  if (t.includes(q)) return 200 - (t.length - q.length);
  let qi = 0;
  let lastIdx = -1;
  let bonus = 0;
  for (let i = 0; i < t.length && qi < q.length; i++) {
    if (t[i] === q[qi]) {
      if (qi === 0 && i === 0) bonus += 30;
      if (i === lastIdx + 1) bonus += 5;
      lastIdx = i;
      qi++;
    }
  }
  if (qi !== q.length) return 0;
  return 50 + bonus - (t.length - q.length);
}

/** Pin @everyone to the front of the routing list, deduping case-insensitively.
 *  Synthesises a default @everyone entry if the source list omits it. */
export function pinEveryoneFirst(handles: MentionHandle[]): MentionHandle[] {
  const everyone = handles.find((h) => h.handle.toLowerCase() === '@everyone') ?? {
    handle: '@everyone',
    name: 'Everyone',
  };
  return [everyone, ...handles.filter((h) => h.handle.toLowerCase() !== '@everyone')];
}

/** Score handles against `query` against handle and display name (max), drop
 *  zero-scored entries, return top `limit` by score. Empty query returns the
 *  first `limit` in insertion order (so the dropdown is useful before typing). */
export function filterAndScoreHandles(
  handles: MentionHandle[],
  query: string,
  limit = 6,
): MentionHandle[] {
  const q = query.trim();
  if (!q) return handles.slice(0, limit);
  return handles
    .map((h) => ({ h, score: Math.max(fuzzyScoreMention(q, h.handle), fuzzyScoreMention(q, h.name)) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.h);
}

/** Detect whether the text up to `cursor` ends with an @mention being typed.
 *  Returns `{ start, query }` where `start` is the index of the @ in `text`
 *  and `query` is the partial handle (no @). Returns null when there is no
 *  active trigger. */
export function detectMentionTrigger(
  text: string,
  cursor: number,
): { start: number; query: string } | null {
  const before = text.slice(0, cursor);
  const m = before.match(MENTION_TRIGGER_RE);
  if (!m) return null;
  return { start: cursor - m[0].length, query: m[1] };
}

/** Apply the selected handle: replace the partial @… range with `${handle} `
 *  and report the cursor position to set after insertion. */
export function applyMentionSelection(
  text: string,
  cursor: number,
  mentionStart: number,
  handle: string,
): { text: string; cursorAfter: number } {
  const before = text.slice(0, mentionStart);
  const after = text.slice(cursor);
  const next = `${before}${handle} ${after}`;
  return { text: next, cursorAfter: before.length + handle.length + 1 };
}

export function bracketRoutingMention(text: string, rawHandle: string): string {
  const handle = normaliseHandle(rawHandle);
  const lowerText = text.toLowerCase();
  const lowerHandle = handle.toLowerCase();
  let index = lowerText.indexOf(lowerHandle);
  let cursor = 0;
  let next = '';

  while (index !== -1) {
    next += text.slice(cursor, index);
    const original = text.slice(index, index + handle.length);
    const before = text[index - 1];
    const after = text[index + handle.length];
    const active = isHandleBoundary(before) && isHandleBoundary(after) && !isBracketed(text, index, handle.length);

    next += active ? `[${original}]` : original;
    cursor = index + handle.length;
    index = lowerText.indexOf(lowerHandle, cursor);
  }

  return next + text.slice(cursor);
}
