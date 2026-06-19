<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const artefacts = $derived(data.artefacts ?? []);

  function formatDate(ms: number): string {
    return new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    }).format(new Date(ms));
  }
</script>

<svelte:head><title>Artefacts | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Artefacts"
  title="Artefacts."
  summary="Room artefacts you can read, gathered into one place."
>
  {#if artefacts.length === 0}
    <p class="empty">
      No artefacts in your readable rooms yet. Create one from a room's Artefacts panel.
    </p>
  {:else}
    <div class="artefact-list" aria-label="Readable artefacts">
      {#each artefacts as artefact (artefact.id)}
        <article class="artefact-card">
          <div class="artefact-main">
            <span class="kind">{artefact.kind}</span>
            <h2><a href={`/artefacts/${encodeURIComponent(artefact.id)}`}>{artefact.title}</a></h2>
            {#if artefact.summary}
              <p>{artefact.summary}</p>
            {/if}
          </div>
          <div class="artefact-meta">
            <a href={`/rooms/${encodeURIComponent(artefact.roomId)}`}>{artefact.roomName}</a>
            {#if artefact.createdBy}
              <span>{artefact.createdBy}</span>
            {/if}
            <time datetime={new Date(artefact.createdAtMs).toISOString()}>{formatDate(artefact.createdAtMs)}</time>
          </div>
        </article>
      {/each}
    </div>
  {/if}
</SimplePageShell>

<style>
  .empty {
    margin: 0;
    padding: 1rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.5rem;
    color: var(--ink-soft);
    background: var(--surface-card);
  }
  .artefact-list {
    display: grid;
    gap: 0.6rem;
  }
  .artefact-card {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    gap: 1rem;
    align-items: start;
    padding: 0.85rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--surface-card);
  }
  .artefact-main {
    min-width: 0;
  }
  .kind {
    display: inline-flex;
    margin-bottom: 0.25rem;
    padding: 0.1rem 0.4rem;
    border-radius: 0.35rem;
    background: var(--surface-raised);
    color: var(--ink-soft);
    font-size: 0.72rem;
    font-weight: 800;
    text-transform: uppercase;
  }
  h2 {
    margin: 0;
    font-size: 1rem;
  }
  h2 a,
  .artefact-meta a {
    color: var(--ink-strong);
    text-decoration: none;
  }
  h2 a:hover,
  .artefact-meta a:hover {
    text-decoration: underline;
  }
  p {
    margin: 0.35rem 0 0;
    color: var(--ink-soft);
    line-height: 1.45;
  }
  .artefact-meta {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    align-items: flex-end;
    color: var(--ink-soft);
    font-size: 0.82rem;
    white-space: nowrap;
  }
  @media (max-width: 720px) {
    .artefact-card {
      grid-template-columns: 1fr;
    }
    .artefact-meta {
      align-items: flex-start;
      white-space: normal;
    }
  }
</style>
