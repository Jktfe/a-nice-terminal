<!--
  TerminalFolderPicker.svelte — FOLDER-IMPL-2 per docs/terminal-folder-picker-2026-05-14.md.
  Raw-view-only strip surfacing: cwd breadcrumb (passive, OSC 7/1337-detected
  or unknown) + user-bookmarked pills + add-current + refresh button.
  Click any path → onChangeDir(path) — parent wires the two-call cd protocol.
-->
<script lang="ts" module>
  export function shortPath(path: string): string {
    const parts = path.split('/').filter(Boolean);
    if (parts.length <= 2) return path;
    return '…/' + parts.slice(-2).join('/');
  }
</script>

<script lang="ts">
  import { terminalBookmarks } from '$lib/stores/terminalBookmarks.svelte';

  type Props = {
    currentCwd: string | null;
    onChangeDir: (path: string) => void;
    onRefresh?: () => void;
    /**
     * Optional handler for clicking the "/" root crumb. When provided,
     * the root crumb opens the FolderNavigator modal instead of cd-ing
     * directly to /. Other crumbs always cd directly.
     */
    onBrowseFromRoot?: () => void;
  };
  let { currentCwd, onChangeDir, onRefresh, onBrowseFromRoot }: Props = $props();

  function handleCrumbClick(crumb: Crumb): void {
    if (crumb.path === '/' && onBrowseFromRoot) {
      onBrowseFromRoot();
      return;
    }
    onChangeDir(crumb.path);
  }

  // Breadcrumb segments — split cwd on /, build ascending cumulative paths.
  type Crumb = { label: string; path: string };
  const crumbs = $derived.by<Crumb[]>(() => {
    if (!currentCwd) return [];
    const trimmed = currentCwd.replace(/\/+$/, '');
    if (!trimmed) return [{ label: '/', path: '/' }];
    const parts = trimmed.split('/').filter((s) => s.length > 0);
    const out: Crumb[] = [{ label: '/', path: '/' }];
    let acc = '';
    for (const p of parts) {
      acc += '/' + p;
      out.push({ label: p, path: acc });
    }
    return out;
  });

  function addCurrent(): void {
    if (currentCwd) terminalBookmarks.add(currentCwd);
  }
</script>

<nav class="folder-picker" aria-label="Folder picker (Raw view)">
  <div class="breadcrumb-row">
    {#if onBrowseFromRoot}
      <button
        type="button"
        class="crumb crumb-root"
        onclick={onBrowseFromRoot}
        title="Browse folders from root"
        aria-label="Browse folders from root"
      >
        <svg viewBox="0 0 24 24" aria-hidden="true" width="11" height="11">
          <path d="M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
        </svg>
        Browse
      </button>
    {/if}
    {#if crumbs.length === 0}
      <span class="cwd-unknown">cwd unknown
        {#if onRefresh}<button type="button" class="refresh-btn" onclick={onRefresh} title="Run pwd to detect">↻ refresh</button>{/if}
      </span>
    {:else}
      {#each crumbs as crumb, idx (crumb.path)}
        {#if crumb.path === '/' && onBrowseFromRoot}
          <!-- Skip the leading "/" crumb when Browse is rendered standalone
               above; the Browse pill already represents "start from root". -->
        {:else}
          <button type="button" class="crumb" onclick={() => handleCrumbClick(crumb)} title={crumb.path}>{crumb.label}</button>
          {#if idx < crumbs.length - 1}<span class="crumb-sep">/</span>{/if}
        {/if}
      {/each}
      <button type="button" class="add-btn" onclick={addCurrent} title="Bookmark current cwd" disabled={!currentCwd || terminalBookmarks.paths.includes(currentCwd)}>+</button>
    {/if}
  </div>

  {#if terminalBookmarks.paths.length > 0}
    <div class="bookmark-row">
      {#each terminalBookmarks.paths as path (path)}
        <span class="bookmark-pill">
          <button type="button" class="bookmark-go" onclick={() => onChangeDir(path)} title={path}>{shortPath(path)}</button>
          <button type="button" class="bookmark-remove" onclick={() => terminalBookmarks.remove(path)} title="Remove bookmark" aria-label="Remove">×</button>
        </span>
      {/each}
    </div>
  {/if}
</nav>

<style>
  .folder-picker {
    display: flex; flex-direction: column; gap: 0.3rem;
    padding: 0.35rem 0.6rem;
    background: var(--surface-card);
    border-bottom: 1px solid var(--line-soft);
    font-size: 0.78rem;
  }
  .breadcrumb-row, .bookmark-row { display: flex; align-items: center; flex-wrap: wrap; gap: 0.25rem; }
  .cwd-unknown { color: var(--ink-soft); font-style: italic; }
  .refresh-btn {
    margin-left: 0.4rem; padding: 0.15rem 0.5rem;
    border: 1px solid var(--line-soft); border-radius: 0.3rem;
    background: var(--bg); color: var(--ink-strong); cursor: pointer;
    font-size: 0.75rem;
  }
  .refresh-btn:hover { border-color: var(--accent); color: var(--accent); }
  .crumb {
    padding: 0.15rem 0.4rem; border-radius: 0.3rem;
    border: 1px solid transparent; background: transparent;
    color: var(--ink-strong); cursor: pointer;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.78rem;
  }
  .crumb:hover { background: var(--bg); border-color: var(--line-soft); color: var(--accent); }
  .crumb-root {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    font-weight: 800;
  }
  .crumb-root:hover {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: var(--accent);
    color: var(--accent);
  }
  .crumb-root svg { flex-shrink: 0; }
  .crumb-sep { color: var(--ink-soft); opacity: 0.6; }
  .add-btn {
    margin-left: 0.4rem; width: 1.4rem; height: 1.4rem; padding: 0;
    border-radius: 50%; border: 1px solid var(--line-soft);
    background: var(--bg); color: var(--ink-soft); cursor: pointer;
    font-size: 0.9rem; line-height: 1;
  }
  .add-btn:hover:not(:disabled) { color: var(--accent); border-color: var(--accent); }
  .add-btn:disabled { opacity: 0.45; cursor: not-allowed; }
  .bookmark-pill {
    display: inline-flex; align-items: center; gap: 0.15rem;
    padding: 0.1rem 0.15rem 0.1rem 0.4rem; border-radius: 999px;
    border: 1px solid var(--line-soft); background: var(--bg);
  }
  .bookmark-go {
    padding: 0; border: none; background: transparent;
    color: var(--ink-strong); cursor: pointer;
    font-family: ui-monospace, monospace; font-size: 0.76rem;
  }
  .bookmark-go:hover { color: var(--accent); }
  .bookmark-remove {
    width: 1.1rem; height: 1.1rem; padding: 0;
    border: none; border-radius: 50%; background: transparent;
    color: var(--ink-soft); cursor: pointer;
    font-size: 0.85rem; line-height: 1;
  }
  .bookmark-remove:hover { color: var(--accent); }
</style>
