<script lang="ts">
  // ANT — AgentTelemetryStrip
  // Read-only chip strip showing the new hook-driven telemetry fields:
  // permissionMode, remoteControlActive, session duration, plus a
  // freshness dot signalling whether the per-CLI hook plugin is
  // actively writing ~/.ant/state/<cli>/<id>.json.
  //
  // Mounted inside TerminalContextStrip alongside the existing state/model/
  // ctx pills. Pure subscriber — no fetches, no actions.
  import type { AgentStatus } from '$lib/shared/agent-status';
  import { classifyStateFreshness } from '$lib/shared/state-freshness';

  let { status }: { status: AgentStatus | null | undefined } = $props();

  // Tick `now` while mounted so the freshness dot transitions
  // live → stale without parent input. 5s cadence is fine: the
  // 30s threshold gives plenty of headroom and the dot only re-derives
  // a single `<span>`.
  let now = $state(Date.now());
  $effect(() => {
    const handle = setInterval(() => { now = Date.now(); }, 5_000);
    return () => clearInterval(handle);
  });

  const durationLabel = $derived.by(() => {
    if (!status?.sessionDurationMs) return null;
    const sec = Math.floor(status.sessionDurationMs / 1000);
    if (sec < 60) return `${sec}s`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m`;
    const h = Math.floor(min / 60);
    return `${h}h`;
  });

  const permissionLabel = $derived.by(() => {
    if (!status?.permissionMode) return null;
    return status.permissionMode;
  });

  const remoteOn = $derived(!!status?.remoteControlActive);

  const freshness = $derived(classifyStateFreshness(status?.stateFileMtimeMs, now));

  const hasAny = $derived(
    !!(durationLabel || permissionLabel || remoteOn || freshness !== 'absent')
  );
</script>

{#if hasAny}
  {#if freshness !== 'absent'}
    <span
      class="ats__dot ats__dot--{freshness}"
      title={freshness === 'live' ? 'Hook telemetry live' : 'Hook telemetry stale'}
      aria-label={freshness === 'live' ? 'Hook telemetry live' : 'Hook telemetry stale'}
    ></span>
  {/if}
  {#if durationLabel}
    <span class="ats__pill" title="Session duration">⏱ {durationLabel}</span>
  {/if}
  {#if permissionLabel}
    <span class="ats__pill ats__pill--mode" title="Permission mode">⏵⏵ {permissionLabel}</span>
  {/if}
  {#if remoteOn}
    <span class="ats__pill ats__pill--rc" title="Remote control is active for this session">📡 Remote</span>
  {/if}
{/if}

<style>
  .ats__pill {
    font-family: var(--font-mono);
    font-size: 10.5px;
    color: var(--text-muted);
    background: var(--bg-soft);
    border: 0.5px solid var(--border-light);
    padding: 2px 6px;
    border-radius: 4px;
    letter-spacing: 0;
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .ats__pill--mode {
    color: color-mix(in srgb, var(--text-muted) 60%, var(--accent-amber, #d4a017));
  }

  .ats__pill--rc {
    color: color-mix(in srgb, var(--text-muted) 60%, var(--accent-blue, #2563eb));
  }

  .ats__dot {
    display: inline-block;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    margin: 0 4px 0 0;
    flex-shrink: 0;
    align-self: center;
  }

  .ats__dot--live {
    background: var(--accent-green, #22c55e);
    box-shadow: 0 0 4px color-mix(in srgb, var(--accent-green, #22c55e) 60%, transparent);
  }

  .ats__dot--stale {
    background: var(--text-muted);
    opacity: 0.45;
  }
</style>
