<!--
  RoomCardActivity — Task #120.

  Compact activity badge for a room card: polls the agent-status endpoint
  every `pollIntervalMs` and shows how many agents are currently working
  plus how recent the last activity was.

  NOTE: previously also opened a per-room EventSource for sub-second
  updates. The rooms-index renders one card per attached room (8+ in
  our environment) and every EventSource holds a persistent HTTP/1.1
  connection — Chrome caps these at ~6 per origin, so the 7th+ socket
  queued and starved SvelteKit's destination-page fetch. Clicking a
  card stalled with no URL change. Dashboard's 5 cards stayed under
  the cap so dashboard nav worked, which is what JWPK observed. We
  now lean on polling here; the live room view keeps its own SSE.
-->
<script lang="ts">
  type AgentStatus = 'idle' | 'thinking' | 'working' | 'response-required' | 'unknown';
  // `openAsk` (additive, shipped server-side in fcbdcd2) is the open-ask
  // dimension: CLI response-required OR an open Ask targeted at the handle.
  type StatusEntry = { handle: string; status: AgentStatus; statusAtMs: number | null; openAsk?: boolean };

  type Props = {
    roomId: string;
    pollIntervalMs?: number;
  };

  let { roomId, pollIntervalMs = 30_000 }: Props = $props();

  let statuses = $state<StatusEntry[]>([]);
  let lastActivityMs = $state<number | null>(null);

  // Activity and open-ask are orthogonal (per the agent-status model): an
  // agent can be working AND have an open ask, or idle AND have one. Count
  // them separately — never fold "needs you" into "working".
  const workingCount = $derived(
    statuses.filter((entry) => entry.status === 'working' || entry.status === 'thinking').length
  );
  const needsYouCount = $derived(
    statuses.filter((entry) => entry.openAsk === true).length
  );

  async function refreshFromServer() {
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/agent-statuses`);
      if (!response.ok) return;
      const body = (await response.json()) as { statuses: StatusEntry[] };
      statuses = body.statuses ?? [];
      lastActivityMs = statuses.reduce<number | null>((acc, entry) => {
        const at = entry.statusAtMs ?? 0;
        return at > (acc ?? 0) ? at : acc;
      }, null);
    } catch {
      /* soft-fail: badge is decorative, card still renders */
    }
  }

  $effect(() => {
    if (!roomId) return;
    void refreshFromServer();
    const handle = setInterval(refreshFromServer, pollIntervalMs);
    return () => clearInterval(handle);
  });

  function formatLastActivity(ms: number | null): string {
    if (!ms) return 'idle';
    const minutes = Math.max(0, Math.round((Date.now() - ms) / 60_000));
    if (minutes < 1) return 'now';
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    return `${hours}h ago`;
  }
</script>

<span class="room-card-activity" aria-label="Room activity">
  {#if workingCount > 0}
    <span class="activity-pulse" aria-hidden="true"></span>
    <span class="activity-count">{workingCount} working</span>
  {:else}
    <span class="activity-dot activity-idle" aria-hidden="true"></span>
    <span class="activity-count">{formatLastActivity(lastActivityMs)}</span>
  {/if}
  {#if needsYouCount > 0}
    <span class="needs-you" title="Agents waiting on a response">
      <span class="needs-you-dot" aria-hidden="true"></span>
      {needsYouCount} needs you
    </span>
  {/if}
</span>

<style>
  .room-card-activity {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
    font-size: 0.7rem;
    color: var(--ink-soft);
  }
  .activity-pulse {
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: #16a34a;
    animation: room-card-pulse 1.6s ease-in-out infinite;
  }
  .activity-dot {
    display: inline-block;
    width: 0.45rem;
    height: 0.45rem;
    border-radius: 50%;
    background: var(--ink-soft);
  }
  .activity-dot.activity-idle { background: #9ca3af; opacity: 0.7; }
  .activity-count { font-weight: 700; }
  .needs-you {
    display: inline-flex;
    align-items: center;
    gap: 0.25rem;
    margin-left: 0.35rem;
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    background: color-mix(in srgb, #f0a020 16%, transparent);
    border: 1px solid color-mix(in srgb, #f0a020 45%, transparent);
    color: #b9770f;
    font-weight: 800;
  }
  .needs-you-dot {
    display: inline-block;
    width: 0.4rem;
    height: 0.4rem;
    border-radius: 50%;
    background: #f0a020;
  }
  @keyframes room-card-pulse {
    0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, #16a34a 50%, transparent); }
    50% { box-shadow: 0 0 0 4px color-mix(in srgb, #16a34a 0%, transparent); }
  }
</style>
