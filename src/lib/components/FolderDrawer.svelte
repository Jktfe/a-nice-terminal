<script lang="ts">
  // B1 — Folder navigation drawer. Opened by the header button or Cmd+P.
  // The drawer is purely presentational + selection: it surfaces workspaces +
  // recent paths, lets the user fuzzy-filter, and emits onSelect(path) when a
  // choice is committed. The parent owns the actual paste-into-terminal call so
  // the drawer stays unaware of session/socket plumbing.
  //
  // Recent paths persist in localStorage under 'ant.folder.recents' (most-recent
  // first, capped at RECENT_LIMIT). Cross-tab sync via the storage event,
  // mirroring the B5 sidebar pinning pattern.

  import { onMount, onDestroy } from 'svelte';

  interface FolderItem {
    path: string;
    label?: string;
    source: 'recent' | 'workspace';
  }

  let {
    open,
    workspaces = [],
    onSelect,
    onClose,
  }: {
    open: boolean;
    workspaces?: { id: string; name: string; root_dir?: string | null }[];
    onSelect: (path: string) => void;
    onClose: () => void;
  } = $props();

  const RECENT_KEY = 'ant.folder.recents';
  const RECENT_LIMIT = 12;

  let recents = $state<string[]>([]);
  let query = $state('');
  let focusIdx = $state(0);
  let inputEl = $state<HTMLInputElement | null>(null);

  function loadRecents() {
    if (typeof window === 'undefined') return;
    try {
      const raw = localStorage.getItem(RECENT_KEY);
      if (!raw) return;
      const arr = JSON.parse(raw);
      if (Array.isArray(arr)) {
        recents = arr.filter((x): x is string => typeof x === 'string').slice(0, RECENT_LIMIT);
      }
    } catch {
      // localStorage unavailable or malformed — start with empty list
    }
  }

  function saveRecents() {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem(RECENT_KEY, JSON.stringify(recents.slice(0, RECENT_LIMIT)));
    } catch {
      // Quota / disabled — recents persist in-memory only
    }
  }

  function pushRecent(path: string) {
    const dedup = [path, ...recents.filter(p => p !== path)].slice(0, RECENT_LIMIT);
    recents = dedup;
    saveRecents();
  }

  function onStorageEvent(e: StorageEvent) {
    if (e.key === RECENT_KEY) loadRecents();
  }

  // Fuzzy scoring (mirrors B9 pattern, kept local so drawer has no cross-component coupling).
  function fuzzyScore(q: string, target: string): number {
    if (!q) return 1;
    const lq = q.toLowerCase();
    const lt = target.toLowerCase();
    if (lt === lq) return 1000;
    if (lt.startsWith(lq)) return 500 - (lt.length - lq.length);
    if (lt.includes(lq)) return 200 - (lt.length - lq.length);
    let qi = 0;
    let last = -1;
    let bonus = 0;
    for (let i = 0; i < lt.length && qi < lq.length; i++) {
      if (lt[i] === lq[qi]) {
        if (qi === 0 && i === 0) bonus += 30;
        if (i === last + 1) bonus += 5;
        last = i;
        qi++;
      }
    }
    if (qi !== lq.length) return 0;
    return 50 + bonus - (lt.length - lq.length);
  }

  const allItems = $derived.by<FolderItem[]>(() => {
    const seen = new Set<string>();
    const items: FolderItem[] = [];
    for (const path of recents) {
      if (!path || seen.has(path)) continue;
      seen.add(path);
      items.push({ path, source: 'recent' });
    }
    for (const ws of workspaces) {
      if (!ws.root_dir || seen.has(ws.root_dir)) continue;
      seen.add(ws.root_dir);
      items.push({ path: ws.root_dir, label: ws.name, source: 'workspace' });
    }
    return items;
  });

  const filtered = $derived.by<FolderItem[]>(() => {
    const q = query.trim();
    if (!q) return allItems;
    return allItems
      .map(it => ({ it, score: Math.max(fuzzyScore(q, it.path), it.label ? fuzzyScore(q, it.label) : 0) }))
      .filter(x => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(x => x.it);
  });

  // svelte-ignore state_referenced_locally
  // Reset focus index when filter narrows so it can never point past the end
  $effect(() => {
    query;
    focusIdx = 0;
  });

  // Auto-focus search input + load recents the moment the drawer opens
  $effect(() => {
    if (open) {
      query = '';
      focusIdx = 0;
      loadRecents();
      setTimeout(() => inputEl?.focus(), 0);
    }
  });

  onMount(() => {
    loadRecents();
    if (typeof window !== 'undefined') window.addEventListener('storage', onStorageEvent);
  });

  onDestroy(() => {
    if (typeof window !== 'undefined') window.removeEventListener('storage', onStorageEvent);
  });

  function commit(item: FolderItem) {
    pushRecent(item.path);
    onSelect(item.path);
    onClose();
  }

  function handleKey(e: KeyboardEvent) {
    const max = filtered.length - 1;
    if (e.key === 'ArrowDown') { e.preventDefault(); focusIdx = Math.min(focusIdx + 1, max); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); focusIdx = Math.max(focusIdx - 1, 0); }
    else if (e.key === 'Home') { e.preventDefault(); focusIdx = 0; }
    else if (e.key === 'End') { e.preventDefault(); focusIdx = max; }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const it = filtered[focusIdx];
      if (it) commit(it);
    }
    else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
  }

  function backdropClick(e: MouseEvent) {
    if (e.target === e.currentTarget) onClose();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <!-- svelte-ignore a11y_no_static_element_interactions -->
  <div class="folder-backdrop" onclick={backdropClick} role="dialog" aria-modal="true" aria-label="Folder navigation" tabindex="-1">
    <div class="folder-drawer">
      <div class="folder-head">
        <span class="folder-icon" aria-hidden="true">⌘P</span>
        <input
          class="folder-search"
          type="text"
          placeholder="Search or type a folder path…"
          bind:value={query}
          bind:this={inputEl}
          onkeydown={handleKey}
          aria-label="Filter folders"
        />
        <button type="button" class="folder-close" onclick={onClose} aria-label="Close folder drawer">
          <svg class="folder-close-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
          </svg>
        </button>
      </div>
      <ul class="folder-list" role="listbox" aria-label="Folders">
        {#each filtered as item, i (item.path)}
          {@const isFocused = i === focusIdx}
          <!-- svelte-ignore a11y_click_events_have_key_events -->
          <!-- Keyboard nav (Up/Down/Enter/Esc) is handled at the search input via handleKey;
               each <li> is a mouse-only click target inside an ARIA listbox. -->
          <li
            class="folder-item"
            class:focused={isFocused}
            role="option"
            aria-selected={isFocused}
            onclick={() => commit(item)}
            onmouseenter={() => (focusIdx = i)}
          >
            <span class="folder-source" aria-hidden="true">{item.source === 'recent' ? '↻' : '★'}</span>
            <span class="folder-text">
              {#if item.label}
                <span class="folder-label">{item.label}</span>
                <span class="folder-path">{item.path}</span>
              {:else}
                <span class="folder-path folder-path--mono">{item.path}</span>
              {/if}
            </span>
          </li>
        {:else}
          <li class="folder-empty">
            {query ? `No folder matches "${query}"` : 'No recent folders or workspaces. Type a path and press Enter.'}
          </li>
        {/each}
      </ul>
      {#if query && !filtered.some(it => it.path === query)}
        <!-- Free-form path commit when query doesn't match any known item -->
        <div class="folder-freeform" title="Press Enter to cd to a custom path">
          <button
            type="button"
            class="folder-freeform-btn"
            onclick={() => commit({ path: query, source: 'recent' })}
          >
            cd into <span class="folder-path--mono">{query}</span>
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}

<style>
  .folder-backdrop {
    position: fixed;
    inset: 0;
    background: rgba(0, 0, 0, 0.4);
    backdrop-filter: blur(2px);
    display: flex;
    align-items: flex-start;
    justify-content: center;
    padding-top: 12vh;
    z-index: 80;
  }

  .folder-drawer {
    width: min(560px, 92vw);
    background: var(--bg-card, #FFFFFF);
    border: 1px solid #E5E7EB;
    border-radius: 12px;
    box-shadow: 0 18px 48px rgba(0, 0, 0, 0.22), 0 4px 12px rgba(0, 0, 0, 0.08);
    overflow: hidden;
    display: flex;
    flex-direction: column;
  }

  .folder-head {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    border-bottom: 1px solid #E5E7EB;
  }
  .folder-icon {
    font-family: var(--font-mono);
    font-size: 11px;
    font-weight: 600;
    padding: 2px 6px;
    border-radius: 4px;
    background: #EEF2FF;
    color: #4F46E5;
    flex-shrink: 0;
  }
  .folder-search {
    flex: 1;
    border: none;
    outline: none;
    background: transparent;
    font-size: 14px;
    color: var(--text);
  }
  .folder-search::placeholder { color: var(--text-faint); font-size: 13px; }
  .folder-close {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 30px;
    height: 30px;
    border: none;
    border-radius: 6px;
    background: transparent;
    color: var(--text-faint);
    cursor: pointer;
    flex-shrink: 0;
  }
  .folder-close:hover { background: #F3F4F6; color: var(--text); }
  .folder-close-icon { width: 16px; height: 16px; }

  .folder-list {
    list-style: none;
    margin: 0;
    padding: 4px 0;
    max-height: 360px;
    overflow-y: auto;
  }

  .folder-item {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 8px 14px;
    cursor: pointer;
    line-height: 1.3;
  }
  .folder-item.focused { background: #F3F4F6; }
  .folder-source {
    width: 16px;
    text-align: center;
    color: var(--text-faint);
    font-size: 12px;
    flex-shrink: 0;
  }
  .folder-text {
    flex: 1;
    min-width: 0;
    display: flex;
    flex-direction: column;
  }
  .folder-label {
    font-size: 13px;
    color: var(--text);
    font-weight: 500;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-path {
    font-size: 11.5px;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .folder-path--mono {
    font-family: var(--font-mono);
    font-size: 11.5px;
  }
  .folder-empty {
    padding: 14px;
    font-size: 12px;
    color: var(--text-faint);
    font-style: italic;
    text-align: center;
  }

  .folder-freeform {
    border-top: 1px dashed #E5E7EB;
    padding: 6px;
  }
  .folder-freeform-btn {
    display: block;
    width: 100%;
    text-align: left;
    padding: 8px 12px;
    border-radius: 6px;
    background: transparent;
    border: none;
    cursor: pointer;
    font-size: 12px;
    color: var(--text-muted);
  }
  .folder-freeform-btn:hover { background: #F3F4F6; color: var(--text); }
</style>
