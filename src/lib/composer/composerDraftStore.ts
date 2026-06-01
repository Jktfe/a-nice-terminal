// composerDraftStore — per-room composer-draft persistence helpers.
//
// JWPK msg_ivazv32bya: composer drafts persist PER-ROOM so navigating
// away (room hop, hard refresh, accidental close) doesn't throw away
// unfinished work. Storage key is scoped to roomId so room A's draft
// doesn't leak into room B. Persists on every keystroke (cheap —
// localStorage write is sub-ms for these sizes); clears after a
// successful send + on draft empty.
//
// Extracted from ChatComposer.svelte to keep the parent under the
// 600-line cap (scripts/check-component-lines.mjs). Pure helpers — no
// Svelte runes, no DOM other than localStorage. SSR-safe via the
// typeof localStorage guard.

export function draftStorageKey(roomScopeId: string): string {
  return `ant.composer-draft.${roomScopeId}`;
}

export function loadDraftForRoom(roomScopeId: string): string {
  if (typeof localStorage === 'undefined') return '';
  try {
    return localStorage.getItem(draftStorageKey(roomScopeId)) ?? '';
  } catch {
    return '';
  }
}

export function persistDraftForRoom(roomScopeId: string, draft: string): void {
  if (typeof localStorage === 'undefined') return;
  try {
    const trimmed = draft.trimEnd();
    if (trimmed.length === 0) {
      localStorage.removeItem(draftStorageKey(roomScopeId));
    } else {
      localStorage.setItem(draftStorageKey(roomScopeId), draft);
    }
  } catch {
    /* private mode or quota — draft survives only in memory */
  }
}
