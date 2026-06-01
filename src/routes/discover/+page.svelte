<!--
  Discover route — read-only docs surface for the ant CLI.

  Layout (top to bottom):
    SimplePageShell intro
    Toolbar  ← search input + status filter chips + result counter
    AnchorNavStrip  ← sticky pill nav, one pill per primaryVerb group
  <section id="verb-group-{primaryVerb}"> per group)
    Page-level empty state when filters yield 0 results
    Footer with generated-at timestamp

  Search is client-side $derived against the in-bundle manifest — no API
  calls. Substring match on primaryVerb / secondaryVerb / usage / summary
  / flag names. Status filter chips toggle visibility per status.

  Grouping is by primaryVerb (all `rooms-*` together, all `plan-*`
  together, etc.) in alphabetical order. Status is conveyed per-card via
  a small dot, no longer via group placement.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import Explainable from '$lib/components/Explainable.svelte';
  import AnchorNavStrip from '$lib/components/AnchorNavStrip.svelte';
  import VerbCard from '$lib/components/VerbCard.svelte';
  import type { DiscoverPageData } from './+page';
  import type { CliManifestVerb, CliVerbStatus } from '$lib/cli-manifest/manifest';

  type Props = { data: DiscoverPageData };
  let { data }: Props = $props();

  const allVerbs = $derived(data.verbs);
  const totalCount = $derived(data.totalCount);

  // Static (full-manifest) status counts — chips show how many verbs exist
  // in each status regardless of the active search/filter, so the user
  // knows the universe size while filtering.
  const availableCount = $derived(allVerbs.filter((v) => v.status === 'available').length);
  const needsWrapperCount = $derived(allVerbs.filter((v) => v.status === 'needs-wrapper').length);
  const plannedCount = $derived(allVerbs.filter((v) => v.status === 'planned').length);

  let query = $state('');
  let activeStatuses = $state<Set<CliVerbStatus>>(
    new Set<CliVerbStatus>(['available', 'needs-wrapper', 'planned'])
  );

  function toggleStatus(status: CliVerbStatus) {
    const next = new Set(activeStatuses);
    if (next.has(status)) next.delete(status);
    else next.add(status);
    activeStatuses = next;
  }

  function clearFilters() {
    query = '';
    activeStatuses = new Set<CliVerbStatus>(['available', 'needs-wrapper', 'planned']);
  }

  function matchesQuery(verb: CliManifestVerb, q: string): boolean {
    if (!q) return true;
    const haystack = [
      verb.primaryVerb,
      verb.secondaryVerb ?? '',
      verb.usage,
      verb.summary,
      verb.flags.map((f) => f.name).join(' ')
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  }

  const filteredVerbs = $derived.by(() => {
    const q = query.trim().toLowerCase();
    return allVerbs.filter(
      (verb) => activeStatuses.has(verb.status) && matchesQuery(verb, q)
    );
  });

  // Group by primaryVerb, alphabetical group order, preserve manifest
  // order within each group. Returns an array of {primaryVerb, verbs}
  // tuples so the template can iterate without losing ordering.
  const groupedFiltered = $derived.by(() => {
    const map = new Map<string, CliManifestVerb[]>();
    for (const verb of filteredVerbs) {
      const arr = map.get(verb.primaryVerb);
      if (arr) arr.push(verb);
      else map.set(verb.primaryVerb, [verb]);
    }
    return [...map.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([primaryVerb, verbs]) => ({ primaryVerb, verbs }));
  });

  const groupTabs = $derived(
    groupedFiltered.map((g) => ({
      id: `verb-group-${g.primaryVerb}`,
      label: g.primaryVerb,
      count: g.verbs.length
    }))
  );

  // Only the v3 repo has a confirmed public GitHub remote
  // (github.com/Jktfe/a-nice-terminal). fresh-ant + delivery-plan refs
  // stay plain-text until those repos are public — the source_ref is a
  // grep key, the GitHub link is a convenience on top, and the copy
  // button covers the gap for non-v3 verbs.
  const SOURCE_REF_REPO_BASE: Partial<Record<NonNullable<CliManifestVerb['repo']>, string>> = {
    v3: 'https://github.com/Jktfe/a-nice-terminal/blob/main/'
  };

  function sourceRefHref(verb: CliManifestVerb): string | null {
    const base = SOURCE_REF_REPO_BASE[verb.repo ?? 'fresh-ant'];
    if (!base) return null;
    const [fileSlug, rangeSlug] = verb.source_ref.split(':');
    if (!rangeSlug) return `${base}${fileSlug}`;
    const firstRange = rangeSlug.split(',')[0];
    const [start, end] = firstRange.split('-');
    const anchor = end ? `#L${start}-L${end}` : `#L${start}`;
    return `${base}${fileSlug}${anchor}`;
  }
</script>

<SimplePageShell
  eyebrow="discover"
  title="ant CLI verbs"
  summary="The single source of truth for every ant verb. Generated at build time from src/lib/cli-manifest/manifest.ts."
>
  <nav class="discover-subnav" aria-label="Discover sections">
    <span class="subnav-label">Discover:</span>
    <Explainable explainKey="discover-visuals">
  <a class="subnav-link active" href="/discover" aria-current="page">CLI verbs</a>
  </Explainable>
    <a class="subnav-link" href="/discover/visuals">Visuals</a>
    <a class="subnav-link" href="/discover/vocab">Vocab</a>
    <a class="subnav-link" href="/manual">Screens canvas</a>
  </nav>

  <section class="toolbar" aria-label="Filter verbs">
    <div class="search-row">
      <label for="discover-search" class="visually-hidden">Search verbs</label>
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
          <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.75"/>
          <path d="M20 20l-4.35-4.35" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
        </svg>
        <input
          id="discover-search"
          type="search"
          placeholder="Search verbs, flags, summary…"
          bind:value={query}
          autocomplete="off"
          spellcheck="false"
        />
      </div>

      <div class="chips" role="group" aria-label="Status filter">
        <button
          type="button"
          class="chip chip-available"
          class:active={activeStatuses.has('available')}
          aria-pressed={activeStatuses.has('available')}
          onclick={() => toggleStatus('available')}
        >
          Available <span class="chip-count">{availableCount}</span>
        </button>
        <button
          type="button"
          class="chip chip-needs-wrapper"
          class:active={activeStatuses.has('needs-wrapper')}
          aria-pressed={activeStatuses.has('needs-wrapper')}
          onclick={() => toggleStatus('needs-wrapper')}
        >
          Needs wrapper <span class="chip-count">{needsWrapperCount}</span>
        </button>
        <button
          type="button"
          class="chip chip-planned"
          class:active={activeStatuses.has('planned')}
          aria-pressed={activeStatuses.has('planned')}
          onclick={() => toggleStatus('planned')}
        >
          Planned <span class="chip-count">{plannedCount}</span>
        </button>
      </div>
    </div>

    <p class="result-count">
      Showing <strong>{filteredVerbs.length}</strong> of {totalCount}
    </p>
  </section>

  {#if groupedFiltered.length > 0}
    <AnchorNavStrip tabs={groupTabs} ariaLabel="Verb groups" />

    {#each groupedFiltered as group (group.primaryVerb)}
      <section
        id={`verb-group-${group.primaryVerb}`}
        class="verb-section"
        aria-labelledby={`heading-${group.primaryVerb}`}
      >
        <h2 id={`heading-${group.primaryVerb}`}>
          {group.primaryVerb} <span class="group-count">({group.verbs.length})</span>
        </h2>
        <div class="verb-list">
          {#each group.verbs as verb (verb.id)}
            <VerbCard {verb} githubHref={sourceRefHref(verb)} />
          {/each}
        </div>
      </section>
    {/each}
  {:else}
    <section class="empty-state" aria-live="polite">
      <h2>No verbs match your filters.</h2>
      {#if query}
        <p>No matches for <code>{query}</code>.</p>
      {/if}
      <button type="button" class="clear-btn" onclick={clearFilters}>Clear filters</button>
    </section>
  {/if}

  <p class="generated-at">Manifest generated at {data.generatedAt}.</p>
</SimplePageShell>

<style>
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    margin: -1px;
    padding: 0;
    overflow: hidden;
    clip: rect(0 0 0 0);
    white-space: nowrap;
    border: 0;
  }

  .toolbar {
    margin: 0 0 1rem;
  }

  .search-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.6rem;
  }

  .search-wrap {
    position: relative;
    flex: 1 1 16rem;
    min-width: 12rem;
  }

  .search-icon {
    position: absolute;
    top: 50%;
    left: 0.85rem;
    transform: translateY(-50%);
    color: var(--ink-muted);
    pointer-events: none;
  }

  .search-wrap input {
    width: 100%;
    padding: 0.7rem 0.95rem 0.7rem 2.3rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.95rem;
  }

  .search-wrap input:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .chip {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.9rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 750;
    cursor: pointer;
    transition: border-color 0.12s, background-color 0.12s, color 0.12s;
  }

  .chip-count {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.4rem;
    height: 1.4rem;
    padding: 0 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink-strong) 10%, transparent);
    color: inherit;
    font-size: 0.75rem;
    font-weight: 800;
  }

  /* When INACTIVE the chip looks muted — when ACTIVE it adopts a tint
     matching its status colour. The dot palette mirrors VerbCard. */
  .chip:not(.active) { opacity: 0.62; }

  .chip-available.active {
    border-color: #10b981;
    background: color-mix(in srgb, #10b981 14%, var(--surface-card));
  }
  .chip-needs-wrapper.active {
    border-color: #f59e0b;
    background: color-mix(in srgb, #f59e0b 14%, var(--surface-card));
  }
  .chip-planned.active {
    border-color: #6366f1;
    background: color-mix(in srgb, #6366f1 14%, var(--surface-card));
  }

  .chip.active .chip-count {
    background: rgb(0 0 0 / 12%);
  }

  .result-count {
    margin: 0.8rem 0 0;
    font-size: 0.85rem;
    color: var(--ink-soft);
  }

  .verb-section {
    margin: 2.5rem 0;
    /* Generous fallback for URL-fragment deep-link loads (e.g. /discover#verb-group-rooms);
       click-driven jumps go through AnchorNavStrip.jumpTo() which measures
       the strip dynamically. ~9rem clears a 3-row wrapped strip plus gap. */
    scroll-margin-top: 9rem;
  }

  .verb-section h2 {
    margin: 0 0 1rem;
    font-size: 1.5rem;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .group-count {
    color: var(--ink-soft);
    font-weight: 600;
    font-size: 1rem;
  }

  .verb-list {
    display: grid;
    gap: 0.8rem;
  }

  .empty-state {
    margin: 3rem 0;
    padding: 2rem 1.5rem;
    text-align: center;
    border: 1px dashed var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
  }

  .empty-state h2 {
    margin: 0 0 0.6rem;
    font-size: 1.15rem;
  }

  .empty-state p {
    margin: 0 0 1rem;
    color: var(--ink-soft);
  }

  .clear-btn {
    padding: 0.55rem 1.1rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    cursor: pointer;
  }
  .clear-btn:hover {
    border-color: var(--accent);
    color: var(--accent);
  }

  .generated-at {
    margin: 3rem 0 0;
    color: var(--ink-soft);
    font-size: 0.8rem;
    text-align: right;
  }

  @media (max-width: 720px) {
    .search-row { flex-direction: column; align-items: stretch; }
    .chips { justify-content: flex-start; }
  }

  /* 4-pillar OSS docs sub-nav (added 2026-05-19 rover task e41ec066) */
  .discover-subnav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1.25rem;
    padding: 0.55rem 0.85rem;
    background: var(--surface-card);
    border: 1px solid var(--surface-edge);
    border-radius: 0.55rem;
  }
  .subnav-label {
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    margin-right: 0.35rem;
  }
  .subnav-link {
    padding: 0.25rem 0.65rem;
    border-radius: 0.4rem;
    color: var(--ink-strong);
    text-decoration: none;
    font-weight: 700;
    font-size: 0.85rem;
    border: 1px solid transparent;
  }
  .subnav-link:hover {
    background: var(--surface);
    border-color: var(--surface-edge);
  }
  .subnav-link.active {
    background: var(--accent, #6b21a8);
    color: white;
    border-color: var(--accent, #6b21a8);
  }
</style>
