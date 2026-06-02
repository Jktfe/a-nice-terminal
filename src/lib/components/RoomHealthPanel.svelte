<!--
  RoomHealthPanel — read-only room-identity health surface (workstream C,
  plan room-identity-stage-full-delivery-2026-06-02).

  Polls GET /api/room-health every ~30s and renders a compact per-terminal
  list: GREEN when the identity invariant chain holds, AMBER/RED with the
  specific reason when a link is broken. Lets a human SEE drift (missing
  handle / no room / dangling linked room) before it becomes a 403.

  Read-only by construction: it only fetches the endpoint. Polling mirrors
  RoomCardActivity (single setInterval, no per-row EventSource) to stay
  under Chrome's per-origin socket cap.
-->
<script lang="ts">
  type BrokenReason = 'no-handle' | 'no-membership' | 'dangling-linked-room';

  type RoomHealthEntry = {
    name: string;
    handle: string | null;
    terminalId: string;
    hasHandle: boolean;
    isMember: boolean;
    linkedRoomLive: boolean;
    healthy: boolean;
    brokenReason: BrokenReason | null;
  };

  type RoomHealthSummary = { total: number; healthy: number; broken: number };

  type Props = {
    pollIntervalMs?: number;
  };

  let { pollIntervalMs = 30_000 }: Props = $props();

  let terminals = $state<RoomHealthEntry[]>([]);
  let summary = $state<RoomHealthSummary>({ total: 0, healthy: 0, broken: 0 });

  async function refresh() {
    try {
      const response = await fetch('/api/room-health');
      if (!response.ok) return;
      const body = (await response.json()) as {
        terminals: RoomHealthEntry[];
        summary: RoomHealthSummary;
      };
      terminals = body.terminals ?? [];
      summary = body.summary ?? { total: 0, healthy: 0, broken: 0 };
    } catch {
      /* soft-fail: panel is diagnostic, stays mounted on transient errors */
    }
  }

  $effect(() => {
    void refresh();
    const handle = setInterval(refresh, pollIntervalMs);
    return () => clearInterval(handle);
  });

  function reasonLabel(reason: BrokenReason | null): string {
    switch (reason) {
      case 'no-handle':
        return 'no handle on terminal record';
      case 'no-membership':
        return 'not a member of any room';
      case 'dangling-linked-room':
        return 'linked room is gone (archived/deleted)';
      default:
        return '';
    }
  }

  function shortHandle(name: string): string {
    return name.startsWith('@') ? name.slice(1) : name;
  }
</script>

<section class="room-health-panel" aria-label="Room identity health">
  <header class="rh-header">
    <h3 class="rh-title">Room identity health</h3>
    <span class="rh-summary" aria-label="Health summary">
      <span class="rh-count rh-ok">{summary.healthy} healthy</span>
      {#if summary.broken > 0}
        <span class="rh-count rh-broken">{summary.broken} broken</span>
      {/if}
      <span class="rh-count rh-total">/ {summary.total}</span>
    </span>
  </header>

  {#if terminals.length === 0}
    <p class="rh-empty">No live terminals.</p>
  {:else}
    <ul class="rh-list">
      {#each terminals as entry (entry.terminalId)}
        <li
          class={`rh-row ${entry.healthy ? 'rh-row-ok' : 'rh-row-broken'}`}
          title={entry.healthy ? 'healthy' : reasonLabel(entry.brokenReason)}
        >
          <span class="rh-dot" aria-hidden="true"></span>
          <span class="rh-name">{shortHandle(entry.name)}</span>
          {#if entry.healthy}
            <span class="rh-state rh-state-ok">healthy</span>
          {:else}
            <span class="rh-state rh-state-broken">{reasonLabel(entry.brokenReason)}</span>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .room-health-panel {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.65rem 0.8rem;
    border: 1px solid var(--surface-edge);
    border-radius: 0.6rem;
    background: var(--surface-card);
    font-size: 0.8rem;
    color: var(--ink-soft);
  }
  .rh-header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .rh-title {
    margin: 0;
    font-size: 0.82rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .rh-summary {
    display: inline-flex;
    align-items: baseline;
    gap: 0.4rem;
    font-weight: 700;
  }
  .rh-ok { color: #15803d; }
  .rh-broken { color: #b91c1c; }
  .rh-total { opacity: 0.6; }
  .rh-empty {
    margin: 0;
    opacity: 0.7;
  }
  .rh-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .rh-row {
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.18rem 0.4rem;
    border-radius: 0.4rem;
    background: var(--bg);
    border: 1px solid var(--surface-edge);
  }
  .rh-dot {
    flex: 0 0 auto;
    width: 0.5rem;
    height: 0.5rem;
    border-radius: 999px;
    background: #9ca3af;
  }
  .rh-row-ok .rh-dot { background: #16a34a; }
  .rh-row-broken {
    border-color: color-mix(in srgb, #dc2626 40%, var(--surface-edge));
    background: color-mix(in srgb, #dc2626 8%, var(--bg));
  }
  .rh-row-broken .rh-dot { background: #dc2626; }
  .rh-name {
    font-weight: 700;
    color: var(--ink-strong);
  }
  .rh-state { opacity: 0.85; }
  .rh-state-ok { color: #15803d; }
  .rh-state-broken { color: #b91c1c; font-weight: 700; }
</style>
