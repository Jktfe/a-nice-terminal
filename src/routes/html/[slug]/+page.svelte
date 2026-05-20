<!--
  /html/[slug] — sandboxed HTML artefact viewer.

  Renders the file inside an <iframe srcdoc> with sandbox attributes
  that block scripts, forms, popups, top-nav, same-origin access by
  default. This is the v3 'Safe' deck-trust mode applied here.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let viewSource = $state(false);
  let shareNotice = $state('');

  async function copyShareLink(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      shareNotice = 'Clipboard API unavailable.';
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
</script>

<svelte:head><title>{data.slug} | HTML | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="HTML artefact"
  title={data.slug.replace(/-/g, ' ').replace(/\b./g, (c) => c.toUpperCase())}
  summary={`${Math.round(data.sizeBytes / 1024)} KB · last modified ${data.modifiedAtMs ? new Date(data.modifiedAtMs).toLocaleString() : '—'} · sandboxed render`}
>
  <div class="toolbar" role="toolbar" aria-label="HTML controls">
    <a class="back" href="/policies">← Catalogue</a>
    <span class="spacer"></span>
    <button type="button" class="toolbar-btn" onclick={() => (viewSource = !viewSource)} aria-pressed={viewSource}>
      {viewSource ? 'Show rendered' : 'View source'}
    </button>
    <button type="button" class="toolbar-btn" onclick={copyShareLink}>Copy share link</button>
  </div>

  {#if shareNotice}
    <p class="share-notice" role="status">{shareNotice}</p>
  {/if}

  {#if viewSource}
    <pre class="source-view"><code>{data.body}</code></pre>
  {:else}
    <iframe
      class="html-iframe"
      title={`HTML artefact ${data.slug}`}
      sandbox=""
      srcdoc={data.body}
    ></iframe>
    <p class="sandbox-note">Rendered inside a same-origin-blocked, scripts-blocked iframe (Safe mode).</p>
  {/if}
</SimplePageShell>

<style>
  .back { color: var(--ink-soft); text-decoration: none; font-weight: 700; font-size: 0.85rem; }
  .back:hover { color: var(--accent); }
  .toolbar {
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
  .html-iframe {
    width: 100%;
    height: 75vh;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: white;
  }
  .sandbox-note {
    margin: 0.5rem 0 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
    text-align: center;
  }
  .source-view {
    margin: 0;
    padding: 1.2rem 1.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--bg);
    overflow: auto;
    max-height: 80vh;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.85rem;
    color: var(--ink-strong);
  }
</style>
