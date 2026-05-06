<script lang="ts">
  import { onMount } from 'svelte';

  interface Ask {
    id: string;
    session_id: string;
    session_name?: string | null;
    session_type?: string | null;
    source_message_id?: string | null;
    title: string;
    body?: string | null;
    recommendation?: string | null;
    status: 'candidate' | 'open' | 'answered' | 'deferred' | 'dismissed';
    assigned_to?: string | null;
    owner_kind?: string | null;
    priority?: 'low' | 'normal' | 'high';
    answer?: string | null;
    answer_action?: string | null;
    inferred?: boolean;
    confidence?: number;
    created_at: string;
    updated_at: string;
    source_content?: string | null;
    source_sender_id?: string | null;
  }

  const statusOptions = [
    { key: 'needs', status: 'open', view: 'actionable', limit: '100', label: 'Needs action' },
    { key: 'deferred', status: 'deferred', view: 'actionable', limit: '100', label: 'Deferred' },
    { key: 'candidates', status: 'candidate', view: '', limit: '200', label: 'Review candidates' },
    { key: 'answered', status: 'answered', view: '', limit: '100', label: 'Answered' },
    { key: 'all', status: 'all', view: '', limit: '500', label: 'All' },
  ];

  let asks = $state<Ask[]>([]);
  let loading = $state(true);
  let busyId = $state<string | null>(null);
  let error = $state<string | null>(null);
  let searchText = $state('');
  let statusFilter = $state('needs');
  let answerDrafts = $state<Record<string, string>>({});

  const visibleAsks = $derived(
    asks.filter((ask) => {
      const q = searchText.trim().toLowerCase();
      if (!q) return true;
      return [
        ask.id,
        ask.title,
        ask.body,
        ask.recommendation,
        ask.session_name,
        ask.session_id,
        ask.assigned_to,
        ask.owner_kind,
      ].some((value) => String(value || '').toLowerCase().includes(q));
    })
  );

  onMount(() => {
    document.body.classList.add('asks-view-page');
    void load();
    return () => document.body.classList.remove('asks-view-page');
  });

  async function load() {
    loading = true;
    error = null;
    try {
      const option = statusOptions.find((item) => item.key === statusFilter) ?? statusOptions[0];
      const params = new URLSearchParams({ status: option.status, limit: option.limit });
      if (option.view) params.set('view', option.view);
      const res = await fetch(`/api/asks?${params.toString()}`);
      if (!res.ok) throw new Error('Failed to load asks');
      const data = await res.json();
      asks = data.asks ?? [];
    } catch (e) {
      error = e instanceof Error ? e.message : 'Failed to load asks';
    } finally {
      loading = false;
    }
  }

  async function updateAsk(ask: Ask, action: string) {
    busyId = ask.id;
    error = null;
    try {
      const answer = answerDrafts[ask.id] || '';
      const res = await fetch(`/api/asks/${ask.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, answer }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Failed to update ${ask.id}`);
      }
      const data = await res.json();
      asks = asks.map((item) => item.id === ask.id ? data.ask : item);
    } catch (e) {
      error = e instanceof Error ? e.message : 'Update failed';
    } finally {
      busyId = null;
    }
  }

  function setDraft(id: string, value: string) {
    answerDrafts = { ...answerDrafts, [id]: value };
  }

  function statusTone(status: Ask['status']): string {
    if (status === 'open') return 'background: #EF444418; color: #F87171; border-color: #EF444433;';
    if (status === 'candidate') return 'background: #F59E0B18; color: #F59E0B; border-color: #F59E0B33;';
    if (status === 'deferred') return 'background: #6366F118; color: #818CF8; border-color: #6366F133;';
    if (status === 'answered') return 'background: #10B98118; color: #10B981; border-color: #10B98133;';
    return 'background: var(--bg-card); color: var(--text-faint); border-color: var(--border-subtle);';
  }

  function priorityLabel(ask: Ask): string {
    if (ask.priority === 'high') return 'High';
    if (ask.priority === 'low') return 'Low';
    return 'Normal';
  }
</script>

<svelte:head>
  <title>ANT · Ask Queue</title>
</svelte:head>

<div class="overflow-y-auto" style="background: var(--bg); color: var(--text); height: var(--ant-viewport-h, 100dvh);">
  <div class="sticky top-0 z-20 border-b" style="background: var(--bg-surface); border-color: var(--border-subtle);">
    <div class="flex items-center gap-4 px-4 sm:px-6 py-3">
      <a href="/" class="text-sm transition-colors hover:text-white" style="color: var(--text-muted);">
        ← Sessions
      </a>
      <div class="w-px h-4" style="background: var(--border-light);"></div>
      <div>
        <h1 class="text-sm font-semibold">Ask Queue</h1>
        <p class="text-xs" style="color: var(--text-faint);">Current decisions, blockers, and explicit handoffs.</p>
      </div>
      <button
        type="button"
        onclick={load}
        disabled={loading || busyId !== null}
        class="ml-auto px-3 py-1.5 rounded-lg text-xs font-medium transition-colors disabled:opacity-50"
        style="background: var(--bg-card); color: var(--text-muted); border: 1px solid var(--border-subtle);"
      >Refresh</button>
    </div>
  </div>

  <main class="max-w-6xl mx-auto p-4 sm:p-6 space-y-4">
    <section class="flex flex-col gap-3 lg:flex-row lg:items-center">
      <input
        bind:value={searchText}
        class="flex-1 px-3 py-2 rounded-lg text-sm outline-none"
        style="background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text);"
        placeholder="Search asks"
      />
      <div class="flex items-center gap-1 overflow-x-auto rounded-lg border p-1" style="border-color: var(--border-subtle); background: var(--bg-card);">
        {#each statusOptions as option}
          <button
            type="button"
            onclick={() => { statusFilter = option.key; void load(); }}
            class="px-3 py-1.5 rounded-md text-xs font-medium whitespace-nowrap transition-colors"
            style="{statusFilter === option.key ? 'background: #6366F1; color: white;' : 'color: var(--text-muted);'}"
          >{option.label}</button>
        {/each}
      </div>
    </section>

    <section class="flex items-center justify-between text-xs" style="color: var(--text-faint);">
      <span>{visibleAsks.length} visible ask{visibleAsks.length === 1 ? '' : 's'}</span>
      <span>{asks.filter((ask) => ask.status === 'open').length} needs action</span>
    </section>

    {#if error}
      <div class="rounded-lg border px-4 py-3 text-sm" style="background: #EF444414; color: #F87171; border-color: #EF444433;">
        {error}
      </div>
    {/if}

    {#if loading}
      <div class="flex flex-col items-center justify-center gap-3 py-24">
        <div class="w-8 h-8 rounded-full border-2 border-[#6366F1] border-t-transparent animate-spin"></div>
        <p class="text-sm" style="color: var(--text-muted);">Loading asks...</p>
      </div>
    {:else if visibleAsks.length === 0}
      <div class="rounded-lg border border-dashed px-6 py-16 text-center" style="border-color: var(--border-light);">
        <p class="text-sm font-medium" style="color: var(--text-muted);">No asks in this view</p>
        <p class="mt-1 text-xs" style="color: var(--text-faint);">New inferred and CLI-created asks will appear here.</p>
      </div>
    {:else}
      <div class="overflow-hidden rounded-lg border" style="border-color: var(--border-subtle);">
        <div class="hidden lg:grid grid-cols-[minmax(0,1.5fr)_150px_150px_120px_210px] gap-0 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide"
             style="background: var(--bg-card); color: var(--text-faint); border-bottom: 1px solid var(--border-subtle);">
          <div>Ask</div>
          <div>Owner</div>
          <div>Room</div>
          <div>Status</div>
          <div>Resolve</div>
        </div>

        {#each visibleAsks as ask (ask.id)}
          <div class="grid gap-3 lg:grid-cols-[minmax(0,1.5fr)_150px_150px_120px_210px] lg:items-start px-4 py-4 border-b last:border-b-0"
               style="background: var(--bg-surface); border-color: var(--border-subtle);">
            <div class="min-w-0">
              <div class="flex flex-wrap items-center gap-2">
                <span class="font-mono text-[11px]" style="color: var(--text-faint);">{ask.id}</span>
                <span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                      style="{ask.priority === 'high' ? 'background: #EF444418; color: #F87171; border-color: #EF444433;' : 'background: var(--bg-card); color: var(--text-faint); border-color: var(--border-subtle);'}">
                  {priorityLabel(ask)}
                </span>
                {#if ask.inferred}
                  <span class="rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase"
                        style="background: #0EA5E918; color: #38BDF8; border-color: #0EA5E933;">
                    Inferred
                  </span>
                {/if}
              </div>
              <h2 class="mt-1 text-sm font-semibold leading-5" style="color: var(--text);">{ask.title}</h2>
              {#if ask.body}
                <p class="mt-1 line-clamp-3 text-xs leading-5" style="color: var(--text-muted);">{ask.body}</p>
              {/if}
              {#if ask.recommendation}
                <p class="mt-2 rounded-md border px-2 py-1.5 text-xs" style="background: #10B98112; color: #34D399; border-color: #10B98133;">
                  {ask.recommendation}
                </p>
              {/if}
            </div>

            <div class="text-xs">
              <div class="font-medium" style="color: var(--text);">{ask.assigned_to || 'room'}</div>
              <div class="mt-0.5 capitalize" style="color: var(--text-faint);">{ask.owner_kind || 'room'}</div>
            </div>

            <div class="min-w-0 text-xs">
              <a href={`/session/${ask.session_id}`} class="font-medium hover:underline" style="color: #818CF8;">
                {ask.session_name || ask.session_id}
              </a>
              <div class="mt-0.5 truncate font-mono" style="color: var(--text-faint);">{ask.session_id}</div>
            </div>

            <div>
              <span class="inline-flex rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize" style="{statusTone(ask.status)}">
                {ask.status}
              </span>
              <div class="mt-1 text-[11px]" style="color: var(--text-faint);">
                {new Date(ask.updated_at || ask.created_at).toLocaleString()}
              </div>
            </div>

            <div class="space-y-2">
              <textarea
                value={answerDrafts[ask.id] || ''}
                oninput={(event) => setDraft(ask.id, event.currentTarget.value)}
                rows="2"
                class="w-full resize-none rounded-md px-2 py-1.5 text-xs outline-none"
                style="background: var(--bg-card); border: 1px solid var(--border-subtle); color: var(--text);"
                placeholder="Response"
              ></textarea>
              <div class="grid grid-cols-2 gap-1.5">
                <button type="button" onclick={() => updateAsk(ask, 'approve')} disabled={busyId === ask.id} class="action-btn" style="--tone: #10B981;">Approve</button>
                <button type="button" onclick={() => updateAsk(ask, 'answer')} disabled={busyId === ask.id} class="action-btn" style="--tone: #6366F1;">Answer</button>
                <button type="button" onclick={() => updateAsk(ask, 'defer')} disabled={busyId === ask.id} class="action-btn" style="--tone: #F59E0B;">Defer</button>
                <button type="button" onclick={() => updateAsk(ask, 'dismiss')} disabled={busyId === ask.id} class="action-btn" style="--tone: #EF4444;">Dismiss</button>
              </div>
            </div>
          </div>
        {/each}
      </div>
    {/if}
  </main>
</div>

<style>
  .action-btn {
    border: 1px solid color-mix(in srgb, var(--tone) 32%, transparent);
    background: color-mix(in srgb, var(--tone) 12%, transparent);
    color: var(--tone);
    border-radius: 6px;
    padding: 6px 8px;
    font-size: 11px;
    font-weight: 700;
    line-height: 1;
    transition: opacity 0.15s ease, background-color 0.15s ease;
  }

  .action-btn:hover {
    background: color-mix(in srgb, var(--tone) 18%, transparent);
  }

  .action-btn:disabled {
    opacity: 0.45;
    cursor: not-allowed;
  }

  .line-clamp-3 {
    display: -webkit-box;
    line-clamp: 3;
    -webkit-line-clamp: 3;
    -webkit-box-orient: vertical;
    overflow: hidden;
  }

  :global(body.asks-view-page) {
    overflow: auto;
  }
</style>
