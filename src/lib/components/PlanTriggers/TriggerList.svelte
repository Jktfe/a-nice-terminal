<!--
  TriggerList — read-only table of existing PlanTriggers. Pure
  projection of the data passed in; emits no events. Each row exposes a
  "Copy remove cmd" + "Copy fire cmd" via the shared CopyButton.
-->
<script lang="ts">
  import CopyButton from '$lib/components/CopyButton.svelte';
  import type { PlanTrigger } from '$lib/server/planTriggerStore';
  import type { PlanRecord } from '$lib/server/planStore';

  type Props = {
    triggers: PlanTrigger[];
    planById: Record<string, PlanRecord>;
  };
  let { triggers, planById }: Props = $props();

  function fmtRelative(ms: number | null): string {
    if (ms == null) return 'never';
    const delta = Date.now() - ms;
    if (delta < 0) return 'just now';
    const s = Math.floor(delta / 1000);
    if (s < 60) return `${s}s ago`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
  }

  function scopeLabel(t: PlanTrigger): { kind: 'plan' | 'wildcard'; text: string; id?: string } {
    if (t.planId == null) return { kind: 'wildcard', text: 'wildcard' };
    const p = planById[t.planId];
    return { kind: 'plan', text: p?.title?.trim() || t.planId, id: t.planId };
  }

  function fireCmd(id: string): string { return `ant plan trigger fire ${id}`; }
  function removeCmd(id: string): string { return `ant plan trigger remove ${id}`; }
</script>

{#if triggers.length === 0}
  <p class="empty">No triggers defined yet. Use the builder below to create one.</p>
{:else}
  <div class="table-wrap">
    <table>
      <thead>
        <tr>
          <th>Event</th>
          <th>Action</th>
          <th>Scope</th>
          <th>Last fired</th>
          <th class="num">Fires</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>
        {#each triggers as t (t.id)}
          {@const sc = scopeLabel(t)}
          <tr>
            <td><code>{t.event}</code></td>
            <td><code>{t.action}</code></td>
            <td>
              {#if sc.kind === 'plan' && sc.id}
                <a href={`/plans/${sc.id}`}>{sc.text}</a>
              {:else}
                <span class="muted">wildcard</span>
              {/if}
            </td>
            <td class="muted">{fmtRelative(t.lastFiredAtMs)}</td>
            <td class="num">{t.fireCount}</td>
            <td class="actions">
              <CopyButton text={removeCmd(t.id)} label="Remove cmd" title={`Copy: ${removeCmd(t.id)}`} />
              <CopyButton text={fireCmd(t.id)} label="Fire cmd" title={`Copy: ${fireCmd(t.id)}`} />
            </td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}

<style>
  .empty {
    margin: 0; padding: 0.75rem 0.9rem;
    color: var(--ink-soft); border: 1px dashed var(--line-soft);
    border-radius: 0.6rem; font-size: 0.9rem;
  }
  .table-wrap { overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 0.86rem; color: var(--ink-strong); }
  th, td {
    padding: 0.5rem 0.65rem; border-bottom: 1px solid var(--line-soft);
    text-align: left; vertical-align: middle;
  }
  th {
    font-size: 0.74rem; color: var(--ink-soft);
    text-transform: uppercase; letter-spacing: 0.05em; font-weight: 800;
  }
  tbody tr:last-child td { border-bottom: none; }
  .num { text-align: right; font-variant-numeric: tabular-nums; }
  .muted { color: var(--ink-soft); }
  td a { color: var(--ink-strong); font-weight: 700; text-decoration: none; }
  td a:hover { color: var(--accent); }
  .actions { display: flex; gap: 0.35rem; flex-wrap: wrap; }
  code {
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.82rem;
  }
</style>
