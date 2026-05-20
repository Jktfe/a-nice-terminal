<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  const artefact = $derived(data.artefact);
  const canFrame = $derived(
    artefact.refUrl
      ? artefact.refUrl.startsWith('/') || artefact.refUrl.startsWith('http://') || artefact.refUrl.startsWith('https://')
      : false
  );
  const isUniverKind = $derived(['spreadsheet', 'doc', 'deck'].includes(artefact.kind));
  const kindLabel = $derived(artefact.kind === 'doc' ? 'Document' : artefact.kind === 'deck' ? 'Slides' : artefact.kind === 'spreadsheet' ? 'Spreadsheet' : 'Artefact');
</script>

<svelte:head><title>{artefact.title} | Artefact | ANT</title></svelte:head>

<SimplePageShell
  eyebrow={isUniverKind ? `Univer ${kindLabel}` : kindLabel}
  title={artefact.title}
  summary={`${kindLabel} from room ${artefact.roomId}${artefact.createdBy ? ` · by ${artefact.createdBy}` : ''}`}
>
  <div class="toolbar" role="toolbar" aria-label="Artefact controls">
    <a class="back" href={`/rooms/${encodeURIComponent(artefact.roomId)}`}>← Back to room</a>
    <span class="spacer"></span>
    {#if artefact.refUrl}
      <a class="action" href={artefact.refUrl} target="_blank" rel="noreferrer">Open source</a>
    {/if}
  </div>

  {#if artefact.summary}
    <p class="summary">{artefact.summary}</p>
  {/if}

  {#if isUniverKind}
    <section class="univer-shell" aria-label="Univer workspace">
      <header>
        <span>{kindLabel}</span>
        <strong>Viewer shell</strong>
      </header>
      {#if canFrame && artefact.refUrl}
        <iframe title={artefact.title} src={artefact.refUrl}></iframe>
      {:else}
        <div class="empty-state">
          <p>No inline source is attached yet.</p>
        </div>
      {/if}
    </section>
  {:else if canFrame && artefact.refUrl}
    <iframe class="generic-frame" title={artefact.title} src={artefact.refUrl}></iframe>
  {:else}
    <div class="empty-state">
      <p>This artefact has no browser-viewable source yet.</p>
      {#if artefact.refUrl}<code>{artefact.refUrl}</code>{/if}
    </div>
  {/if}
</SimplePageShell>

<style>
  .toolbar {
    display: flex;
    align-items: center;
    gap: 0.6rem;
    margin-bottom: 1rem;
  }
  .spacer { flex: 1; }
  .back,
  .action {
    color: var(--ink-soft);
    text-decoration: none;
    font-weight: 800;
    font-size: 0.86rem;
  }
  .back:hover,
  .action:hover { color: var(--accent); }
  .summary {
    margin: 0 0 1rem;
    color: var(--ink-soft);
  }
  .univer-shell {
    min-height: 68vh;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
    overflow: hidden;
  }
  .univer-shell header {
    display: flex;
    justify-content: space-between;
    gap: 1rem;
    padding: 0.7rem 0.9rem;
    border-bottom: 1px solid var(--line-soft);
    color: var(--ink-soft);
    font-size: 0.84rem;
    font-weight: 800;
  }
  .univer-shell iframe,
  .generic-frame {
    width: 100%;
    min-height: 68vh;
    border: 0;
    background: white;
  }
  .generic-frame {
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
  }
  .empty-state {
    display: grid;
    place-items: center;
    min-height: 18rem;
    padding: 2rem;
    color: var(--ink-soft);
    text-align: center;
  }
  .empty-state code {
    display: block;
    max-width: 100%;
    overflow-wrap: anywhere;
  }
</style>
