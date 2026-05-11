// A2 of main-app-improvements-2026-05-10 — pure dedup-by-id helper.
//
// Lives in a plain .ts file (not .svelte.ts) so vitest can import it
// without the svelte-vite plugin. The reactive useMessageStore in
// messages.svelte.ts wraps this helper in $state writes; view
// components that maintain their own arrays (linked chats, remote
// rooms, grid tiles) call this helper directly.
//
// Policy:
//   - If `incoming.id` already exists in `rows`, the existing row is
//     replaced in-place with the spread merge of existing + incoming
//     (incoming wins for explicit fields; existing fields survive when
//     incoming omits them).
//   - If the id is new, the message is appended at the end
//     (newest-last).
//   - Pure function — caller is responsible for any reactive write.

export function upsertMessageById<T extends { id: string }>(rows: T[], incoming: T): T[] {
  const idx = rows.findIndex((m) => m.id === incoming.id);
  if (idx >= 0) {
    const next = rows.slice();
    next[idx] = { ...rows[idx], ...incoming };
    return next;
  }
  return [...rows, incoming];
}
