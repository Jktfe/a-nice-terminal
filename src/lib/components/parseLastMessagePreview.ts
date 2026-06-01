/**
 * Split a room's `summary` ("@author: body…") into structured author +
 * body pieces so the room card can style them distinctly (#134).
 *
 * Returns `{ author: '@handle', body: 'rest of message' }` when the
 * summary matches the canonical pattern, or `{ author: null, body: raw }`
 * when it doesn't (system messages, empty rooms, etc.). The split is
 * always on the FIRST ": " — message bodies that themselves contain
 * colons stay intact.
 */

export type LastMessagePreview = {
  author: string | null;
  body: string;
};

const HANDLE_THEN_COLON = /^(@[A-Za-z0-9_.\-]+):\s+([\s\S]+)$/;

export function parseLastMessagePreview(summary: string | null | undefined): LastMessagePreview {
  if (!summary) return { author: null, body: '' };
  const match = HANDLE_THEN_COLON.exec(summary);
  if (!match) return { author: null, body: summary };
  return { author: match[1], body: match[2] };
}
