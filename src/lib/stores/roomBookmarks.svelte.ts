/**
 * roomBookmarks store — dashboard quick-wins room-pinning.
 *
 * User preference for "starred" chat rooms surfaced on the dashboard
 * room strip. localStorage is the working source of truth; the server
 * mirrors it for cross-device sync. Once the user has edited locally
 * (or local already had bookmarks at init), we stop accepting server
 * clobbers — the most-recent local action wins.
 *
 * Bug context (JWPK msg_ldbou7jkfs 2026-05-19): "I'm changing my
 * starred chatrooms and they keep reverting". Root cause was a race
 * between the init-time GET and a concurrent PUT triggered by a
 * user-edit firing the moment the page came up. Old behaviour:
 * refreshFromServer would unconditionally overwrite this.ids with the
 * server snapshot — frequently a stale one. New behaviour: hasUserEdited
 * + non-empty-local guard. Server response is read at boot and applied
 * only when local is empty; after that, every change is a one-way
 * write and the GET response is ignored.
 */
const STORAGE_KEY = 'ant-room-bookmarks';

class RoomBookmarksStore {
  ids = $state<string[]>([]);
  private hasStartedInit = false;
  // Set true on any add / remove / move / toggle and on init if local
  // had any saved bookmarks already. While true, server snapshots are
  // ignored — local is authoritative.
  private hasUserEdited = false;

  init(): void {
    if (this.hasStartedInit) return;
    this.hasStartedInit = true;

    const localIds = this.loadLocal();
    if (localIds.length > 0) {
      this.ids = localIds;
      // Local already has bookmarks — treat that as a prior user edit so
      // the boot-time server refresh can't clobber.
      this.hasUserEdited = true;
    }
    void this.refreshFromServer(localIds);
  }

  private loadLocal(): string[] {
    if (typeof localStorage === 'undefined') return [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        return parsed.filter((id) => id.length > 0);
      }
    } catch { /* malformed — keep empty */ }
    return [];
  }

  private async refreshFromServer(localIds: string[]): Promise<void> {
    if (typeof fetch === 'undefined') return;
    try {
      const response = await fetch('/api/preferences/room-bookmarks');
      if (!response.ok) return;
      const body = (await response.json()) as { roomIds?: string[] };
      const serverIds = Array.isArray(body.roomIds) ? body.roomIds.filter((id) => typeof id === 'string') : [];
      if (this.hasUserEdited) {
        // Don't clobber a user edit. If our local set differs from the
        // server, persist OUR side back so the server catches up.
        if (!arraysEqual(this.ids, serverIds)) {
          await this.persistToServer(this.ids);
        }
        return;
      }
      if (serverIds.length > 0) {
        this.ids = serverIds;
        this.persistLocal();
        return;
      }
      if (localIds.length > 0) {
        await this.persistToServer(localIds);
      }
    } catch {
      /* local cache already loaded; cross-device sync can retry on next page load */
    }
  }

  has(id: string): boolean {
    return this.ids.includes(id);
  }

  add(id: string): void {
    const trimmed = id.trim();
    if (!trimmed) return;
    if (this.ids.includes(trimmed)) return;
    this.hasUserEdited = true;
    this.ids = [...this.ids, trimmed];
    this.persist();
  }

  remove(id: string): void {
    this.hasUserEdited = true;
    this.ids = this.ids.filter((x) => x !== id);
    this.persist();
  }

  toggle(id: string): void {
    if (this.has(id)) this.remove(id);
    else this.add(id);
  }

  // #155: user-driven reorder on the dashboard. Moving a starred room
  // to position `toIndex` updates the persisted ids array, and
  // sortByBookmark now honours that order so the dashboard reflects
  // the drag immediately on the next render.
  move(fromIndex: number, toIndex: number): void {
    if (fromIndex < 0 || fromIndex >= this.ids.length) return;
    if (toIndex < 0 || toIndex >= this.ids.length) return;
    if (fromIndex === toIndex) return;
    this.hasUserEdited = true;
    const next = [...this.ids];
    const [moved] = next.splice(fromIndex, 1);
    next.splice(toIndex, 0, moved);
    this.ids = next;
    this.persist();
  }

  private persist(): void {
    this.persistLocal();
    void this.persistToServer(this.ids);
  }

  private persistLocal(): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.ids)); }
    catch { /* private mode */ }
  }

  private async persistToServer(ids: string[]): Promise<void> {
    if (typeof fetch === 'undefined') return;
    try {
      // Fire-and-forget. The PUT response normally echoes back the same
      // roomIds, but applying it to this.ids can clobber a SUBSEQUENT
      // local edit that landed between request-fire and response-arrival
      // (bug class JWPK msg_ldbou7jkfs). Local is the source of truth
      // for the live ids array; the server is a sync target.
      await fetch('/api/preferences/room-bookmarks', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ roomIds: ids })
      });
    } catch {
      /* keep optimistic local state; next init can retry */
    }
  }
}

function arraysEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
}

/**
 * Stable sort:
 *   - Bookmarked rooms first, in the EXACT order they appear in
 *     `bookmarkedIds` so a user-driven drag reorder on the dashboard
 *     (#155) actually changes the rendered order.
 *   - Then non-bookmarked rooms in their original input order.
 * Bookmark ids that don't match any room are dropped silently.
 * Does not mutate the input array.
 */
export function sortByBookmark<T extends { id: string }>(rooms: T[], bookmarkedIds: string[]): T[] {
  const roomsById = new Map(rooms.map((room) => [room.id, room]));
  const bookmarked: T[] = [];
  for (const id of bookmarkedIds) {
    const room = roomsById.get(id);
    if (room) bookmarked.push(room);
  }
  const bookmarkSet = new Set(bookmarkedIds);
  const rest = rooms.filter((room) => !bookmarkSet.has(room.id));
  return [...bookmarked, ...rest];
}

export const roomBookmarks = new RoomBookmarksStore();
