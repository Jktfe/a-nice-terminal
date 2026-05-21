/**
 * terminalBookmarks store — server-backed cwd bookmark pills.
 *
 * Mirrors quickShortcuts persistence per JWPK 2026-05-21: bookmarks live
 * in the cwd_bookmarks SQLite table so they sync across Tailscale devices
 * (mac, macbook-server, ipad, iPhone). UI keeps the same surface
 * (`paths` array + add/remove by path) so callers don't change.
 *
 * On first init, any pre-existing localStorage bookmarks are migrated
 * up to the server then cleared from local — keeps already-saved
 * bookmarks intact through the cutover.
 */
const LEGACY_LOCAL_STORAGE_KEY = 'ant-cwd-bookmarks';

type CwdBookmark = { id: string; path: string };

class TerminalBookmarksStore {
  // Public surface: callers (TerminalFolderPicker) read .paths and call
  // .add(path) / .remove(path). The id↔path mapping is internal so the
  // delete-by-path UX doesn't have to know server-side ids.
  paths = $state<string[]>([]);
  private idByPath = new Map<string, string>();
  private initialized = false;

  async init(): Promise<void> {
    if (typeof fetch === 'undefined') return;
    if (this.initialized) return;
    this.initialized = true;

    await this.loadFromServer();
    await this.migrateLegacyLocalStorage();
  }

  async add(path: string): Promise<void> {
    const trimmed = path.trim();
    if (!trimmed) return;
    if (this.paths.includes(trimmed)) return;
    try {
      const res = await fetch('/api/cwd-bookmarks', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ path: trimmed })
      });
      if (!res.ok) return;
      const body = (await res.json()) as { bookmark: CwdBookmark };
      // Server is idempotent — if the path was already there, we still
      // get the existing record back. Either way, sync local state.
      if (!this.idByPath.has(body.bookmark.path)) {
        this.idByPath.set(body.bookmark.path, body.bookmark.id);
        this.paths = [...this.paths, body.bookmark.path];
      }
    } catch {
      // Network blip — leave local state untouched; next init() rehydrates.
    }
  }

  async remove(path: string): Promise<void> {
    const id = this.idByPath.get(path);
    if (!id) return;
    try {
      const res = await fetch(`/api/cwd-bookmarks/${encodeURIComponent(id)}`, {
        method: 'DELETE'
      });
      // 204 = removed, 404 = already gone — both fine, drop from local.
      if (res.status !== 204 && res.status !== 404) return;
      this.idByPath.delete(path);
      this.paths = this.paths.filter((p) => p !== path);
    } catch {
      // Network blip — leave local state untouched.
    }
  }

  private async loadFromServer(): Promise<void> {
    try {
      const res = await fetch('/api/cwd-bookmarks');
      if (!res.ok) return;
      const body = (await res.json()) as { bookmarks: CwdBookmark[] };
      this.idByPath = new Map(body.bookmarks.map((b) => [b.path, b.id]));
      this.paths = body.bookmarks.map((b) => b.path);
    } catch {
      // Server unreachable — leave empty; UI just won't show bookmarks.
    }
  }

  private async migrateLegacyLocalStorage(): Promise<void> {
    if (typeof localStorage === 'undefined') return;
    let legacy: string[] = [];
    try {
      const raw = localStorage.getItem(LEGACY_LOCAL_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      legacy = parsed.filter((x): x is string => typeof x === 'string' && x.length > 0);
    } catch {
      return;
    }
    if (legacy.length === 0) return;
    // POST any legacy entries the server doesn't already have. The server
    // POST is idempotent so we don't need to filter — but skipping known
    // paths avoids a redundant round-trip.
    for (const path of legacy) {
      if (this.paths.includes(path)) continue;
      await this.add(path);
    }
    try {
      localStorage.removeItem(LEGACY_LOCAL_STORAGE_KEY);
    } catch {
      // Private mode etc — non-fatal, just leaves dead key behind.
    }
  }
}

export const terminalBookmarks = new TerminalBookmarksStore();
