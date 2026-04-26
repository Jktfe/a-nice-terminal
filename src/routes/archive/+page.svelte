<script lang="ts">
  import { onMount } from 'svelte';

  interface Session {
    id: string;
    name: string;
    type: 'terminal' | 'chat' | 'agent';
    status: string;
    ttl: string;
    archived: number;
    deleted_at: string | null;
    updated_at: string;
  }

  let items = $state<Session[]>([]);
  let selected = $state<Set<string>>(new Set());
  let loading = $state(true);
  let busy = $state(false);
  let error = $state<string | null>(null);
  let searchText = $state('');

  const visibleItems = $derived(
    items.filter((session) =>
      session.name.toLowerCase().includes(searchText.trim().toLowerCase()) ||
      session.id.toLowerCase().includes(searchText.trim().toLowerCase())
    )
  );

  const selectedItems = $derived(items.filter((session) => selected.has(session.id)));
  const visibleSelected = $derived(visibleItems.filter((session) => selected.has(session.id)));
  const allVisibleSelected = $derived(visibleItems.length > 0 && visibleSelected.length === visibleItems.length);

  onMount(() => {
    void load();
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) throw new Error('Failed to load archive');
      const data = await res.json();
      items = data.recoverable ?? [];
      selected = new Set([...selected].filter((id) => items.some((session) => session.id === id)));
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load archive';
    } finally {
      loading = false;
    }
  }

  function toggleOne(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    selected = next;
  }

  function toggleVisible() {
    if (allVisibleSelected) {
      const next = new Set(selected);
      for (const session of visibleItems) next.delete(session.id);
      selected = next;
      return;
    }
    selected = new Set([...selected, ...visibleItems.map((session) => session.id)]);
  }

  async function restore(ids: string[]) {
    if (ids.length === 0) return;
    busy = true;
    error = null;
    try {
      for (const id of ids) {
        const res = await fetch(`/api/sessions/${id}/restore`, { method: 'POST' });
        if (!res.ok) throw new Error(`Failed to restore ${id}`);
      }
      selected = new Set();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Restore failed';
    } finally {
      busy = false;
    }
  }

  async function commitToMemoryAndDelete(ids: string[]) {
    if (ids.length === 0) return;
    busy = true;
    error = null;
    try {
      for (const id of ids) {
        const archiveRes = await fetch(`/api/sessions/${id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ archived: true }),
        });
        if (!archiveRes.ok) throw new Error(`Failed to save ${id} to memory`);
        const deleteRes = await fetch(`/api/sessions/${id}?hard=true`, { method: 'DELETE' });
        if (!deleteRes.ok) throw new Error(`Failed to delete ${id}`);
      }
      selected = new Set();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Save to memory failed';
    } finally {
      busy = false;
    }
  }

  async function hardDelete(ids: string[]) {
    if (ids.length === 0) return;
    if (!confirm(`Permanently delete ${ids.length} session${ids.length === 1 ? '' : 's'}?`)) return;
    busy = true;
    error = null;
    try {
      for (const id of ids) {
        const res = await fetch(`/api/sessions/${id}?hard=true`, { method: 'DELETE' });
        if (!res.ok) throw new Error(`Failed to delete ${id}`);
      }
      selected = new Set();
      await load();
    } catch (e) {
      error = e instanceof Error ? e.message : 'Delete failed';
    } finally {
      busy = false;
    }
  }

  function stateLabel(session: Session): string {
    if (session.deleted_at) return 'Deleted';
    if (session.archived) return 'Archived';
    return 'Recoverable';
  }

  function typeIcon(session: Session): string {
    if (session.type === 'terminal') return '>';
    if (session.type === 'chat') return '#';
    return '*';
  }
</script>

<svelte:head>
  <title>ANT · Archive</title>
</svelte:head>

<div class="min-h-screen overflow-y-auto" style="background: var(--bg); color: var(--text);">
  <div class="sticky top-0 z-20 border-b" style="background: var(--bg-surface); border-color: var(--border-subtle);">
    <div class="flex items-center gap-4 px-4 sm:px-6 py-3">
      <a href="/" class="text-sm transition-colors hover:text-white" style="color: var(--text-muted);">
        ← Sessions
      </a>
      <div class="w-px h-4" style="background: var(--border-light);"></div>
      <div>
        <h1 class="text-sm font-semibold">Archive</h1>
        <p class="text-xs" style="color: var(--text-faint);">Restore, commit to memory, or permanently delete hidden sessions.</p>
      </div>
      <button
        type="button"
        onclick={load}
        disabled={loading || busy}
        class="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
        style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-subtle);"
      >Refresh</button>
    </div>
  </div>

  <main class="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
    <section class="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div class="flex-1">
        <input
          bind:value={searchText}
          class="w-full px-3 py-2 rounded-lg text-sm outline-none"
          style="background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text);"
          placeholder="Search archived sessions"
        />
      </div>
      <div class="flex items-center gap-2 overflow-x-auto">
        <button
          type="button"
          onclick={toggleVisible}
          disabled={visibleItems.length === 0 || busy}
          class="px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-40"
          style="background: #6366F115; color: #818CF8; border: 1px solid #6366F133;"
        >{allVisibleSelected ? 'Deselect visible' : 'Select visible'}</button>
        <button
          type="button"
          onclick={() => restore([...selected])}
          disabled={selected.size === 0 || busy}
          class="px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-40"
          style="background: #10B98118; color: #10B981; border: 1px solid #10B98133;"
        >Restore</button>
        <button
          type="button"
          onclick={() => commitToMemoryAndDelete([...selected])}
          disabled={selected.size === 0 || busy}
          class="px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-40"
          style="background: #7C3AED18; color: #A78BFA; border: 1px solid #7C3AED33;"
        >Memory + delete</button>
        <button
          type="button"
          onclick={() => hardDelete([...selected])}
          disabled={selected.size === 0 || busy}
          class="px-3 py-2 rounded-lg text-xs font-medium whitespace-nowrap disabled:opacity-40"
          style="background: #EF444418; color: #F87171; border: 1px solid #EF444433;"
        >Delete</button>
      </div>
    </section>

    <section class="flex items-center justify-between text-xs" style="color: var(--text-faint);">
      <span>{items.length} archived or recoverable session{items.length === 1 ? '' : 's'}</span>
      <span>{selected.size} selected</span>
    </section>

    {#if error}
      <div class="rounded-lg border px-4 py-3 text-sm" style="background: #EF444414; color: #F87171; border-color: #EF444433;">
        {error}
      </div>
    {/if}

    {#if loading}
      <div class="flex flex-col items-center justify-center gap-3 py-24">
        <div class="w-8 h-8 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin"></div>
        <p class="text-sm" style="color: var(--text-muted);">Loading archive…</p>
      </div>
    {:else if visibleItems.length === 0}
      <div class="rounded-xl border border-dashed px-6 py-16 text-center" style="border-color: var(--border-light);">
        <p class="text-sm font-medium" style="color: var(--text-muted);">No archived sessions</p>
        <p class="mt-1 text-xs" style="color: var(--text-faint);">Archived and deleted sessions will appear here for bulk cleanup.</p>
      </div>
    {:else}
      <div class="overflow-hidden rounded-xl border" style="border-color: var(--border-subtle);">
        <div class="grid grid-cols-[44px_minmax(0,1fr)_120px_140px_180px] gap-0 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide"
             style="background: var(--bg-card); color: var(--text-faint); border-bottom: 1px solid var(--border-subtle);">
          <div></div>
          <div>Name</div>
          <div>Type</div>
          <div>State</div>
          <div>Updated</div>
        </div>

        {#each visibleItems as session (session.id)}
          {@const isSelected = selected.has(session.id)}
          <div
            class="grid grid-cols-[44px_minmax(0,1fr)_120px_140px_180px] gap-0 items-center px-4 py-3 border-b last:border-b-0 transition-colors"
            style="background: {isSelected ? '#6366F112' : 'var(--bg-surface)'}; border-color: var(--border-subtle);"
          >
            <div>
              <input
                type="checkbox"
                checked={isSelected}
                onchange={() => toggleOne(session.id)}
                class="w-4 h-4 accent-[#6366F1]"
                aria-label={`Select ${session.name}`}
              />
            </div>
            <div class="min-w-0">
              <div class="flex items-center gap-2 min-w-0">
                <span class="font-mono text-xs" style="color: var(--text-faint);">{typeIcon(session)}</span>
                <span class="truncate text-sm font-medium" style="color: var(--text);">{session.name}</span>
              </div>
              <div class="mt-0.5 truncate text-[11px] font-mono" style="color: var(--text-faint);">{session.id}</div>
            </div>
            <div class="text-xs capitalize" style="color: var(--text-muted);">{session.type}</div>
            <div>
              <span
                class="inline-flex px-2 py-0.5 rounded-full text-[11px] font-semibold"
                style="background: {session.deleted_at ? '#F59E0B18' : '#6366F118'}; color: {session.deleted_at ? '#F59E0B' : '#818CF8'};"
              >{stateLabel(session)}</span>
            </div>
            <div class="text-xs" style="color: var(--text-faint);">
              {new Date(session.deleted_at ?? session.updated_at).toLocaleString()}
            </div>
          </div>
        {/each}
      </div>
    {/if}

    {#if selectedItems.length > 0}
      <div class="fixed bottom-4 left-1/2 z-30 flex -translate-x-1/2 items-center gap-2 rounded-xl border px-3 py-2 shadow-2xl"
           style="background: var(--bg-surface); border-color: var(--border-subtle);">
        <span class="px-2 text-xs font-semibold" style="color: #818CF8;">{selectedItems.length} selected</span>
        <button type="button" onclick={() => restore([...selected])} disabled={busy} class="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style="background: #10B98118; color: #10B981;">Restore</button>
        <button type="button" onclick={() => commitToMemoryAndDelete([...selected])} disabled={busy} class="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style="background: #7C3AED18; color: #A78BFA;">Memory + delete</button>
        <button type="button" onclick={() => hardDelete([...selected])} disabled={busy} class="px-3 py-1.5 rounded-lg text-xs font-medium disabled:opacity-40" style="background: #EF444418; color: #F87171;">Delete</button>
        <button type="button" onclick={() => selected = new Set()} disabled={busy} class="px-2 py-1.5 rounded-lg text-xs disabled:opacity-40" style="color: var(--text-faint);">Clear</button>
      </div>
    {/if}
  </main>
</div>
