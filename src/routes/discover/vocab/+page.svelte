<!--
  /discover/vocab - ANT vocabulary help page.
  Source artefact: /Users/jamesking/CascadeProjects/ANT Vocabulary.html
  Verdict: CHANGE. The source terms are kept as product language, then refined
  against current ANT delivery decisions before rendering here.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import {
    ANT_VOCABULARY_ENTRIES,
    ANT_VOCABULARY_GROUPS,
    ANT_VOCABULARY_SOURCE,
    type AntVocabularyEntry,
    type AntVocabularyGroup
  } from '$lib/content/antVocabulary';
  const GROUP_LABELS = Object.fromEntries(
    ANT_VOCABULARY_GROUPS.map((group) => [group.id, group.label])
  ) as Record<AntVocabularyGroup, string>;
  const GROUP_COUNTS = Object.fromEntries(
    ANT_VOCABULARY_GROUPS.map((group) => [
      group.id,
      ANT_VOCABULARY_ENTRIES.filter((entry) => entry.group === group.id).length
    ])
  ) as Record<AntVocabularyGroup, number>;
  const totalCount = ANT_VOCABULARY_ENTRIES.length;
  let query = $state('');
  let activeGroups = $state(new Set<AntVocabularyGroup>());
  const normalisedQuery = $derived(query.trim().toLowerCase());
  function toggleGroup(group: AntVocabularyGroup): void {
    const next = new Set(activeGroups);
    if (next.has(group)) next.delete(group);
    else next.add(group);
    activeGroups = next;
  }
  function clearFilters(): void {
    query = '';
    activeGroups = new Set();
  }
  function entryMatchesQuery(entry: AntVocabularyEntry, q: string): boolean {
    if (!q) return true;
    const haystack = [
      entry.term,
      entry.plain,
      entry.aliases?.join(' ') ?? '',
      entry.examples?.join(' ') ?? '',
      entry.seeAlso?.join(' ') ?? '',
      GROUP_LABELS[entry.group]
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(q);
  }
  const filteredEntries = $derived.by(() =>
    ANT_VOCABULARY_ENTRIES.filter((entry) => {
      if (activeGroups.size > 0 && !activeGroups.has(entry.group)) return false;
      return entryMatchesQuery(entry, normalisedQuery);
    })
  );
  const groupedEntries = $derived.by(() =>
    ANT_VOCABULARY_GROUPS.map((group) => ({
      ...group,
      entries: filteredEntries.filter((entry) => entry.group === group.id)
    })).filter((group) => group.entries.length > 0)
  );
  const hasFilters = $derived(query.trim().length > 0 || activeGroups.size > 0);
</script>
<svelte:head>
  <title>ANT vocabulary help - ANT</title>
</svelte:head>
<SimplePageShell
  eyebrow="help"
  title="ANT vocabulary"
  summary="Plain-English definitions for the words ANT uses around rooms, desks, terminals, helpers, identities, workflows, and reviews."
>
  <nav class="discover-subnav" aria-label="Discover sections">
    <span class="subnav-label">Help:</span>
    <a class="subnav-link" href="/discover">CLI verbs</a>
    <a class="subnav-link" href="/discover/visuals">Visuals</a>
    <a class="subnav-link active" href="/discover/vocab" aria-current="page">Vocabulary</a>
    <a class="subnav-link" href="/manual">Screens canvas</a>
  </nav>
  <section class="source-panel" aria-label="Vocabulary source and current rules">
    <div>
      <p class="source-eyebrow">Updated source</p>
      <p>{ANT_VOCABULARY_SOURCE}</p>
    </div>
    <div class="rule-card">
      <strong>Current helper rule</strong>
      <span>ANThelper pairings can read feeds, receive routes, and post status when scoped. They do not author room messages as a handle.</span>
    </div>
  </section>
  <section class="toolbar" aria-label="Search and filter vocabulary">
    <div class="search-row">
      <label for="vocab-search" class="visually-hidden">Search vocabulary</label>
      <div class="search-wrap">
        <svg class="search-icon" viewBox="0 0 24 24" aria-hidden="true" width="16" height="16">
          <circle cx="11" cy="11" r="6" fill="none" stroke="currentColor" stroke-width="1.75"/>
          <path d="M20 20l-4.35-4.35" stroke="currentColor" stroke-width="1.75" stroke-linecap="round"/>
        </svg>
        <input
          id="vocab-search"
          type="search"
          placeholder="Search a term, alias, or phrase"
          bind:value={query}
          autocomplete="off"
          spellcheck="false"
        />
        {#if query}
          <button type="button" class="clear-search" aria-label="Clear search" onclick={() => (query = '')}>
            Clear
          </button>
        {/if}
      </div>
    </div>
    <div class="chips" role="group" aria-label="Category filters">
      {#each ANT_VOCABULARY_GROUPS as group (group.id)}
        <button
          type="button"
          class="chip"
          class:active={activeGroups.has(group.id)}
          aria-pressed={activeGroups.has(group.id)}
          aria-label={`Toggle ${group.label} terms`}
          onclick={() => toggleGroup(group.id)}
        >
          <span>{group.label}</span>
          <span class="chip-count">{GROUP_COUNTS[group.id]}</span>
        </button>
      {/each}
    </div>
    <div class="result-row">
      <p>
        Showing <strong>{filteredEntries.length}</strong> of {totalCount} terms
        {#if activeGroups.size > 0}
          across <strong>{activeGroups.size}</strong> selected categories
        {/if}
      </p>
      {#if hasFilters}
        <button type="button" class="reset-btn" onclick={clearFilters}>Reset filters</button>
      {/if}
    </div>
  </section>
  {#if groupedEntries.length > 0}
    <div class="section-stack">
      {#each groupedEntries as group (group.id)}
        <section class="vocab-section" aria-labelledby={`section-${group.id}`}>
          <header class="section-header">
            <div>
              <p>{group.summary}</p>
              <h2 id={`section-${group.id}`}>{group.label}</h2>
            </div>
            <span>{group.entries.length} terms</span>
          </header>
          <dl class="vocab-list">
            {#each group.entries as entry (entry.id)}
              <div class="vocab-entry" id={`term-${entry.id}`}>
                <dt>
                  <a href={`#term-${entry.id}`}>{entry.term}</a>
                </dt>
                <dd>
                  <p class="plain">{entry.plain}</p>
                  {#if entry.aliases?.length}
                    <p class="meta-line">
                      <span>Also called</span>
                      {entry.aliases.join(', ')}
                    </p>
                  {/if}
                  {#if entry.examples?.length}
                    <ul class="examples" aria-label={`${entry.term} examples`}>
                      {#each entry.examples as example}
                        <li>{example}</li>
                      {/each}
                    </ul>
                  {/if}
                  {#if entry.seeAlso?.length}
                    <p class="meta-line">
                      <span>See also</span>
                      {entry.seeAlso.join(', ')}
                    </p>
                  {/if}
                </dd>
              </div>
            {/each}
          </dl>
        </section>
      {/each}
    </div>
  {:else}
    <section class="empty-state" aria-live="polite">
      <h2>No vocabulary terms match.</h2>
      {#if query}
        <p>No matches for <code>{query}</code>.</p>
      {:else}
        <p>The selected categories do not contain terms.</p>
      {/if}
      <button type="button" class="reset-btn prominent" onclick={clearFilters}>Show all terms</button>
    </section>
  {/if}
  <p class="footer-note">
    Cross-reference:
    <a href="/discover">CLI verbs</a>,
    <a href="/discover/visuals">visuals</a>, and
    <a href="/manual">screens canvas</a>.
    The vocabulary page is the human-readable layer for the same product model.
  </p>
</SimplePageShell>
<style>
  .visually-hidden {
    position: absolute;
    width: 1px;
    height: 1px;
    padding: 0;
    margin: -1px;
    overflow: hidden;
    clip: rect(0, 0, 0, 0);
    white-space: nowrap;
    border: 0;
  }
  .discover-subnav,
  .source-panel,
  .toolbar,
  .footer-note {
    border: 1px solid var(--surface-edge);
    background: var(--surface-card);
    box-shadow: 0 10px 26px rgb(31 41 55 / 6%);
  }
  .discover-subnav {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.5rem;
    margin: 0 0 1rem;
    padding: 0.55rem 0.85rem;
    border-radius: 0.55rem;
  }
  .subnav-label {
    margin-right: 0.35rem;
    color: var(--ink-soft);
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .subnav-link {
    padding: 0.25rem 0.65rem;
    border: 1px solid transparent;
    border-radius: 0.4rem;
    color: var(--ink-strong);
    font-size: 0.85rem;
    font-weight: 700;
    text-decoration: none;
  }
  .subnav-link:hover {
    border-color: var(--surface-edge);
    background: var(--surface);
  }
  .subnav-link.active {
    border-color: var(--accent, #6b21a8);
    background: var(--accent, #6b21a8);
    color: white;
  }
  .source-panel {
    display: grid;
    grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.85fr);
    gap: 1rem;
    margin: 0 0 1rem;
    padding: 1rem;
    border-radius: 0.65rem;
  }
  .source-panel p {
    margin: 0;
    color: var(--ink-soft);
    line-height: 1.5;
  }
  .source-eyebrow {
    margin: 0 0 0.25rem !important;
    color: var(--ink-strong) !important;
    font-size: 0.78rem;
    font-weight: 800;
    letter-spacing: 0.06em;
    text-transform: uppercase;
  }
  .rule-card {
    display: grid;
    gap: 0.25rem;
    padding: 0.8rem 0.9rem;
    border: 1px solid color-mix(in srgb, var(--accent, #6b21a8) 32%, var(--surface-edge));
    border-radius: 0.55rem;
    background: color-mix(in srgb, var(--accent, #6b21a8) 8%, transparent);
    color: var(--ink-strong);
  }
  .rule-card strong {
    font-size: 0.86rem;
  }
  .rule-card span {
    color: var(--ink-soft);
    font-size: 0.86rem;
    line-height: 1.45;
  }
  .toolbar {
    display: grid;
    gap: 0.85rem;
    margin: 0 0 1.25rem;
    padding: 1rem;
    border-radius: 0.65rem;
  }
  .search-row {
    display: flex;
    gap: 0.85rem;
    align-items: center;
  }
  .search-wrap {
    position: relative;
    width: 100%;
  }
  .search-icon {
    position: absolute;
    top: 50%;
    left: 0.75rem;
    transform: translateY(-50%);
    color: var(--ink-soft);
  }
  #vocab-search {
    width: 100%;
    min-height: 2.6rem;
    padding: 0.58rem 4.8rem 0.58rem 2.2rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.55rem;
    background: var(--surface);
    color: var(--ink-strong);
    font-size: 0.95rem;
  }
  #vocab-search:focus {
    outline: 2px solid color-mix(in srgb, var(--accent, #6b21a8) 28%, transparent);
    border-color: var(--accent, #6b21a8);
  }
  .clear-search {
    position: absolute;
    top: 50%;
    right: 0.45rem;
    transform: translateY(-50%);
    min-height: 1.8rem;
    padding: 0 0.6rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.42rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .chips {
    display: flex;
    flex-wrap: wrap;
    gap: 0.45rem;
  }
  .chip {
    display: inline-flex;
    gap: 0.4rem;
    align-items: center;
    min-height: 2rem;
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    background: var(--surface);
    color: var(--ink-strong);
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
  }
  .chip:hover {
    border-color: var(--accent, #6b21a8);
  }
  .chip.active {
    border-color: var(--accent, #6b21a8);
    background: var(--accent, #6b21a8);
    color: white;
  }
  .chip-count {
    opacity: 0.8;
    font-weight: 700;
  }
  .result-row {
    display: flex;
    flex-wrap: wrap;
    gap: 0.75rem;
    align-items: center;
    justify-content: space-between;
  }
  .result-row p {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.86rem;
  }
  .reset-btn {
    min-height: 2rem;
    padding: 0.35rem 0.7rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.45rem;
    background: var(--surface);
    color: var(--ink-strong);
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
  }
  .reset-btn:hover {
    border-color: var(--accent, #6b21a8);
    color: var(--accent, #6b21a8);
  }
  .reset-btn.prominent {
    border-color: var(--accent, #6b21a8);
    background: var(--accent, #6b21a8);
    color: white;
  }
  .section-stack {
    display: grid;
    gap: 1.15rem;
  }
  .vocab-section {
    display: grid;
    gap: 0.75rem;
  }
  .section-header {
    display: flex;
    gap: 1rem;
    align-items: end;
    justify-content: space-between;
    padding: 0.15rem 0.1rem;
  }
  .section-header h2,
  .section-header p {
    margin: 0;
  }
  .section-header h2 {
    color: var(--ink-strong);
    font-size: 1.05rem;
  }
  .section-header p {
    margin-bottom: 0.18rem;
    color: var(--ink-soft);
    font-size: 0.84rem;
  }
  .section-header span {
    flex: 0 0 auto;
    color: var(--ink-soft);
    font-size: 0.82rem;
    font-weight: 800;
  }
  .vocab-list {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(min(100%, 22rem), 1fr));
    gap: 0.65rem;
    margin: 0;
  }
  .vocab-entry {
    scroll-margin-top: 5rem;
    padding: 0.9rem 1rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--surface-card);
  }
  .vocab-entry:target {
    border-color: var(--accent, #6b21a8);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent, #6b21a8) 18%, transparent);
  }
  .vocab-entry dt {
    margin: 0 0 0.35rem;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.92rem;
    font-weight: 900;
  }
  .vocab-entry dt a {
    color: var(--accent, #6b21a8);
    text-decoration: none;
  }
  .vocab-entry dt a:hover {
    text-decoration: underline;
  }
  .vocab-entry dd {
    margin: 0;
  }
  .plain {
    margin: 0;
    color: var(--ink-strong);
    font-size: 0.92rem;
    line-height: 1.5;
  }
  .meta-line {
    display: grid;
    gap: 0.15rem;
    margin: 0.55rem 0 0;
    color: var(--ink-soft);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .meta-line span {
    color: var(--ink-strong);
    font-size: 0.72rem;
    font-weight: 900;
    letter-spacing: 0.05em;
    text-transform: uppercase;
  }
  .examples {
    display: grid;
    gap: 0.25rem;
    margin: 0.6rem 0 0;
    padding-left: 1.15rem;
    color: var(--ink-soft);
    font-size: 0.84rem;
    line-height: 1.45;
  }
  .empty-state {
    display: grid;
    justify-items: center;
    gap: 0.65rem;
    padding: 1.5rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.65rem;
    background: var(--surface-card);
    text-align: center;
  }
  .empty-state h2,
  .empty-state p {
    margin: 0;
  }
  .empty-state h2 {
    color: var(--ink-strong);
    font-size: 1rem;
  }
  .empty-state p {
    color: var(--ink-soft);
  }
  .footer-note {
    margin: 1.4rem 0 0;
    padding: 0.85rem 1rem;
    border-radius: 0.65rem;
    color: var(--ink-soft);
    font-size: 0.86rem;
    line-height: 1.5;
  }
  .footer-note a {
    color: var(--accent, #6b21a8);
    font-weight: 800;
    text-decoration: none;
  }
  .footer-note a:hover {
    text-decoration: underline;
  }
  @media (max-width: 760px) {
    .source-panel {
      grid-template-columns: 1fr;
    }
    .section-header {
      align-items: start;
      flex-direction: column;
    }
    #vocab-search {
      padding-right: 4.2rem;
    }
  }
</style>
