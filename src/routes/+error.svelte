<!--
  Root +error.svelte — global fallback for any thrown error or 404 that
  doesn't have a more-specific +error.svelte in its route subtree.
  Branches on the status code so 404 reads as "we couldn't find that"
  and 5xx reads as "something broke on our end."
-->
<script lang="ts">
  import { page } from '$app/state';
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';

  // Defensive read — server-side renders can land here before the
  // request scope wires `page` up fully.
  const status = (() => {
    try { return page.status ?? 500; }
    catch { return 500; }
  })();
  const errorMessage = (() => {
    try { return page.error?.message ?? null; }
    catch { return null; }
  })();
  const triedPath = (() => {
    try { return page.url?.pathname ?? null; }
    catch { return null; }
  })();

  const isNotFound = $derived(status === 404);
</script>

<svelte:head>
  <title>{isNotFound ? 'Not found' : 'Something went wrong'} | ANT vNext</title>
</svelte:head>

<SimplePageShell
  eyebrow={isNotFound ? 'Not found' : `Error ${status}`}
  title={isNotFound ? "We couldn't find that." : 'Something went wrong on our end.'}
  summary={isNotFound
    ? 'The page you tried to open does not exist — it may have moved, been renamed, or never existed.'
    : 'Try the action again. If it keeps failing, check /diagnostics or share the URL with the team.'}
>
  {#if triedPath}
    <p class="path-trace" role="status">
      Tried: <code>{triedPath}</code>
    </p>
  {/if}
  {#if errorMessage}
    <p class="error-detail" role="alert">{errorMessage}</p>
  {/if}

  <div class="actions">
    <a class="primary-link" href="/" aria-label="Back to dashboard">← Dashboard</a>
    <a class="secondary-link" href="/rooms" aria-label="See all rooms">Rooms</a>
    <a class="secondary-link" href="/diagnostics" aria-label="Open diagnostics">Diagnostics</a>
  </div>

  <p class="hint">
    Press <kbd>⌘K</kbd> to jump anywhere, or <kbd>?</kbd> to see all keyboard shortcuts.
  </p>
</SimplePageShell>

<style>
  .path-trace {
    margin: 0 0 0.75rem;
    padding: 0.45rem 0.75rem;
    border: 1px dashed var(--line-soft);
    border-radius: 0.6rem;
    background: var(--bg);
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .path-trace code {
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    color: var(--ink-strong);
  }
  .error-detail {
    margin: 0 0 0.85rem;
    padding: 0.85rem 1rem;
    border: 1px solid var(--warn);
    border-radius: 0.85rem;
    background: color-mix(in srgb, var(--warn) 16%, var(--surface-card));
    color: var(--ink-strong);
  }
  .actions {
    display: flex;
    gap: 0.55rem;
    flex-wrap: wrap;
    margin: 0.5rem 0 1.25rem;
  }
  .primary-link,
  .secondary-link {
    padding: 0.55rem 1.1rem;
    border-radius: 999px;
    font-weight: 800;
    text-decoration: none;
  }
  .primary-link {
    border: 1px solid var(--accent);
    background: var(--accent);
    color: white;
  }
  .primary-link:hover { filter: brightness(1.05); }
  .secondary-link {
    border: 1px solid var(--line-soft);
    background: var(--surface-card);
    color: var(--ink-strong);
  }
  .secondary-link:hover { border-color: var(--accent); color: var(--accent); }
  .hint {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .hint kbd {
    display: inline-block;
    padding: 0.05rem 0.4rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.3rem;
    background: var(--bg);
    color: var(--ink-strong);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.78rem;
  }
</style>
