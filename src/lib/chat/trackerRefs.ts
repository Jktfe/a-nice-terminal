/**
 * Inline tracker tables for chat messages.
 *
 * A tracker (the `/tracker` collaborative audit table, JWPK msg_p28s81vbyz)
 * embeds inline the same way a poll/status board does: a fenced block tagged
 * `ant-tracker` whose body is a trackerId.
 *
 *   ```ant-tracker
 *   trk_abc123
 *   ```
 *
 * Mirrors pollRefs/statusRefs exactly — same extraction rail, same MessageRow
 * mount path — resolving to a TrackerTable widget. The fence carries ONLY the
 * id (not the table data): a tracker is collaboratively edited with a durable
 * audit, so the widget fetches table+rows+events from the store rather than
 * reading static fence-body data that others couldn't edit or that an edit
 * would orphan.
 *
 * Kept as a sibling of pollRefs/statusRefs (not a shared generic) so the live,
 * verified poll + status extractors are never touched while this lands.
 */

// A trackerId is a single safe token (trk_-prefixed hex). Anything else is
// refused so a malformed fence can't drive a widget mount with attacker input.
const SAFE_TRACKER_ID = /^[A-Za-z0-9_-]+$/;

const TRACKER_FENCE_RE = /^[ \t]*```[ \t]*ant-tracker[ \t]*\n([\s\S]*?)\n[ \t]*```[ \t]*$/gim;

export type TrackerExtraction = {
  /** Distinct, valid trackerIds referenced, in first-seen order. */
  trackerIds: string[];
  /** The message body with every ant-tracker fence removed + whitespace tidied. */
  body: string;
};

export function extractTrackerRefs(raw: string | null | undefined): TrackerExtraction {
  if (!raw) return { trackerIds: [], body: '' };
  const trackerIds: string[] = [];
  const seen = new Set<string>();
  const stripped = raw.replace(TRACKER_FENCE_RE, (_match, inner: string) => {
    const id = firstToken(inner);
    if (id && SAFE_TRACKER_ID.test(id) && !seen.has(id)) {
      seen.add(id);
      trackerIds.push(id);
    }
    return '';
  });
  const body = stripped.replace(/\n{3,}/g, '\n\n').trim();
  return { trackerIds, body };
}

function firstToken(inner: string): string {
  for (const line of inner.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length > 0) return trimmed;
  }
  return '';
}

/**
 * Sanitise a tracker `link`-column cell before it becomes an <a href>.
 *
 * SECURITY (review 2026-06-10 @oiresearch): a link cell is user-controlled
 * room content; rendering it as `<a href={val}>` lets a member inject
 * `javascript:…` (or any unsafe scheme) that fires for every viewer. Mirror
 * the markdown sanitiser allowlist (renderMarkdown.ts: http/https/mailto) plus
 * repo-relative paths. Anything else → null and the widget renders text.
 */
export function safeUrlForTrackerLink(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const v = raw.trim();
  if (v.length === 0) return null;
  // Repo-relative path (single leading slash; reject protocol-relative //).
  if (v.startsWith('/') && !v.startsWith('//')) return v;
  try {
    const u = new URL(v);
    if (u.protocol === 'http:' || u.protocol === 'https:' || u.protocol === 'mailto:') return v;
  } catch {
    return null; // not an absolute URL
  }
  return null;
}
