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
    /** Optional callout describing how the live system has moved on
     *  from the May-19 SVG. Rendered as a small notice on the card. */
    staleNote?: string;
  };

  // Each diagram carries a `staleNote` when the May-19 SVG predates a
  // model change shipped since. The SVG itself stays as the May-19
  // baseline (regenerating is a design pass) — the note surfaces the
  // delta + points readers at the canonical Obsidian source for the
  // current state.
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
      sourcePath: 'ObsidiANT/audits/visuals/ask-flow-2026-05-19.md',
      staleNote: 'Diagram is the May-19 baseline. Model has since gained: `target_handle` (humans only), `merged` status (non-terminal), AskerNotInInboxError boundary, per-human inbox-room auth + broadcast, fanout auto-opens an ask on every @-mention of a human, and `ant ask` CLI verbs.'
    },
    {
      slug: 'decision-trees-triptych-2026-05-19',
      title: 'Decision trees triptych',
      summary: 'Three side-by-side trees for message-time choices: which-room · bracketed [@] vs bare @ · when to 🖐️ / 🤝 / 👐.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/decision-trees-triptych-2026-05-19.md',
      staleNote: 'The bare-@ branch no longer just routes the message — bare-@-mentioning a HUMAN now auto-opens an ask. The other two trees are still accurate.'
    },
    {
      slug: 'mode-matrices-2026-05-19',
      title: 'Mode matrices',
      summary: 'Two grids: routing token × room mode, and focus state × inbox queue. Cell-by-cell what the server does for each combination.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/mode-matrices-2026-05-19.md',
      staleNote: 'Agent-status cascade inverted to `hook PRIMARY > fingerprint > default`; ASK_PATTERN regex removed; response-required is now derived from open asks (humans only), not from fingerprint output.'
    },
    {
      slug: 'auth-fallback-2026-05-19',
      title: 'Auth fallback',
      summary: 'Identity-gate cascade: admin-bearer → local-antchat-bearer → accounts-bearer → browser-session → pidChain → 401. What each surface accepts and why each fallback exists.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/auth-fallback-2026-05-19.svg',
      staleNote: 'No-roomId mode now also accepts pidChain via inbox-membership resolution (asks-as-pill, 2026-05-22). The per-room cascade is unchanged.'
    },
    {
      slug: 'scoop-install-flow-2026-05-19',
      title: 'Scoop install flow',
      summary: 'Windows installer scoop manifest pipeline: GitHub Release artefact → scoop bucket JSON → `scoop install ant` → user PATH. Cross-platform install parity track.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/scoop-install-flow-2026-05-19.svg'
    },
    {
      slug: 'tauri-server-bridge-2026-05-19',
      title: 'Tauri server bridge',
      summary: 'How the Tauri shell talks to the local ANT server: IPC commands → bridge process → loopback HTTP. Native-shell-over-web pattern for the desktop binary.',
      tier: 'oss',
      sourcePath: 'ObsidiANT/audits/visuals/tauri-server-bridge-2026-05-19.svg'
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
    {VISUALS.length} diagrams, all theme-aware (each SVG carries its own
    light + dark fallback via <code>prefers-color-scheme</code>). Click a
    card to open the visual full-size. Diagrams marked with a yellow note
    have moved on since the May-19 baseline — the note describes the
    delta; the canonical source markdown holds the latest state.
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
          {#if v.staleNote}
            <p class="stale-note" role="note"><strong>Since baseline:</strong> {v.staleNote}</p>
          {/if}
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
  .stale-note {
    margin: 0;
    padding: 0.5rem 0.7rem;
    background: color-mix(in srgb, #d97706 12%, var(--surface-card));
    border-left: 3px solid #d97706;
    border-radius: 0.35rem;
    color: var(--ink-strong);
    font-size: 0.82rem;
    line-height: 1.45;
  }
  .stale-note strong {
    color: #d97706;
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
