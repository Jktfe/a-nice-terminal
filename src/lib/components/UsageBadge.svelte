<!--
  UsageBadge — small chip showing the matched open-usage provider's
  current session % for a single terminal. Renders nothing when
  agentKind doesn't map to any known provider OR when the daemon
  isn't reachable, so terminals without a provider mapping stay
  visually quiet.

  JWPK msg_300r0u8dlx + msg_b0rkudqz1g antV4 2026-05-28 (both pill
  strip + per-card badge).

  Parent passes the live UsagePayload (already-fetched at the page
  level so /terminals avoids N parallel fetches). The badge picks the
  matching provider via the loose agentKind→providerId map from
  $lib/usage/types.
-->
<script lang="ts">
  import {
    agentKindToProviderId,
    findSessionLine,
    type UsagePayload
  } from '$lib/usage/types';

  type Props = {
    /** ANT terminal agentKind (e.g. "claude", "codex-cli"). */
    agentKind: string | null | undefined;
    /** Live usage payload from the parent page's /api/usage poll. */
    usage: UsagePayload | null;
  };

  let { agentKind, usage }: Props = $props();

  const providerId = $derived(
    usage ? agentKindToProviderId(agentKind, usage.providers) : null
  );
  const matched = $derived(
    providerId && usage ? usage.providers.find((p) => p.providerId === providerId) : null
  );
  const sessionLine = $derived(matched ? findSessionLine(matched) : null);
</script>

{#if matched && sessionLine}
  <span
    class="usage-badge"
    class:usage-badge-warn={sessionLine.used >= 80}
    class:usage-badge-hot={sessionLine.used >= 95}
    title="{matched.displayName} session: {Math.round(sessionLine.used)}% (resets {sessionLine.resetsAt ?? 'next cycle'})"
  >
    <span class="usage-badge-name">{matched.displayName}</span>
    <span class="usage-badge-pct">{Math.round(sessionLine.used)}%</span>
  </span>
{/if}

<style>
  .usage-badge {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    padding: 0.1rem 0.4rem;
    font-size: 0.65rem;
    line-height: 1.1;
    background: rgb(244 244 245);
    border: 1px solid rgb(228 228 231);
    border-radius: 999px;
    color: rgb(82 82 91);
    font-variant-numeric: tabular-nums;
  }
  .usage-badge-name {
    font-weight: 500;
  }
  .usage-badge-pct {
    color: rgb(39 39 42);
  }
  .usage-badge-warn {
    background: rgb(254 252 232);
    border-color: rgb(254 240 138);
    color: rgb(133 77 14);
  }
  .usage-badge-warn .usage-badge-pct {
    color: rgb(133 77 14);
  }
  .usage-badge-hot {
    background: rgb(254 226 226);
    border-color: rgb(252 165 165);
    color: rgb(127 29 29);
  }
  .usage-badge-hot .usage-badge-pct {
    color: rgb(127 29 29);
  }
</style>
