<!--
  /sheets/[slug] — render a CSV as a scrollable HTML table.

  Read-only stopgap until Univer Sheets lands. Numeric cells right-aligned,
  header row sticky on vertical scroll. Cells with a £/$/% prefix render
  monospaced for column alignment.
-->
<script lang="ts">
  import SimplePageShell from '$lib/components/SimplePageShell.svelte';
  import type { PageData } from './$types';

  let { data }: { data: PageData } = $props();

  let shareNotice = $state('');

  function isNumeric(value: string): boolean {
    if (value.trim().length === 0) return false;
    // Strip £, $, ,, %, spaces — then check Number.parse
    const cleaned = value.replace(/[£$€,%\s]/g, '');
    if (cleaned.length === 0) return false;
    return Number.isFinite(Number(cleaned));
  }

  function cellClass(value: string): string {
    if (isNumeric(value)) return 'cell num';
    return 'cell';
  }

  async function copyShareLink(): Promise<void> {
    if (typeof navigator === 'undefined' || !navigator.clipboard) return;
    try {
      await navigator.clipboard.writeText(location.href);
      shareNotice = 'Link copied.';
      setTimeout(() => (shareNotice = ''), 2500);
    } catch { /* ignore */ }
  }
</script>

<svelte:head><title>{data.slug} | Sheet | ANT vNext</title></svelte:head>

<SimplePageShell
  eyebrow="Sheet (read-only)"
  title={data.slug.replace(/-/g, ' ').replace(/\b./g, (c) => c.toUpperCase())}
  summary={`${data.rowCount} ${data.rowCount === 1 ? 'row' : 'rows'} × ${data.colCount} ${data.colCount === 1 ? 'col' : 'cols'} · last modified ${data.modifiedAtMs ? new Date(data.modifiedAtMs).toLocaleString() : '—'} · CSV stopgap, Univer Sheets coming`}
>
  <div class="toolbar" role="toolbar" aria-label="Sheet controls">
    <a class="back" href="/policies">← Catalogue</a>
    <span class="spacer"></span>
    <button type="button" class="toolbar-btn" onclick={copyShareLink}>Copy share link</button>
  </div>

  {#if shareNotice}
    <p class="share-notice" role="status">{shareNotice}</p>
  {/if}

  {#if data.header.length === 0}
    <p class="empty">This sheet is empty.</p>
  {:else}
    <div class="sheet-scroll" role="region" aria-label="Sheet contents">
      <table class="sheet-table">
        <thead>
          <tr>
            <th class="row-num" scope="col" aria-label="Row number"></th>
            {#each data.header as col, i (`h:${i}`)}
              <th class={isNumeric(col) ? 'num' : ''} scope="col">{col}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each data.rows as row, rowIndex (`r:${rowIndex}`)}
            <tr>
              <th class="row-num" scope="row">{rowIndex + 1}</th>
              {#each data.header as _, colIndex (`c:${rowIndex}:${colIndex}`)}
                <td class={cellClass(row[colIndex] ?? '')}>{row[colIndex] ?? ''}</td>
              {/each}
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
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
  .empty { padding: 2rem; text-align: center; color: var(--ink-soft); }
  .sheet-scroll {
    overflow: auto;
    border: 1px solid var(--line-soft);
    border-radius: 0.85rem;
    background: var(--surface-card);
    max-height: 78vh;
  }
  .sheet-table {
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    font-size: 0.88rem;
    color: var(--ink-strong);
    font-variant-numeric: tabular-nums;
  }
  .sheet-table thead th {
    position: sticky;
    top: 0;
    background: var(--bg);
    border-bottom: 1px solid var(--line-soft);
    padding: 0.55rem 0.75rem;
    text-align: left;
    font-size: 0.78rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
    z-index: 1;
  }
  .sheet-table tbody td {
    padding: 0.5rem 0.75rem;
    border-bottom: 1px solid var(--line-soft);
    vertical-align: top;
  }
  .sheet-table tbody tr:hover td { background: color-mix(in srgb, var(--accent) 5%, transparent); }
  .row-num {
    position: sticky;
    left: 0;
    background: var(--bg);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.72rem;
    text-align: right;
    padding-right: 0.65rem !important;
    border-right: 1px solid var(--line-soft);
    user-select: none;
    z-index: 2;
  }
  thead .row-num { z-index: 3; }
  .num { text-align: right; font-family: 'JetBrains Mono', monospace; }
</style>
