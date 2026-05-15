<!--
  /ant — visible programme board. The live surface James watches.
  Data: src/lib/server/programmeBoardData.ts (vendored from fresh-ant).
  PROGRAMME.md (in fresh-ant docs) remains canonical.
-->
<script lang="ts">
  import type { ProgrammeBoardSnapshot } from '$lib/server/programmeBoardData';

  type Props = {
    data: { snapshot: ProgrammeBoardSnapshot };
  };

  let { data }: Props = $props();

  const snapshot = $derived(data.snapshot);

  function cellSlug(cell: string): string {
    return cell.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }

  function statusSlug(status: string): string {
    return status.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  }
</script>

<svelte:head>
  <title>ANT · Programme</title>
</svelte:head>

<main class="programme-page">
  <header class="programme-head">
    <p class="eyebrow">Programme</p>
    <h1>The board.</h1>
    <p class="summary">
      Live snapshot of what the team is shipping, what is in review, what is deferred, and what is out of scope.
      Updated by hand per slice baseline.
    </p>
  </header>

  <section class="programme-board" aria-labelledby="programmeBoardHeading">
    <h2 id="programmeBoardHeading" class="sr-only">Programme board snapshot</h2>

    <p class="locked-scope" role="note">{snapshot.lockedScopeSentence}</p>
    <p class="snapshot-meta">Snapshot updated {snapshot.lastUpdatedIso} · Source: docs/PROGRAMME.md (canonical, fresh-ant repo)</p>

    <section aria-labelledby="acceptedBaselinesHeading">
      <h3 id="acceptedBaselinesHeading">Accepted Baselines</h3>
      <table class="programme-table">
        <thead>
          <tr><th scope="col">Lane</th><th scope="col">Slice</th><th scope="col">Owner</th></tr>
        </thead>
        <tbody>
          {#each snapshot.acceptedBaselines as row}
            <tr>
              <th scope="row">{row.lane}</th>
              <td>{row.slice}</td>
              <td><span class="owner-pill">{row.owner}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section aria-labelledby="inFlightHeading">
      <h3 id="inFlightHeading">In-flight (Review-Ready / Review-Held / Claim-Ready)</h3>
      <table class="programme-table">
        <thead>
          <tr><th scope="col">Lane</th><th scope="col">Slice</th><th scope="col">Status</th><th scope="col">Owner</th></tr>
        </thead>
        <tbody>
          {#each snapshot.inFlightSlices as row}
            <tr>
              <th scope="row">{row.lane}</th>
              <td>{row.slice}</td>
              <td><span class={`status-pill status-${statusSlug(row.status)}`}>{row.status}</span></td>
              <td><span class="owner-pill">{row.owner}</span></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section aria-labelledby="deferredHeading">
      <h3 id="deferredHeading">Deferred</h3>
      <table class="programme-table">
        <thead>
          <tr><th scope="col">Lane</th><th scope="col">Reason</th><th scope="col">Future tag</th></tr>
        </thead>
        <tbody>
          {#each snapshot.deferred as row}
            <tr>
              <th scope="row">{row.lane}</th>
              <td>{row.reason}</td>
              <td><code>{row.futureTag}</code></td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section aria-labelledby="outOfScopeHeading">
      <h3 id="outOfScopeHeading">Out-of-Scope (by directive)</h3>
      <table class="programme-table">
        <thead>
          <tr><th scope="col">Lane</th><th scope="col">Directive</th><th scope="col">Date</th></tr>
        </thead>
        <tbody>
          {#each snapshot.outOfScope as row}
            <tr>
              <th scope="row">{row.lane}</th>
              <td>{row.directive}</td>
              <td>{row.dateIso}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section aria-labelledby="laneMatrixHeading">
      <h3 id="laneMatrixHeading">Lane Matrix</h3>
      <p class="matrix-note">Cells: Accepted / Review-Held / Not started / Out of scope / — (n/a).</p>
      <table class="programme-table lane-matrix">
        <thead>
          <tr>
            <th scope="col">Lane</th>
            <th scope="col">s1</th>
            <th scope="col">s2</th>
            <th scope="col">s3</th>
            <th scope="col">s4</th>
            <th scope="col">s5</th>
            <th scope="col">4.1</th>
            <th scope="col">Notes</th>
          </tr>
        </thead>
        <tbody>
          {#each snapshot.laneMatrix as row}
            <tr>
              <th scope="row">{row.lane}</th>
              {#each row.cells as cell}
                <td><span class={`cell-pill cell-${cellSlug(cell)}`}>{cell}</span></td>
              {/each}
              <td class="notes-cell">{row.notes}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </section>

    <section aria-labelledby="ownersHeading">
      <h3 id="ownersHeading">Owner / Agent reference</h3>
      <ul class="owner-list">
        {#each snapshot.owners as owner}
          <li><strong>{owner.agent}</strong> — {owner.role}</li>
        {/each}
      </ul>
    </section>
  </section>
</main>

<style>
  .programme-page {
    max-width: 1120px;
    margin: 0 auto;
    padding: 2rem 1.25rem 4rem;
    color: var(--ink, #0c1021);
  }
  .programme-head { margin-bottom: 1.25rem; }
  .eyebrow {
    margin: 0 0 0.35rem;
    font-size: 0.74rem;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--emerald-600, #17A14B);
    font-weight: 800;
  }
  h1 {
    margin: 0;
    font-size: 1.85rem;
    font-weight: 900;
    letter-spacing: -0.01em;
  }
  .summary {
    margin: 0.5rem 0 0;
    font-size: 0.92rem;
    line-height: 1.5;
    color: color-mix(in srgb, var(--ink, #0c1021) 70%, transparent);
    max-width: 64ch;
  }
  .sr-only {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .programme-board {
    display: flex;
    flex-direction: column;
    gap: 1.6rem;
    padding: 1.2rem 1.4rem;
    background: color-mix(in srgb, var(--blue-50, #EAF1FE) 65%, white);
    border: 1px solid color-mix(in srgb, var(--blue-100, #CFDFFD) 100%, transparent);
    border-radius: 1rem;
  }
  .locked-scope {
    margin: 0;
    padding: 0.85rem 1rem;
    background: white;
    border-left: 3px solid var(--emerald-500, #22C55E);
    border-radius: 0.55rem;
    font-style: italic;
    line-height: 1.45;
  }
  .snapshot-meta {
    margin: 0;
    font-size: 0.78rem;
    color: color-mix(in srgb, var(--ink, #0c1021) 55%, transparent);
  }
  h3 {
    margin: 0 0 0.6rem 0;
    font-size: 1.02rem;
    font-weight: 800;
  }
  .programme-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.86rem;
    background: white;
    border-radius: 0.5rem;
    overflow: hidden;
  }
  .programme-table th, .programme-table td {
    border-bottom: 1px solid color-mix(in srgb, var(--blue-100, #CFDFFD) 80%, transparent);
    padding: 0.55rem 0.7rem;
    text-align: left;
    vertical-align: top;
  }
  .programme-table thead th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: color-mix(in srgb, var(--ink, #0c1021) 55%, transparent);
    background: color-mix(in srgb, var(--blue-50, #EAF1FE) 90%, white);
    font-weight: 800;
  }
  .programme-table tbody th[scope="row"] { font-weight: 800; }
  .owner-pill, .status-pill, .cell-pill {
    display: inline-block;
    padding: 0.16rem 0.55rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 800;
    background: white;
    border: 1px solid color-mix(in srgb, var(--blue-100, #CFDFFD) 100%, transparent);
  }
  .status-pill.status-review-ready { background: color-mix(in srgb, var(--emerald-100, #C6F3CF) 80%, white); border-color: var(--emerald-300, #5ED273); }
  .status-pill.status-review-held { background: #FFE7C4; border-color: #F4A93F; }
  .status-pill.status-claim-ready { background: color-mix(in srgb, var(--blue-100, #CFDFFD) 90%, white); border-color: var(--blue-50, #EAF1FE); }
  .cell-pill.cell-accepted { background: color-mix(in srgb, var(--emerald-100, #C6F3CF) 70%, white); border-color: var(--emerald-300, #5ED273); }
  .cell-pill.cell-review-held { background: #FFE7C4; border-color: #F4A93F; }
  .cell-pill.cell-out-of-scope { background: #FDE2E2; border-color: #E07A7A; }
  .matrix-note {
    margin: 0 0 0.55rem;
    font-size: 0.78rem;
    color: color-mix(in srgb, var(--ink, #0c1021) 55%, transparent);
  }
  .notes-cell {
    color: color-mix(in srgb, var(--ink, #0c1021) 60%, transparent);
    font-size: 0.78rem;
  }
  code {
    font-size: 0.78rem;
    padding: 0.1rem 0.4rem;
    background: color-mix(in srgb, var(--blue-50, #EAF1FE) 70%, white);
    border-radius: 0.3rem;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
  }
  .owner-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    background: white;
    padding: 0.85rem 1rem;
    border-radius: 0.5rem;
  }
  .owner-list strong { font-weight: 800; }
</style>
