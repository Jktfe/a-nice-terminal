<!--
  FolderNavigator — visual cd-to-folder picker (modal).

  Opens as a <dialog> with an inline tree of directories. Clicking a
  folder toggles its expansion (lazy-loads children from /api/fs/list)
  and sets it as the current selection. The footer's "cd to <path>"
  button fires onSelect(path) and the parent does the PTY inject.

  Tree expansion is recursive via Svelte 5 snippets — each row renders
  the next-depth row inline via {@render row(...)}.

  Hidden files (dotfiles) are filtered out by default; a toggle in the
  header refetches expanded paths with showHidden=true.

  Wired from TerminalFolderPicker.svelte: clicking the "/" crumb opens
  this modal with startPath='/'. Other crumbs still cd directly.
-->
<script lang="ts">
  type Props = {
    open: boolean;
    startPath: string;
    onSelect: (path: string) => void;
    onCancel: () => void;
  };

  let { open, startPath, onSelect, onCancel }: Props = $props();

  type FsEntry = { name: string; hidden: boolean };
  type ListResponse = { path: string; parent: string | null; entries: FsEntry[] };

  let dialogElement = $state<HTMLDialogElement | null>(null);
  let showHidden = $state(false);
  let expanded = $state<Set<string>>(new Set());
  let loading = $state<Set<string>>(new Set());
  let errors = $state<Map<string, string>>(new Map());
  // children[parentPath] = sorted list of subdirectory names
  let children = $state<Map<string, FsEntry[]>>(new Map());
  let selectedPath = $state<string>('');

  // Drive dialog visibility from the `open` prop via $effect — same
  // pattern as ConfirmRoomActionModal.
  $effect(() => {
    if (!dialogElement) return;
    if (open && !dialogElement.open) {
      dialogElement.showModal();
      // Reset state on every open so the navigator always starts fresh
      // at startPath. Keeps the modal predictable across multiple
      // open/close cycles.
      resetTo(startPath);
    } else if (!open && dialogElement.open) {
      dialogElement.close();
    }
  });

  function resetTo(path: string): void {
    expanded = new Set([path]);
    loading = new Set();
    errors = new Map();
    children = new Map();
    selectedPath = path;
    void loadChildren(path);
  }

  function joinPath(parent: string, child: string): string {
    if (parent === '/') return `/${child}`;
    return `${parent}/${child}`;
  }

  async function loadChildren(path: string): Promise<void> {
    if (children.has(path)) return; // already cached
    loading = new Set(loading).add(path);
    errors = new Map(errors);
    errors.delete(path);
    try {
      const params = new URLSearchParams({ path });
      if (showHidden) params.set('showHidden', 'true');
      const resp = await fetch(`/api/fs/list?${params.toString()}`);
      if (!resp.ok) {
        const msg = await resp
          .json()
          .then((b) => b.message)
          .catch(() => `HTTP ${resp.status}`);
        errors = new Map(errors).set(path, msg);
        return;
      }
      const body = (await resp.json()) as ListResponse;
      children = new Map(children).set(path, body.entries);
    } catch (err) {
      errors = new Map(errors).set(path, err instanceof Error ? err.message : String(err));
    } finally {
      const next = new Set(loading);
      next.delete(path);
      loading = next;
    }
  }

  function togglePath(path: string): void {
    selectedPath = path;
    const next = new Set(expanded);
    if (next.has(path)) {
      next.delete(path);
    } else {
      next.add(path);
      if (!children.has(path)) void loadChildren(path);
    }
    expanded = next;
  }

  function toggleShowHidden(): void {
    showHidden = !showHidden;
    // Re-fetch every already-loaded path so the new toggle state is
    // applied uniformly across the visible tree. Simpler than tracking
    // per-path hidden state.
    const toReload = [...children.keys()];
    children = new Map();
    for (const p of toReload) void loadChildren(p);
  }

  function handleCancelEvent(event: Event): void {
    event.preventDefault();
    onCancel();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogElement) onCancel();
  }

  function handleConfirm(): void {
    if (!selectedPath) return;
    onSelect(selectedPath);
  }
</script>

{#snippet row(path: string, label: string, depth: number)}
  {@const isExpanded = expanded.has(path)}
  {@const isSelected = selectedPath === path}
  {@const isLoading = loading.has(path)}
  {@const errMsg = errors.get(path)}
  {@const kids = children.get(path) ?? []}
  <div class="row-wrap" style:padding-left={`${depth * 1.2}rem`}>
    <button
      type="button"
      class="row"
      class:selected={isSelected}
      onclick={() => togglePath(path)}
      title={path}
    >
      <span class="caret" aria-hidden="true">{isExpanded ? '▾' : '▸'}</span>
      <svg viewBox="0 0 24 24" class="folder-icon" aria-hidden="true" width="16" height="16">
        <path
          d="M3 7a1 1 0 011-1h5l2 2h9a1 1 0 011 1v9a1 1 0 01-1 1H4a1 1 0 01-1-1z"
          fill="none"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linejoin="round"
        />
      </svg>
      <span class="row-label">{label}</span>
    </button>
  </div>
  {#if isExpanded}
    {#if isLoading}
      <div class="row-wrap" style:padding-left={`${(depth + 1) * 1.2}rem`}>
        <span class="row-status">Loading…</span>
      </div>
    {:else if errMsg}
      <div class="row-wrap" style:padding-left={`${(depth + 1) * 1.2}rem`}>
        <span class="row-error">{errMsg}</span>
      </div>
    {:else if kids.length === 0}
      <div class="row-wrap" style:padding-left={`${(depth + 1) * 1.2}rem`}>
        <span class="row-status">(empty)</span>
      </div>
    {:else}
      {#each kids as kid (kid.name)}
        {@render row(joinPath(path, kid.name), kid.name, depth + 1)}
      {/each}
    {/if}
  {/if}
{/snippet}

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogElement}
  class="folder-navigator-dialog"
  aria-labelledby="folderNavigatorHeading"
  onclick={handleBackdropClick}
  oncancel={handleCancelEvent}
>
  <header class="dialog-header">
    <h2 id="folderNavigatorHeading">Browse folders</h2>
    <div class="header-actions">
      <label class="hidden-toggle">
        <input type="checkbox" checked={showHidden} onchange={toggleShowHidden} />
        Show hidden
      </label>
      <button type="button" class="close-btn" onclick={onCancel} aria-label="Close">×</button>
    </div>
  </header>

  <div class="tree">
    {@render row(startPath, startPath === '/' ? '/' : startPath, 0)}
  </div>

  <footer class="dialog-footer">
    <p class="selected-path" title={selectedPath}>
      Selected: <code>{selectedPath || '—'}</code>
    </p>
    <div class="footer-actions">
      <button type="button" class="safe" onclick={onCancel}>Cancel</button>
      <button
        type="button"
        class="primary"
        onclick={handleConfirm}
        disabled={!selectedPath}
      >
        cd to {selectedPath}
      </button>
    </div>
  </footer>
</dialog>

<style>
  /* Scope display:flex to the [open] state. Without this guard, the
     default `display: none` for a closed <dialog> is overridden and the
     dialog renders inline as a "stuck open" panel even when showModal()
     hasn't been called — which also breaks modality (no focus trap, no
     backdrop, clicks fall through to whatever's behind it). */
  .folder-navigator-dialog[open] {
    width: min(640px, calc(100vw - 2rem));
    max-height: min(72vh, 720px);
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    box-shadow: var(--shadow-card);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .folder-navigator-dialog::backdrop {
    background: rgb(0 0 0 / 40%);
  }

  .dialog-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 1rem;
    padding: 1rem 1.25rem;
    border-bottom: 1px solid var(--line-soft);
  }

  .dialog-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
  }

  .header-actions {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .hidden-toggle {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-soft);
    cursor: pointer;
  }

  .hidden-toggle input {
    accent-color: var(--accent);
  }

  .close-btn {
    width: 1.8rem;
    height: 1.8rem;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 1.1rem;
    line-height: 1;
    cursor: pointer;
  }

  .close-btn:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .tree {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: 0.5rem 0;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.88rem;
  }

  .row-wrap {
    display: block;
  }

  .row {
    display: inline-flex;
    align-items: center;
    gap: 0.45rem;
    width: 100%;
    padding: 0.3rem 1rem;
    border: 1px solid transparent;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    cursor: pointer;
    text-align: left;
  }

  .row:hover {
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }

  .row.selected {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    color: var(--accent);
  }

  .caret {
    display: inline-flex;
    justify-content: center;
    width: 0.85rem;
    color: var(--ink-soft);
  }

  .folder-icon {
    color: var(--ink-soft);
    flex-shrink: 0;
  }

  .row.selected .folder-icon,
  .row.selected .caret {
    color: var(--accent);
  }

  .row-label {
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .row-status {
    display: inline-block;
    padding: 0.2rem 1rem;
    color: var(--ink-muted);
    font-style: italic;
    font-size: 0.85rem;
  }

  .row-error {
    display: inline-block;
    padding: 0.2rem 1rem;
    color: var(--warn, #c92020);
    font-size: 0.85rem;
  }

  .dialog-footer {
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
    padding: 0.9rem 1.25rem;
    border-top: 1px solid var(--line-soft);
    background: color-mix(in srgb, var(--surface-card) 92%, transparent);
  }

  .selected-path {
    margin: 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .selected-path code {
    color: var(--ink-strong);
  }

  .footer-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.55rem;
  }

  .footer-actions button {
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    font: inherit;
    font-weight: 800;
    font-size: 0.95rem;
    cursor: pointer;
  }

  .safe {
    border: 1px solid var(--line-soft);
    background: transparent;
    color: var(--ink-strong);
  }

  .primary {
    border: none;
    background: var(--accent);
    color: white;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 28rem;
    white-space: nowrap;
  }

  .primary:hover:not(:disabled) {
    filter: brightness(1.05);
  }

  .primary:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
</style>
