<!--
  AgentContextChip — inline context-% + uptime display for an agent pill.

  Renders inside existing agent pills (AgentStatusFooter status-chip,
  ParticipantsPanel member-row, MessageRow byline) so the live agent
  telemetry sits beside the handle the reader is already looking at.

  Per JWPK msg_s6b6lzqzsv ("ridiculously cool — nearly 14 days of running
  and you are still cooking on gas") + msg_u7r6znc3ec ("in pill") — this
  is the OSS-tier signature feature for the orchestration story. Visible
  per-agent state = screenshot-able value.

  Display format: `14d · 47%` — uptime then context-window fill. Both
  fields are optional; the chip renders gracefully without them (empty
  span, no whitespace) until codex's agent-statuses feed exposes the
  fields. That way this component ships behind a feature flag of "data
  arrives or it doesn't" rather than a server-coupled toggle.
-->
<script lang="ts">
  type Props = {
    /** Milliseconds since the agent terminal first registered. Optional —
     *  hidden if null/undefined. */
    uptimeMs?: number | null;
    /** Fraction 0..1 of the agent context window currently in use. Optional
     *  — hidden if null/undefined. */
    contextFill?: number | null;
    /** Compact mode shrinks copy + tightens spacing for inline use inside
     *  small pills (e.g. AgentStatusFooter). Default false. */
    compact?: boolean;
  };

  let { uptimeMs = null, contextFill = null, compact = false }: Props = $props();

  function humanUptime(ms: number): string {
    if (!Number.isFinite(ms) || ms < 0) return '';
    const minutes = Math.floor(ms / 60_000);
    if (minutes < 1) return '<1m';
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h`;
    const days = Math.floor(hours / 24);
    return `${days}d`;
  }

  function pctLabel(fill: number): string {
    const pct = Math.round(Math.min(Math.max(fill, 0), 1) * 100);
    return `${pct}%`;
  }

  const uptimeText = $derived(uptimeMs !== null && uptimeMs !== undefined ? humanUptime(uptimeMs) : '');
  const fillText = $derived(contextFill !== null && contextFill !== undefined ? pctLabel(contextFill) : '');
  // Visual fill-state buckets — green up to 60%, amber 60-85%, red 85+%.
  // Reader can spot a near-compaction agent without reading the digits.
  const fillBucket = $derived.by<'green' | 'amber' | 'red' | null>(() => {
    if (contextFill === null || contextFill === undefined) return null;
    if (contextFill >= 0.85) return 'red';
    if (contextFill >= 0.6) return 'amber';
    return 'green';
  });

  const hasAny = $derived(uptimeText !== '' || fillText !== '');
</script>

{#if hasAny}
  <span class="context-chip" class:compact title={`uptime ${uptimeText || '—'}, context ${fillText || '—'}`}>
    {#if uptimeText !== ''}
      <span class="uptime">{uptimeText}</span>
    {/if}
    {#if uptimeText !== '' && fillText !== ''}
      <span class="sep" aria-hidden="true">·</span>
    {/if}
    {#if fillText !== ''}
      <span class={`fill fill-${fillBucket}`}>{fillText}</span>
    {/if}
  </span>
{/if}

<style>
  .context-chip {
    display: inline-flex;
    align-items: baseline;
    gap: 0.22rem;
    margin-left: 0.3rem;
    padding: 0 0.35rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 600;
    line-height: 1.4;
    white-space: nowrap;
  }
  .context-chip.compact {
    margin-left: 0.2rem;
    padding: 0 0.3rem;
    font-size: 0.65rem;
    border-radius: 0.4rem;
  }
  .uptime {
    color: var(--ink-strong);
  }
  .sep {
    opacity: 0.45;
  }
  .fill {
    font-weight: 700;
  }
  .fill-green  { color: #15803d; }
  .fill-amber  { color: #b45309; }
  .fill-red    { color: #b91c1c; }
</style>
