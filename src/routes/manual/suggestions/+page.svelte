<!--
  /manual/suggestions — central feed of every captured suggestion across
  all screens / states / elements (JWPK msg_6hmkenudej 2026-05-23 slice 3).

  Three columns by status: Open / Addressed / Dismissed. Click a suggestion
  to deep-link into the canvas at the element it was captured against
  (uses the manual-canvas-deep-link-contract-2026-05-23 fragment shape).

  Status transitions via PATCH /api/manual/suggestions/:id.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { onMount } from 'svelte';

  type Suggestion = {
    id: string;
    screen_id: string | null;
    state_slug: string | null;
    element_slug: string | null;
    body: string;
    captured_by_handle: string;
    captured_at_ms: number;
    status: 'open' | 'addressed' | 'dismissed';
    addressed_at_ms: number | null;
    addressed_by_handle: string | null;
    addressed_note: string | null;
  };

  let suggestions = $state<Suggestion[]>([]);
  let loading = $state(true);
  let loadError = $state<string | null>(null);
  let actingId = $state<string | null>(null);

  async function loadFeed() {
    try {
      const response = await fetch('/api/manual/suggestions');
      if (!response.ok) throw new Error(`feed fetch ${response.status}`);
      const data = await response.json();
      suggestions = data.suggestions ?? [];
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loading = false;
    }
  }

  async function updateStatus(s: Suggestion, status: 'open' | 'addressed' | 'dismissed') {
    actingId = s.id;
    try {
      const response = await fetch(`/api/manual/suggestions/${encodeURIComponent(s.id)}`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ status })
      });
      if (!response.ok) throw new Error(`patch ${response.status}`);
      const data = await response.json();
      suggestions = suggestions.map((x) => (x.id === s.id ? data.suggestion : x));
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      actingId = null;
    }
  }

  function bucket(status: 'open' | 'addressed' | 'dismissed'): Suggestion[] {
    return suggestions
      .filter((s) => s.status === status)
      .sort((a, b) => b.captured_at_ms - a.captured_at_ms);
  }

  function deepLink(s: Suggestion): string {
    if (!s.screen_id) return '/manual/v2';
    const fragment = [s.screen_id, s.state_slug, s.element_slug].filter(Boolean).join('/');
    return `/manual/v2#${fragment}`;
  }

  function scopeLabel(s: Suggestion): string {
    if (s.element_slug) return `${s.screen_id ?? '—'} · ${s.state_slug ?? '—'} · ${s.element_slug}`;
    if (s.state_slug) return `${s.screen_id ?? '—'} · ${s.state_slug} (state-level)`;
    if (s.screen_id) return `${s.screen_id} (screen-level)`;
    return 'unscoped';
  }

  function formatTimestamp(ms: number): string {
    const date = new Date(ms);
    return date.toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  }

  onMount(loadFeed);
</script>

<svelte:head><title>Suggestions | ANT vNext</title></svelte:head>

<SimplePageShell showIntro={false}>
  <div class="feed-page">
    <header class="feed-header">
      <div class="feed-eyebrow">SCREENS · v2 SUGGESTIONS</div>
      <h1>Suggestions feed</h1>
      <p class="feed-summary">
        Every note captured against an element, state, or screen — the questions, observations,
        and improvement ideas that came up while exploring the canvas. Click a suggestion to
        deep-link into the element it was raised against.
      </p>
    </header>

    {#if loading}
      <p class="feed-status">Loading suggestions …</p>
    {:else if loadError}
      <p class="feed-error">Couldn't load: {loadError}</p>
    {:else}
      <div class="feed-columns">
        {#each (['open', 'addressed', 'dismissed'] as const) as col}
          {@const list = bucket(col)}
          <section class="feed-column" class:open-col={col === 'open'}>
            <h2 class="feed-column-title">
              {col === 'open' ? 'Open' : col === 'addressed' ? 'Addressed' : 'Dismissed'}
              <span class="feed-count">{list.length}</span>
            </h2>
            {#if list.length === 0}
              <p class="feed-empty">— nothing here yet</p>
            {:else}
              <ul class="feed-list">
                {#each list as s (s.id)}
                  <li class="feed-item">
                    <div class="feed-item-body">{s.body}</div>
                    <a class="feed-item-scope" href={deepLink(s)}>{scopeLabel(s)}</a>
                    <div class="feed-item-meta">
                      {s.captured_by_handle} · {formatTimestamp(s.captured_at_ms)}
                    </div>
                    {#if s.addressed_note}
                      <div class="feed-item-addressed">
                        Resolution: {s.addressed_note}
                      </div>
                    {/if}
                    <div class="feed-item-actions">
                      {#if col !== 'addressed'}
                        <button type="button" disabled={actingId === s.id} onclick={() => updateStatus(s, 'addressed')}>Address</button>
                      {/if}
                      {#if col !== 'dismissed'}
                        <button type="button" disabled={actingId === s.id} onclick={() => updateStatus(s, 'dismissed')}>Dismiss</button>
                      {/if}
                      {#if col !== 'open'}
                        <button type="button" disabled={actingId === s.id} onclick={() => updateStatus(s, 'open')}>Reopen</button>
                      {/if}
                    </div>
                  </li>
                {/each}
              </ul>
            {/if}
          </section>
        {/each}
      </div>
    {/if}
  </div>
</SimplePageShell>

<style>
  .feed-page {
    padding: 1.25rem 1.5rem 2.5rem;
    color: var(--ink-strong, #0f172a);
  }
  .feed-header { margin-bottom: 1.25rem; }
  .feed-eyebrow {
    font: 600 0.7rem/1 ui-sans-serif, system-ui, sans-serif;
    letter-spacing: 0.08em;
    color: var(--accent, #6b21a8);
    margin-bottom: 0.5rem;
  }
  h1 { font: 800 1.85rem/1.1 ui-sans-serif, system-ui, sans-serif; margin: 0 0 0.25rem; }
  .feed-summary {
    font: 500 0.95rem/1.5 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    margin: 0;
    max-width: 65ch;
  }
  .feed-status { color: var(--ink-muted, #475569); font-style: italic; }
  .feed-error { color: #b91c1c; }

  .feed-columns {
    display: grid;
    grid-template-columns: 1fr 1fr 1fr;
    gap: 1.25rem;
  }
  @media (max-width: 960px) {
    .feed-columns { grid-template-columns: 1fr; }
  }

  .feed-column {
    background: var(--surface-2, #f8fafc);
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 12px;
    padding: 0.85rem 0.9rem;
  }
  .feed-column.open-col {
    background: rgba(168, 85, 247, 0.04);
    border-color: rgba(168, 85, 247, 0.25);
  }
  .feed-column-title {
    font: 700 0.85rem/1.2 ui-sans-serif, system-ui, sans-serif;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-muted, #475569);
    margin: 0 0 0.75rem;
    display: flex;
    justify-content: space-between;
    align-items: center;
  }
  .feed-count {
    background: var(--surface, #fff);
    color: var(--ink-strong, #0f172a);
    border-radius: 999px;
    padding: 1px 8px;
    font-size: 0.72rem;
    font-weight: 600;
  }
  .feed-empty {
    margin: 0;
    color: var(--ink-muted, #94a3b8);
    font: 500 0.82rem/1.4 ui-sans-serif, system-ui, sans-serif;
    font-style: italic;
  }

  .feed-list {
    list-style: none;
    padding: 0;
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 0.6rem;
  }
  .feed-item {
    background: var(--surface, #fff);
    border: 1px solid var(--line-soft, #e2e8f0);
    border-radius: 8px;
    padding: 0.6rem 0.75rem;
  }
  .feed-item-body {
    font: 500 0.88rem/1.5 ui-sans-serif, system-ui, sans-serif;
    white-space: pre-wrap;
    word-break: break-word;
  }
  .feed-item-scope {
    display: block;
    margin-top: 0.35rem;
    font: 500 0.74rem/1.2 ui-monospace, "SF Mono", Menlo, monospace;
    color: var(--accent, #6b21a8);
    text-decoration: none;
  }
  .feed-item-scope:hover { text-decoration: underline; }
  .feed-item-meta {
    margin-top: 0.25rem;
    font: 500 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #94a3b8);
  }
  .feed-item-addressed {
    margin-top: 0.4rem;
    font: 500 0.78rem/1.4 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    background: var(--surface-2, #f1f5f9);
    border-radius: 4px;
    padding: 0.3rem 0.5rem;
  }
  .feed-item-actions {
    margin-top: 0.5rem;
    display: flex;
    gap: 0.35rem;
  }
  .feed-item-actions button {
    background: transparent;
    border: 1px solid var(--line-soft, #d6d6d6);
    border-radius: 4px;
    padding: 2px 8px;
    font: 600 0.72rem/1.2 ui-sans-serif, system-ui, sans-serif;
    color: var(--ink-muted, #475569);
    cursor: pointer;
  }
  .feed-item-actions button:hover {
    border-color: var(--accent, #6b21a8);
    color: var(--ink-strong, #0f172a);
  }
  .feed-item-actions button:disabled { opacity: 0.5; cursor: not-allowed; }
</style>
