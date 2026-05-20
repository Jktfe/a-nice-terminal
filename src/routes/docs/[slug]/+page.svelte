<!--
  /docs/[slug] — render a markdown doc with the same pipeline chat uses.

  Provides keyboard fullscreen toggle (F), a copy-share-link button, and
  a tiny "view source" affordance that shows the raw markdown next to the
  rendered output for agents reading programmatically.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import { renderMarkdown } from '$lib/chat/renderMarkdown';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let showSource = $state(false);
  let shareNotice = $state('');

  const rendered = $derived(renderMarkdown(data.markdown));

  async function copyShareLink(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      shareNotice = 'Clipboard API unavailable — copy from the address bar.';
      return;
    }
    try {
      await navigator.clipboard.writeText(location.href);
      shareNotice = 'Link copied.';
      setTimeout(() => (shareNotice = ''), 2500);
    } catch {
      shareNotice = 'Could not copy.';
    }
  }

  function handleKey(event: KeyboardEvent) {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
    if (event.key === 's' || event.key === 'S') {
      showSource = !showSource;
    }
  }

  onMount(() => {
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  });
</script>

<svelte:head><title>{data.slug} | Doc | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Doc"
  title={data.slug.replace(/-/g, ' ').replace(/\b./g, (c) => c.toUpperCase())}
  summary={`${data.markdown.split('\n').length} lines · last modified ${data.modifiedAtMs ? new Date(data.modifiedAtMs).toLocaleString() : '—'}`}
>
  <div class="doc-toolbar" role="toolbar" aria-label="Doc controls">
    <a class="back" href="/policies">← Catalogue</a>
    <span class="spacer"></span>
    <button type="button" class="toolbar-btn" onclick={() => (showSource = !showSource)} aria-pressed={showSource}>
      {showSource ? 'Hide source' : 'View source'} <kbd>S</kbd>
    </button>
    <button type="button" class="toolbar-btn" onclick={copyShareLink}>Copy share link</button>
  </div>

  {#if shareNotice}
    <p class="share-notice" role="status">{shareNotice}</p>
  {/if}

  <div class="doc-layout" class:with-source={showSource}>
    <article class="doc-body markdown-body">
      {@html rendered}
    </article>
    {#if showSource}
      <aside class="doc-source" aria-label="Markdown source">
        <header><h3>Source</h3><span class="muted">{data.filePath.replace(/^.*ANT-Docs\//, 'ANT-Docs/')}</span></header>
        <pre><code>{data.markdown}</code></pre>
      </aside>
    {/if}
  </div>
</SimplePageShell>

<style>
  .back { color: var(--ink-soft); text-decoration: none; font-weight: 700; font-size: 0.85rem; }
  .back:hover { color: var(--accent); }
  .doc-toolbar {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin: 0 0 1rem;
  }
  .spacer { flex: 1; }
  .toolbar-btn {
    padding: 0.45rem 0.85rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-weight: 800;
    font-size: 0.82rem;
    cursor: pointer;
  }
  .toolbar-btn:hover { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn[aria-pressed='true'] { border-color: var(--accent); color: var(--accent); }
  .toolbar-btn kbd {
    display: inline-block;
    margin-left: 0.4rem;
    padding: 0.05rem 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.7rem;
  }
  .share-notice {
    margin: 0 0 0.85rem;
    padding: 0.55rem 0.85rem;
    border: 1px solid var(--accent);
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--accent) 12%, var(--surface-card));
    color: var(--ink-strong);
    font-weight: 700;
    font-size: 0.85rem;
  }
  .doc-layout {
    display: grid;
    grid-template-columns: 1fr;
    gap: 1.25rem;
  }
  .doc-layout.with-source {
    grid-template-columns: 1.4fr 1fr;
  }
  @media (max-width: 900px) {
    .doc-layout.with-source { grid-template-columns: 1fr; }
  }
  .doc-body {
    padding: 2rem 2.2rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    line-height: 1.65;
    font-size: 1.02rem;
  }
  .doc-body :global(h1), .doc-body :global(h2), .doc-body :global(h3) { color: var(--ink-strong); }
  .doc-body :global(h1) { font-size: 2rem; margin-top: 0.5rem; }
  .doc-body :global(h2) { font-size: 1.4rem; margin-top: 2rem; border-bottom: 1px solid var(--line-soft); padding-bottom: 0.4rem; }
  .doc-body :global(h3) { font-size: 1.1rem; margin-top: 1.5rem; }
  .doc-body :global(code) {
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    background: var(--bg);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.9em;
  }
  .doc-body :global(pre) {
    padding: 0.85rem 1rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--bg);
    overflow-x: auto;
  }
  .doc-body :global(pre code) { padding: 0; background: transparent; }
  .doc-body :global(img) { max-width: 100%; border-radius: 0.5rem; }
  .doc-body :global(table) { border-collapse: collapse; width: 100%; margin: 1rem 0; }
  .doc-body :global(th), .doc-body :global(td) {
    padding: 0.5rem 0.75rem;
    border: 1px solid var(--line-soft);
    text-align: left;
  }
  .doc-body :global(blockquote) {
    margin: 1rem 0;
    padding: 0.5rem 1rem;
    border-left: 3px solid var(--accent);
    background: var(--bg);
    color: var(--ink-soft);
  }
  .doc-source {
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--bg);
    overflow: hidden;
  }
  .doc-source header {
    display: flex;
    align-items: baseline;
    gap: 0.65rem;
    padding: 0.6rem 1rem;
    border-bottom: 1px solid var(--line-soft);
    background: var(--surface-card);
  }
  .doc-source header h3 { margin: 0; font-size: 0.78rem; text-transform: uppercase; letter-spacing: 0.05em; color: var(--ink-soft); }
  .doc-source .muted { font-family: 'JetBrains Mono', monospace; font-size: 0.78rem; color: var(--ink-soft); }
  .doc-source pre { margin: 0; padding: 1rem 1.25rem; overflow: auto; max-height: 70vh; font-family: 'JetBrains Mono', monospace; font-size: 0.82rem; color: var(--ink-strong); }
</style>
