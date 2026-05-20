/**
 * terminalBookmarks store — FOLDER-IMPL-1 per docs/terminal-folder-picker-2026-05-14.md.
 *
 * Per-client preference for cwd-bookmark pills surfaced in the Raw-view
 * folder picker. Mirrors theme.svelte.ts + agentKinds.svelte.ts pattern.
 * No defaults — user-driven. localStorage key: ant-cwd-bookmarks.
 */
const STORAGE_KEY = 'ant-cwd-bookmarks';

class TerminalBookmarksStore {
  paths = $state<string[]>([]);

  init(): void {
    if (typeof localStorage === 'undefined') return;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
        this.paths = parsed.filter((p) => p.length > 0);
      }
    } catch { /* malformed — keep empty */ }
  }

  add(path: string): void {
    const trimmed = path.trim();
    if (!trimmed) return;
    if (this.paths.includes(trimmed)) return;
    this.paths = [...this.paths, trimmed];
    this.persist();
  }

  remove(path: string): void {
    this.paths = this.paths.filter((p) => p !== path);
    this.persist();
  }

  reset(): void {
    this.paths = [];
    this.persist();
  }

  private persist(): void {
    if (typeof localStorage === 'undefined') return;
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(this.paths)); }
    catch { /* private mode */ }
  }
}

export const terminalBookmarks = new TerminalBookmarksStore();
