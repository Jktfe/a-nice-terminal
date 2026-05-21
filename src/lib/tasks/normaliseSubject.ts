/**
 * Display-time normaliser for task subjects.
 *
 * #170 — agents drop tasks into the store from CLIs, scripts, and the
 * UI. Their subjects accumulate junk: trailing whitespace, paste artefacts,
 * accidental triple-spaces, and stray leading bullets. We don't rewrite
 * the stored row (anyone wanting raw access keeps it), but every render
 * path runs the text through this helper first so the user sees clean
 * lines.
 *
 * Safe to call on undefined/null — returns '' rather than throwing.
 */
export function normaliseSubject(raw: string | null | undefined): string {
  if (!raw) return '';
  // Collapse any run of whitespace (including tabs / newlines) to a single
  // space, then trim. Strip a single leading bullet/dash if it survived
  // a paste (common when copying from todo lists).
  return raw
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^[•\-*]\s+/, '');
}
