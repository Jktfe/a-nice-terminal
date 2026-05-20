<!--
  VerbCard — one CLI verb on the /discover page.

  Renders the verb's usage, summary, optional example + flags, and source_ref
  with a copy-to-clipboard affordance. v3-repo refs additionally get a
  GitHub link wrapper (existing behaviour preserved); fresh-ant +
  delivery-plan refs render as plain code + copy button only.

  Status (available / needs-wrapper / planned) is conveyed via a small
  coloured dot inline with the usage line — the per-status coloured
  left-border from the prior design is dropped because cards are no
  longer grouped by status (they're grouped by primaryVerb now).
-->
<script lang="ts">
  import type { CliManifestVerb } from '$lib/cli-manifest/manifest';

  type Props = { verb: CliManifestVerb; githubHref: string | null };
  let { verb, githubHref }: Props = $props();

  let justCopied = $state(false);
  let copyTimer: ReturnType<typeof setTimeout> | null = null;

  function flagSummary(): string {
    if (verb.flags.length === 0) return '(no flags)';
    return verb.flags
      .map((flag) => {
        const def = flag.default !== undefined ? ` =${flag.default}` : '';
        const con = flag.constraint ? ` [${flag.constraint}]` : '';
        return `--${flag.name}:${flag.type}${def}${con}`;
      })
      .join('  ');
  }

  async function copySourceRef() {
    try {
      await navigator.clipboard.writeText(verb.source_ref);
      justCopied = true;
      if (copyTimer) clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { justCopied = false; }, 1500);
    } catch (err) {
      // Clipboard permission denied or unavailable (HTTP, etc.) — log
      // and noop. The plain file:line text is still selectable manually.
      console.warn('source_ref copy failed', err);
    }
  }

  const statusLabel = $derived(
    verb.status === 'available'
      ? 'Available'
      : verb.status === 'needs-wrapper'
        ? 'Needs wrapper'
        : 'Planned'
  );
</script>

<article class="verb" data-verb-id={verb.id} data-status={verb.status}>
  <div class="usage-row">
    <span
      class="status-dot status-{verb.status}"
      aria-label={`status: ${statusLabel}`}
      title={statusLabel}
    ></span>
    <code class="usage">{verb.usage}</code>
  </div>
  <p class="summary">{verb.summary}</p>

  {#if verb.canonical_example}
    <p class="example">
      <span class="label">{verb.status === 'planned' ? 'Sketched:' : 'Example:'}</span>
      <code>{verb.canonical_example}</code>
    </p>
  {/if}

  {#if verb.flags.length > 0}
    <p class="flags"><span class="label">Flags:</span> <code>{flagSummary()}</code></p>
  {/if}

  <p class="source-ref">
    <span class="label">Source:</span>
    {#if githubHref}
      <a class="source-link" href={githubHref} target="_blank" rel="noopener noreferrer">
        <code>{verb.source_ref}</code>
      </a>
    {:else}
      <code>{verb.source_ref}</code>
    {/if}
    <button
      type="button"
      class="copy-source"
      class:copied={justCopied}
      onclick={copySourceRef}
      title={justCopied ? 'Copied' : 'Copy source_ref'}
      aria-label={`Copy source ref for ${verb.id}`}
    >
      {#if justCopied}
        <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
          <path d="M5 12l4 4L19 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      {:else}
        <svg viewBox="0 0 24 24" aria-hidden="true" width="14" height="14">
          <rect x="9" y="9" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="1.75"/>
          <path d="M5 15V6a1 1 0 011-1h9" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>
      {/if}
    </button>
  </p>
</article>

<style>
  .verb {
    padding: 1rem 1.25rem;
    border-radius: 0.85rem;
    border: 1px solid var(--line-soft);
    background: var(--surface-card);
  }

  .usage-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    margin-bottom: 0.4rem;
  }

  .status-dot {
    width: 0.6rem;
    height: 0.6rem;
    border-radius: 999px;
    flex-shrink: 0;
    background: var(--ink-muted);
  }

  .status-dot.status-available { background: #10b981; }
  .status-dot.status-needs-wrapper { background: #f59e0b; }
  .status-dot.status-planned { background: #6366f1; }

  .usage {
    font-size: 1rem;
    font-weight: 700;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .summary {
    margin: 0 0 0.5rem;
    color: var(--ink-strong);
  }

  .example,
  .flags,
  .source-ref {
    margin: 0.25rem 0;
    font-size: 0.85rem;
    overflow-wrap: anywhere;
  }

  .source-ref {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.35rem;
  }

  .label {
    font-weight: 700;
    color: var(--ink-soft);
    margin-right: 0.4rem;
  }

  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  }

  .source-link {
    color: var(--accent);
    text-decoration: none;
  }
  .source-link:hover { text-decoration: underline; }

  .copy-source {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.55rem;
    height: 1.55rem;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    transition: color 0.12s, border-color 0.12s;
  }

  .copy-source:hover {
    color: var(--accent);
    border-color: var(--accent);
  }

  .copy-source.copied {
    color: #10b981;
    border-color: #10b981;
  }
</style>
