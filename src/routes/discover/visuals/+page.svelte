<!--
  /discover/visuals — gallery of ANT primitive visuals.

  rover-evolveantux task e41ec066 (v4-fresh-ant): the VISUALS sub-page of
  the 4-pillar OSS documentation surface (verbs · screens · visuals ·
  vocab). Each card renders the SVG inline (theme-aware via the SVG's own
  prefers-color-scheme fallback) + a short caption with route to the
  wrapper doc + tier tag.

  Source SVGs live in ObsidiANT/audits/visuals/ and are copied into
  static/visuals/ at build time. Update one place, regenerate the static
  copy with `cp ObsidiANT/audits/visuals/*.svg static/visuals/`.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';

  type Visual = {
    slug: string;
    title: string;
    summary: string;
    tier: 'oss' | 'premium-overlay';
    sourcePath: string; // ObsidiANT-relative for the source-of-truth link
  };

  const VISUALS: Visual[] = [
    {
      slug: 'claim-primitive-state-machine-2026-05-19',
      title: 'Claim primitive — state machine',
      summary: 'Three-column walkthrough: pre-claim (brainstorm) → 🤝 handshake → heads-down responder walk. Covers 🖐️ looking / 🤝 working / 👐 pass transitions + TTL semantics.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/claim-primitive-state-machine-2026-05-19.md'
    },
    {
      slug: 'routing-modes-3up-2026-05-19',
      title: 'Routing modes (3-up)',
      summary: 'brainstorm (parallel fanout) × heads-down (ordered responder walk) × focus (per-agent queue-to-digest). Same input behaves differently under each mode.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/routing-modes-3up-2026-05-19.md'
    },
    {
      slug: 'terminal-lifecycle-2026-05-19',
      title: 'Terminal lifecycle',
      summary: 'spawn → active → break (Kill modal) → tombstone (archive | delete). Covers the per-terminal disposition picker + the Kill modal default-action contract.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/terminal-lifecycle-2026-05-19.md'
    },
    {
      slug: 'ask-flow-2026-05-19',
      title: 'Asks workflow lifecycle',
      summary: 'candidate → open → picked_up → answered / dismissed (auto-revert TTL on pickup). Premium overlay: combined-from-N · deduped-from-M · summarised-N-sub-questions multi-source intelligence layer.',
      tier: 'premium-overlay',
      sourcePath: 'ObsidiANT/audits/visuals/ask-flow-2026-05-19.md'
    },
    {
      slug: 'decision-trees-triptych-2026-05-19',
      title: 'Decision trees triptych',
      summary: 'Three side-by-side trees for message-time choices: which-room · bracketed [@] vs bare @ · when to 🖐️ / 🤝 / 👐.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/decision-trees-triptych-2026-05-19.md'
    },
    {
      slug: 'mode-matrices-2026-05-19',
      title: 'Mode matrices',
      summary: 'Two grids: routing token × room mode, and focus state × inbox queue. Cell-by-cell what the server does for each combination.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/mode-matrices-2026-05-19.md'
    }
  ];

  function tierLabel(tier: Visual['tier']): string {
    return tier === 'oss' ? 'OSS' : 'OSS · premium overlay';
  }
</script>

<svelte:head>
  <title>ANT visuals · discover</title>
</svelte:head>

<SimplePageShell
  eyebrow="discover"
  title="ANT visuals"
  summary="State machines, decision trees, and mode matrices for every ANT primitive. Source SVGs live in ObsidiANT/audits/visuals/ — one source of truth, embedded here as the gallery."
>
  <nav class="discover-subnav" aria-label="Discover sections">
    <span class="subnav-label">Discover:</span>
    <a class="subnav-link" href="/discover">CLI verbs</a>
    <a class="subnav-link active" href="/discover/visuals" aria-current="page">Visuals</a>
    <a class="subnav-link" href="/discover/vocab">Vocab</a>
    <a class="subnav-link" href="/manual">Screens canvas</a>
  </nav>

  <p class="meta">
    Six diagrams, all theme-aware (each SVG carries its own light + dark
    fallback via <code>prefers-color-scheme</code>). Click a card to open
    the visual full-size.
  </p>

  <ul class="visuals-grid" aria-label="Visual gallery">
    {#each VISUALS as v (v.slug)}
      <li class="visual-card">
        <a class="visual-thumb" href={`/visuals/${v.slug}.svg`} target="_blank" rel="noopener" aria-label={`Open ${v.title} full size`}>
          <img src={`/visuals/${v.slug}.svg`} alt={v.title} loading="lazy" />
        </a>
        <div class="visual-meta">
          <div class="visual-row">
            <h2>{v.title}</h2>
            <span class="tier-tag" class:tier-premium={v.tier === 'premium-overlay'}>{tierLabel(v.tier)}</span>
          </div>
          <p class="summary">{v.summary}</p>
          <p class="source">
            Source: <code>{v.sourcePath}</code>
          </p>
        </div>
      </li>
    {/each}
  </ul>

  <p class="footer-note">
    Cross-reference: <a href="/discover">CLI verbs</a> · <a href="/manual">screens canvas</a> · <a href="/discover/vocab">vocabulary</a>.
    Together these form the four-pillar OSS documentation surface
    (verbs · screens · visuals · vocab).
  </p>
</SimplePageShell>

<style>
  .meta {
    margin: 0 0 1.25rem;
    color: var(--ink-soft);
    line-height: 1.5;
  }
  .meta code {
    background: var(--surface-card);
    padding: 0.05rem 0.35rem;
    border-radius: 0.3rem;
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.85em;
  }
  .visuals-grid {
    list-style: none;
    padding: 0;
    margin: 0;
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(min(28rem, 100%), 1fr));
    gap: 1.25rem;
  }
  .visual-card {
    display: flex;
    flex-direction: column;
    background: var(--surface-card);
    border: 1px solid var(--surface-edge);
    border-radius: 0.85rem;
    overflow: hidden;
  }
  .visual-thumb {
    display: block;
    background: var(--surface);
    aspect-ratio: 1.5;
    overflow: hidden;
    border-bottom: 1px solid var(--surface-edge);
  }
  .visual-thumb img {
    width: 100%;
    height: 100%;
    object-fit: contain;
    display: block;
    padding: 0.85rem;
  }
  .visual-meta {
    padding: 1rem 1.1rem 1.1rem;
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
  }
  .visual-row {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 0.85rem;
  }
  .visual-row h2 {
    margin: 0;
    font-size: 1rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .tier-tag {
    flex-shrink: 0;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    border: 1px solid var(--surface-edge);
    font-size: 0.68rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .tier-tag.tier-premium {
    color: var(--accent, #6b21a8);
    border-color: var(--accent, #6b21a8);
  }
  .summary {
    margin: 0;
    color: var(--ink-strong);
    line-height: 1.5;
    font-size: 0.92rem;
  }
  .source {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
  }
  .source code {
    font-family: ui-monospace, "SF Mono", Menlo, monospace;
    font-size: 0.88em;
  }
  .footer-note {
    margin: 2rem 0 0;
    padding: 0.85rem 1rem;
    background: var(--surface-card);
    border: 1px solid var(--surface-edge);
    border-radius: 0.65rem;
    color: var(--ink-soft);
    font-size: 0.85rem;
    line-height: 1.5;
  }
  .footer-note a {
    color: var(--accent, #6b21a8);
    font-weight: 700;
    text-decoration: none;
  }
  .footer-note a:hover { text-decoration: underline; }

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
