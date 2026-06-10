<!--
  TrackerTable — a live, collaborative audit table rendered inline in the
  message stream (JWPK msg_p28s81vbyz: "a table where we keep an audit of
  changes ... that we can all add to, update and view").

  Fourth inline widget on the fence-render rail (poll, status board, now
  tracker). MessageRow mounts it for an `ant-tracker` fence (trackerRefs); the
  fence carries only the id and this widget fetches the live table+rows+audit
  from the store — so collaborative edits + the durable change log work (a
  fence-body-data design couldn't be edited by others or survive an edit).

  Typed cells (column.type): currency right-aligns + £-formats, bool renders a
  ✓/✗ toggle, date formats, link is a clickable, text is plain. Any room
  member adds rows + edits cells in place; every change posts an audit
  chat-event server-side AND appears in the 🕓 history panel here.

  SSR-safe: an optional `initialTracker` renders server-side + in tests.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import type { TrackerView, TrackerColumn, TrackerRow } from '$lib/server/trackerStore';

  type Props = {
    trackerId: string;
    roomId: string;
    asHandle?: string;
    initialTracker?: TrackerView | null;
  };

  let { trackerId, roomId, asHandle, initialTracker = null }: Props = $props();

  let live = $state<TrackerView | null>(null);
  const view = $derived(live ?? initialTracker);
  let isLoading = $state(false);
  let errorText = $state('');
  let showHistory = $state(false);
  let savingCell = $state<string | null>(null);
  let addingRow = $state(false);
  let draft = $state<Record<string, string>>({});

  onMount(() => void refresh());

  async function refresh(): Promise<void> {
    if (!trackerId || !roomId) return;
    isLoading = true;
    errorText = '';
    try {
      const r = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/trackers/${encodeURIComponent(trackerId)}`
      );
      if (r.status === 401 || r.status === 403 || r.status === 404) return;
      if (!r.ok) throw new Error(`Could not load tracker (${r.status}).`);
      const body = (await r.json()) as { tracker?: TrackerView };
      if (body.tracker) live = body.tracker;
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not load tracker.';
    } finally {
      isLoading = false;
    }
  }

  async function setCell(row: TrackerRow, col: TrackerColumn, value: string): Promise<void> {
    if ((row.cells[col.key] ?? '') === value) return;
    savingCell = `${row.id}:${col.key}`;
    errorText = '';
    try {
      const r = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/trackers/${encodeURIComponent(trackerId)}/rows/${encodeURIComponent(row.id)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roomId, columnKey: col.key, value, asHandle })
        }
      );
      if (!r.ok) throw new Error(`Could not save (${r.status}).`);
      await refresh();
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not save cell.';
    } finally {
      savingCell = null;
    }
  }

  async function addRow(): Promise<void> {
    addingRow = true;
    errorText = '';
    try {
      const r = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/trackers/${encodeURIComponent(trackerId)}/rows`,
        {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ roomId, cells: draft, asHandle })
        }
      );
      if (!r.ok) throw new Error(`Could not add row (${r.status}).`);
      draft = {};
      await refresh();
    } catch (cause) {
      errorText = cause instanceof Error ? cause.message : 'Could not add row.';
    } finally {
      addingRow = false;
    }
  }

  function fmtCurrency(v: string): string {
    const n = Number(String(v).replace(/[^0-9.-]/g, ''));
    if (!Number.isFinite(n) || v.trim() === '') return v;
    return `£${n.toLocaleString('en-GB', { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
  }
  function fmtDate(v: string): string {
    if (!v.trim()) return '—';
    const d = new Date(v);
    if (Number.isNaN(d.getTime())) return v;
    return d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' });
  }
  function isTruthy(v: string): boolean {
    return ['true', 'y', 'yes', '1', '✓'].includes(v.trim().toLowerCase());
  }
  function toggleBool(row: TrackerRow, col: TrackerColumn): void {
    void setCell(row, col, isTruthy(row.cells[col.key] ?? '') ? 'false' : 'true');
  }

  function describeEvent(e: TrackerView['events'][number]): string {
    if (e.kind === 'row.add') return `${e.byHandle} added a row`;
    const label = view?.columns.find((c) => c.key === e.columnKey)?.label ?? e.columnKey;
    const from = (e.oldValue ?? '').trim() || '(empty)';
    const to = (e.newValue ?? '').trim() || '(empty)';
    return `${e.byHandle} · ${label}: ${from} → ${to}`;
  }

  const cellEvents = $derived(view?.events.filter((e) => e.kind === 'cell.set').length ?? 0);
</script>

{#if view}
  <section class="tracker" aria-label={`Tracker: ${view.title}`}>
    <header class="tracker-head">
      <div class="tracker-title-wrap">
        <span aria-hidden="true">📋</span>
        <h4 class="tracker-title">{view.title}</h4>
      </div>
      <div class="tracker-actions">
        <button type="button" class="tk-btn" onclick={refresh} disabled={isLoading}>{isLoading ? '…' : '↻'}</button>
        <button type="button" class="tk-btn" class:on={showHistory} onclick={() => (showHistory = !showHistory)}>
          🕓 history
        </button>
      </div>
    </header>

    <!-- svelte-ignore a11y_no_noninteractive_tabindex -->
    <!-- A keyboard-focusable scroll region (same pattern as renderMarkdown's
         chat-md-table-wrap) so the table scrolls horizontally without a mouse. -->
    <div class="tracker-scroll" role="region" tabindex="0" aria-label="Scrollable tracker table">
      <table class="tracker-grid">
        <thead>
          <tr>
            {#each view.columns as col (col.key)}
              <th data-type={col.type}>{col.label}</th>
            {/each}
          </tr>
        </thead>
        <tbody>
          {#each view.rows as row (row.id)}
            <tr>
              {#each view.columns as col (col.key)}
                {@const val = row.cells[col.key] ?? ''}
                <td data-type={col.type} class:saving={savingCell === `${row.id}:${col.key}`}>
                  {#if col.type === 'bool'}
                    <button type="button" class="tk-bool" class:yes={isTruthy(val)} onclick={() => toggleBool(row, col)} aria-label={`Toggle ${col.label}`}>
                      {isTruthy(val) ? '✓' : '✗'}
                    </button>
                  {:else if col.type === 'link'}
                    {#if val.trim()}<a class="tk-link" href={val} target="_blank" rel="noopener noreferrer">🔗 link</a>{:else}<span class="tk-empty">—</span>{/if}
                  {:else}
                    <input
                      class="tk-cell"
                      class:num={col.type === 'currency' || col.type === 'number'}
                      value={val}
                      placeholder="—"
                      onchange={(e) => setCell(row, col, (e.currentTarget as HTMLInputElement).value)}
                      title={col.type === 'currency' ? fmtCurrency(val) : col.type === 'date' ? fmtDate(val) : val}
                    />
                  {/if}
                </td>
              {/each}
            </tr>
          {/each}
          <tr class="tracker-addrow">
            {#each view.columns as col, i (col.key)}
              <td>
                {#if col.type !== 'bool' && col.type !== 'link'}
                  <input class="tk-cell tk-draft" bind:value={draft[col.key]} placeholder={i === 0 ? '+ add row…' : ''} />
                {:else}
                  <input class="tk-cell tk-draft" bind:value={draft[col.key]} placeholder={col.type === 'bool' ? 'y/n' : 'url'} />
                {/if}
              </td>
            {/each}
          </tr>
        </tbody>
      </table>
    </div>

    <footer class="tracker-foot">
      <button type="button" class="tk-add" onclick={addRow} disabled={addingRow}>
        {addingRow ? 'Adding…' : '+ row'}
      </button>
      <span class="tk-meta">{view.rows.length} rows · {cellEvents} edits</span>
    </footer>

    {#if showHistory}
      <div class="tracker-history">
        {#if view.events.length === 0}
          <p class="tk-empty">No changes yet.</p>
        {:else}
          <ol>
            {#each [...view.events].reverse() as e (e.seq)}
              <li>{describeEvent(e)}</li>
            {/each}
          </ol>
        {/if}
      </div>
    {/if}

    {#if errorText}<p class="tk-error" role="alert">{errorText}</p>{/if}
  </section>
{/if}

<style>
  .tracker {
    margin: 0.55rem 0 0.2rem;
    padding: 0.6rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-raised);
    max-width: 46rem;
  }
  .tracker-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .tracker-title-wrap { display: flex; align-items: center; gap: 0.4rem; min-width: 0; }
  .tracker-title {
    margin: 0; color: var(--ink-strong); font-size: 0.92rem; font-weight: 850;
    overflow-wrap: anywhere;
  }
  .tracker-actions { display: flex; gap: 0.3rem; flex: 0 0 auto; }
  .tk-btn {
    min-height: 1.6rem; padding: 0.15rem 0.5rem; border: 1px solid var(--line-soft);
    border-radius: 0.4rem; background: var(--surface-raised); color: var(--ink-strong);
    font-size: 0.72rem; font-weight: 800; cursor: pointer;
  }
  .tk-btn.on { background: color-mix(in srgb, #2563eb 12%, var(--surface-raised)); color: #1d4ed8; }
  .tracker-scroll { overflow-x: auto; border: 1px solid var(--line-soft); border-radius: 0.5rem; }
  .tracker-grid { border-collapse: collapse; width: 100%; font-size: 0.8rem; }
  .tracker-grid th, .tracker-grid td {
    border-bottom: 1px solid var(--line-soft); border-right: 1px solid var(--line-soft);
    padding: 0; text-align: left; vertical-align: middle;
  }
  .tracker-grid th {
    background: var(--bg); color: var(--ink-strong); font-weight: 850;
    padding: 0.35rem 0.5rem; white-space: nowrap;
  }
  .tracker-grid th[data-type='currency'], .tracker-grid th[data-type='number'] { text-align: right; }
  td.saving { background: color-mix(in srgb, #2563eb 8%, transparent); }
  .tk-cell {
    width: 100%; min-width: 6rem; box-sizing: border-box; border: 0; background: transparent;
    padding: 0.32rem 0.5rem; color: var(--ink-strong); font: inherit;
  }
  .tk-cell:focus { outline: 2px solid color-mix(in srgb, #2563eb 40%, transparent); outline-offset: -2px; }
  .tk-cell.num { text-align: right; font-variant-numeric: tabular-nums; }
  .tk-draft { color: var(--ink-soft); }
  .tk-bool {
    width: 100%; border: 0; background: transparent; cursor: pointer; padding: 0.3rem;
    font-size: 0.85rem; font-weight: 850; color: var(--danger, #b91c1c);
  }
  .tk-bool.yes { color: #15803d; }
  .tk-link { padding: 0.32rem 0.5rem; display: inline-block; color: #1d4ed8; font-size: 0.78rem; }
  .tk-empty { color: var(--ink-soft); padding: 0 0.5rem; }
  .tracker-foot {
    display: flex; align-items: center; gap: 0.6rem; margin-top: 0.5rem;
    color: var(--ink-soft); font-size: 0.74rem; font-weight: 700;
  }
  .tk-add {
    min-height: 1.6rem; padding: 0.2rem 0.7rem; border: 1px solid var(--line-soft);
    border-radius: 0.4rem; background: var(--surface-raised); color: var(--ink-strong);
    font-size: 0.74rem; font-weight: 800; cursor: pointer;
  }
  .tracker-history {
    margin-top: 0.5rem; padding: 0.4rem 0.6rem; border: 1px solid var(--line-soft);
    border-radius: 0.5rem; background: var(--bg); max-height: 12rem; overflow-y: auto;
  }
  .tracker-history ol { margin: 0; padding-left: 1.1rem; display: grid; gap: 0.2rem; }
  .tracker-history li { color: var(--ink-soft); font-size: 0.74rem; }
  .tk-error { margin: 0.4rem 0 0; color: var(--danger, #b91c1c); font-size: 0.78rem; }
  @media (max-width: 720px) { .tracker { max-width: 100%; } }
</style>
