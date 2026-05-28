<!--
  UsageStrip — top-of-/terminals pill row showing each open-usage
  provider's session %, weekly %, today $, and a 14-point sparkline of
  session % from usage_snapshots history. JWPK msg_300r0u8dlx +
  msg_4rbn05cztw + msg_m1bwd2rcv1 antV4 2026-05-28.

  Daemon-down state (msg_m1bwd2rcv1): when /api/usage returns
  daemonReachable:false AND no providers, we render a single
  explanatory line rather than silently hiding so users discover the
  open-usage requirement.

  Pulls /api/usage every 30 s (matches proxy cache TTL — anything more
  frequent just round-trips the cache) and /api/usage/history once at
  mount + on user-visible re-mount.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import {
    findSessionLine,
    findTodayLine,
    type UsagePayload,
    type UsageProvider
  } from '$lib/usage/types';

  type UsageHistoryResponse = {
    snapshots: Array<{
      id: string;
      capturedAtMs: number;
      payload: UsagePayload;
    }>;
  };

  let payload = $state<UsagePayload | null>(null);
  let history = $state<UsageHistoryResponse['snapshots']>([]);
  let pollHandle: ReturnType<typeof setInterval> | null = null;
  let lastFetchError = $state(false);

  async function refresh(): Promise<void> {
    try {
      const response = await fetch('/api/usage', { headers: { accept: 'application/json' } });
      if (!response.ok) {
        lastFetchError = true;
        return;
      }
      payload = (await response.json()) as UsagePayload;
      lastFetchError = false;
    } catch {
      lastFetchError = true;
    }
  }

  async function loadHistory(): Promise<void> {
    try {
      const response = await fetch('/api/usage/history?limit=28', {
        headers: { accept: 'application/json' }
      });
      if (!response.ok) return;
      const body = (await response.json()) as UsageHistoryResponse;
      history = body.snapshots;
    } catch {
      // Trend is optional; silent fail is fine for the strip.
    }
  }

  onMount(() => {
    void refresh();
    void loadHistory();
    pollHandle = setInterval(() => void refresh(), 30_000);
  });

  onDestroy(() => {
    if (pollHandle !== null) clearInterval(pollHandle);
  });

  // Build a per-provider sparkline series (oldest → newest) from the
  // session line in each snapshot. Returns an empty array when the
  // provider had no session line at any point — caller hides the
  // sparkline rather than rendering an empty SVG.
  function sparklineFor(providerId: string): number[] {
    const series: number[] = [];
    for (let i = history.length - 1; i >= 0; i -= 1) {
      const snap = history[i];
      const provider = snap.payload.providers.find((p) => p.providerId === providerId);
      if (!provider) continue;
      const sessionLine = findSessionLine(provider);
      if (!sessionLine) continue;
      series.push(sessionLine.used);
    }
    return series;
  }

  function sparklinePath(series: number[], width: number, height: number): string {
    if (series.length < 2) return '';
    const max = 100;
    const stepX = width / (series.length - 1);
    const points = series.map((value, index) => {
      const x = index * stepX;
      const y = height - (Math.min(value, max) / max) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    });
    return `M${points.join(' L')}`;
  }

  function sessionPctText(provider: UsageProvider): string | null {
    const line = findSessionLine(provider);
    if (!line) return null;
    return `${Math.round(line.used)}%`;
  }

  function todayValueText(provider: UsageProvider): string | null {
    const line = findTodayLine(provider);
    if (!line) return null;
    return line.value;
  }
</script>

{#if payload === null}
  <div class="usage-strip-skeleton" aria-hidden="true"></div>
{:else if !payload.daemonReachable && payload.providers.length === 0}
  <div class="usage-strip usage-strip-empty" role="status">
    <span class="usage-strip-empty-dot" aria-hidden="true"></span>
    <span class="usage-strip-empty-text">
      Open-usage daemon not detected at <code>127.0.0.1:6736</code> — required for per-provider
      session quotas + spend trends here. Install at
      <a href="https://www.openusage.ai/" target="_blank" rel="noopener noreferrer">openusage.ai</a>.
    </span>
  </div>
{:else}
  <div class="usage-strip" role="group" aria-label="Per-provider usage">
    {#each payload.providers as provider (provider.providerId)}
      {@const sparkline = sparklineFor(provider.providerId)}
      <div class="usage-pill" data-provider={provider.providerId}>
        <div class="usage-pill-head">
          <span class="usage-pill-name">{provider.displayName}</span>
          {#if provider.plan}
            <span class="usage-pill-plan">{provider.plan}</span>
          {/if}
        </div>
        <div class="usage-pill-body">
          {#if sessionPctText(provider)}
            {@const line = findSessionLine(provider)}
            <div class="usage-pill-session" title={line ? `Session resets ${line.resetsAt ?? 'on next cycle'}` : ''}>
              <div class="usage-pill-session-bar">
                <div
                  class="usage-pill-session-fill"
                  style:width="{Math.min(line?.used ?? 0, 100)}%"
                ></div>
              </div>
              <span class="usage-pill-session-pct">{sessionPctText(provider)}</span>
            </div>
          {/if}
          {#if todayValueText(provider)}
            <span class="usage-pill-today">{todayValueText(provider)}</span>
          {/if}
        </div>
        {#if sparkline.length >= 2}
          <svg
            class="usage-pill-spark"
            viewBox="0 0 60 14"
            preserveAspectRatio="none"
            aria-label="Session usage trend"
          >
            <path d={sparklinePath(sparkline, 60, 14)} fill="none" stroke="currentColor" stroke-width="1" />
          </svg>
        {/if}
      </div>
    {/each}
    {#if !payload.daemonReachable}
      <div class="usage-strip-stale" title="Showing cached values; daemon at :6736 is not responding right now">
        cache
      </div>
    {/if}
  </div>
{/if}

<style>
  .usage-strip {
    display: flex;
    gap: 0.5rem;
    padding: 0.5rem 0.75rem;
    margin: 0 0 0.75rem 0;
    background: rgb(244 244 245);
    border: 1px solid rgb(228 228 231);
    border-radius: 0.625rem;
    overflow-x: auto;
    align-items: center;
    font-size: 0.75rem;
    line-height: 1.1;
  }
  .usage-strip-skeleton {
    height: 3rem;
    margin: 0 0 0.75rem 0;
    background: rgb(244 244 245);
    border-radius: 0.625rem;
  }
  .usage-strip-empty {
    color: rgb(82 82 91);
    padding: 0.5rem 0.75rem;
  }
  .usage-strip-empty-dot {
    display: inline-block;
    width: 0.5rem;
    height: 0.5rem;
    background: rgb(161 161 170);
    border-radius: 999px;
    margin-right: 0.5rem;
    vertical-align: middle;
  }
  .usage-strip-empty-text code {
    background: rgb(228 228 231);
    padding: 0 0.25rem;
    border-radius: 0.25rem;
    font-size: 0.7rem;
  }
  .usage-strip-empty-text a {
    color: rgb(59 130 246);
    text-decoration: underline;
  }
  .usage-strip-empty-text a:hover {
    color: rgb(37 99 235);
  }
  .usage-pill {
    flex: 0 0 auto;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
    padding: 0.4rem 0.6rem;
    background: white;
    border: 1px solid rgb(228 228 231);
    border-radius: 0.5rem;
    min-width: 9rem;
  }
  .usage-pill-head {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 0.4rem;
  }
  .usage-pill-name {
    font-weight: 600;
  }
  .usage-pill-plan {
    color: rgb(113 113 122);
    font-size: 0.65rem;
  }
  .usage-pill-body {
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .usage-pill-session {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .usage-pill-session-bar {
    flex: 1;
    height: 4px;
    background: rgb(228 228 231);
    border-radius: 999px;
    overflow: hidden;
  }
  .usage-pill-session-fill {
    height: 100%;
    background: rgb(59 130 246);
  }
  .usage-pill-session-pct {
    color: rgb(82 82 91);
    font-variant-numeric: tabular-nums;
  }
  .usage-pill-today {
    color: rgb(82 82 91);
    font-variant-numeric: tabular-nums;
  }
  .usage-pill-spark {
    width: 100%;
    height: 14px;
    color: rgb(59 130 246);
    opacity: 0.7;
  }
  .usage-strip-stale {
    margin-left: auto;
    color: rgb(113 113 122);
    font-size: 0.65rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }
</style>
