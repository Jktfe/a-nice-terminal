<script lang="ts">
  // ANT — AgentTelemetryStrip
  // Read-only chip strip showing the new hook-driven telemetry fields:
  // permissionMode, remoteControlActive, session duration.
  //
  // Mounted inside TerminalContextStrip alongside the existing state/model/
  // ctx pills. Pure subscriber — no fetches, no actions.
  import type { AgentStatus } from '$lib/shared/agent-status';

  let { status }: { status: AgentStatus | null | undefined } = $props();

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

  const hasAny = $derived(!!(durationLabel || permissionLabel || remoteOn));
</script>

{#if hasAny}
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
</style>
