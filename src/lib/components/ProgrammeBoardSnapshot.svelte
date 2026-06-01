<!--
  ProgrammeBoardSnapshot — renders the programme board snapshot.
  Companion render for the /plan route. Pure render: takes a typed snapshot
  prop and renders strict-labelled sections so James can watch the team
  from another screen.

  Mirrors the structure of docs/PROGRAMME-BOARD.md. PROGRAMME.md remains
  canonical; this is the visible companion.
-->
<script lang="ts">
  import type {
    ProgrammeBoardSnapshot
  } from '$lib/server/programmeBoardData';

  type Props = {
    snapshot: ProgrammeBoardSnapshot;
  };

  let { snapshot }: Props = $props();
</script>

<section class="programme-board" aria-labelledby="programmeBoardHeading">
  <h2 id="programmeBoardHeading" class="visually-hidden">Programme board snapshot</h2>

  <p class="locked-scope" role="note">{snapshot.lockedScopeSentence}</p>
  <p class="snapshot-meta">Snapshot updated {snapshot.lastUpdatedIso} · Source: docs/PROGRAMME.md (canonical)</p>

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
            <td><span class={`status-pill status-${row.status.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{row.status}</span></td>
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
              <td><span class={`cell-pill cell-${cell.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{cell}</span></td>
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

<style>
  .programme-board {
    display: flex;
    flex-direction: column;
    gap: 1.5rem;
    padding: 1.1rem 1.3rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }
  .visually-hidden {
    position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px;
    overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;
  }
  .locked-scope {
    margin: 0;
    padding: 0.85rem 1rem;
    background: var(--bg);
    border-left: 3px solid var(--accent);
    border-radius: 0.55rem;
    font-style: italic;
    color: var(--ink-strong);
    line-height: 1.45;
  }
  .snapshot-meta {
    margin: 0;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  h3 {
    margin: 0 0 0.6rem 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .programme-table {
    width: 100%;
    border-collapse: collapse;
    font-size: 0.85rem;
  }
  .programme-table th, .programme-table td {
    border-bottom: 1px solid var(--surface-edge);
    padding: 0.5rem 0.6rem;
    text-align: left;
    vertical-align: top;
  }
  .programme-table thead th {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 800;
  }
  .programme-table tbody th[scope="row"] {
    font-weight: 800;
    color: var(--ink-strong);
  }
  .owner-pill, .status-pill, .cell-pill {
    display: inline-block;
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    font-size: 0.72rem;
    font-weight: 800;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
  }
  .status-pill.status-review-ready { background: rgba(0, 180, 90, 0.12); border-color: rgba(0, 180, 90, 0.45); }
  .status-pill.status-review-held { background: rgba(255, 165, 0, 0.18); border-color: rgba(255, 165, 0, 0.5); }
  .status-pill.status-claim-ready { background: rgba(80, 130, 255, 0.14); border-color: rgba(80, 130, 255, 0.45); }
  .cell-pill.cell-accepted { background: rgba(0, 180, 90, 0.15); border-color: rgba(0, 180, 90, 0.45); }
  .cell-pill.cell-review-held { background: rgba(255, 165, 0, 0.2); border-color: rgba(255, 165, 0, 0.55); }
  .cell-pill.cell-out-of-scope { background: rgba(201, 32, 32, 0.12); border-color: rgba(201, 32, 32, 0.4); }
  .cell-pill.cell-not-started { color: var(--ink-soft); }
  .cell-pill.cell- { opacity: 0.55; }
  .matrix-note {
    margin: 0 0 0.55rem;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .notes-cell {
    color: var(--ink-soft);
    font-size: 0.78rem;
  }
  code {
    font-size: 0.78rem;
    padding: 0.1rem 0.35rem;
    background: var(--bg);
    border-radius: 0.3rem;
  }
  .owner-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .owner-list strong {
    font-weight: 800;
    color: var(--ink-strong);
  }
</style>
