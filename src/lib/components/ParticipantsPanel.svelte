<!--
  ParticipantsPanel — list room members with attention-state dots and
  any room-scoped alias badges.
  Wireframe board WTHef state h01 (Claude lane, x=-6200 y=1800).

  Row click opens ParticipantDetailSheet for the picked member.
  Header carries the + Invite CTA. Per fe32 (viewer-token user), the
  invite button hides when canManageMembers is false.

  Attention-state dots default to "idle" (faint) until telemetry feeds
  the state in a later milestone. The dot grammar is wired so that
  future states render with the right colour without further changes.
-->
<script lang="ts">
  import { subscribeToRoomEvents } from '$lib/stores/realtimeRoom.svelte';
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import type { RoomAliasEntry } from '$lib/server/chatRoomAliasStore';
  import type { FocusEntry } from '$lib/server/focusModeStore';
  import MemberIcon from './MemberIcon.svelte';
  import AgentContextChip from './AgentContextChip.svelte';

  type AgentStatus = 'idle' | 'thinking' | 'working' | 'response-required' | 'unknown';
  type StatusEntry = {
    handle: string;
    status: AgentStatus;
    statusAtMs: number | null;
    // Optional context-window telemetry — JWPK msg_u7r6znc3ec "context % in pill".
    // Codex's agent-statuses feed populates these when available; chip hides
    // itself when both are null so the row stays the same shape pre-data.
    uptimeMs?: number | null;
    contextFill?: number | null;
    // Phase C2 of 0.1.13 — terminals.status surfaced by /agent-statuses.
    // 'archived' renders a muted treatment + a Reclaim button next to the
    // member name; null/undefined (no terminal bound) falls through to the
    // existing live treatment.
    lifecycleStatus?: 'live' | 'archived' | 'deleted' | null;
    // Open-ask dimension (additive, server fcbdcd2): CLI response-required OR
    // an open Ask targeted at the handle. Orthogonal to `status` — rendered as
    // a separate "needs you" badge, never folded into the activity dot.
    openAsk?: boolean;
  };

  type Props = {
    roomId?: string;
    members: RoomMember[];
    aliasesInRoom: RoomAliasEntry[];
    canManageMembers?: boolean;
    focusedMembers?: FocusEntry[];
    onMemberPicked?: (member: RoomMember) => void;
    onInviteRequested?: () => void;
  };

  let {
    roomId,
    members,
    aliasesInRoom,
    canManageMembers = true,
    focusedMembers = [],
    onMemberPicked,
    onInviteRequested
  }: Props = $props();

  function findAliasFor(globalHandle: string): string | undefined {
    return aliasesInRoom.find((entry) => entry.globalHandle === globalHandle)?.alias;
  }

  function isFocused(handle: string): boolean {
    return focusedMembers.some((entry) => entry.memberHandle === handle);
  }

  let statuses = $state<StatusEntry[]>([]);
  const statusByHandle = $derived(new Map(statuses.map((entry) => [entry.handle, entry])));

  async function refreshStatuses() {
    if (!roomId) return;
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/agent-statuses`);
      if (!response.ok) return;
      const body = (await response.json()) as { statuses: StatusEntry[] };
      statuses = body.statuses ?? [];
    } catch {
      /* participants still render; stale status falls back to idle */
    }
  }

  $effect(() => {
    if (!roomId) return;
    void refreshStatuses();
    const handle = setInterval(refreshStatuses, 30_000);
    return () => clearInterval(handle);
  });

  // #133 participants-follows-footer: mirror AgentStatusFooter's PATCH-B
  // pattern (reactive $effect on handle.eventCount) so the panel reacts
  // to the same SSE event burst at the same instant the footer does,
  // instead of lagging behind on a 750ms watcher poll.
  let sseHandle = $state<ReturnType<typeof subscribeToRoomEvents> | null>(null);
  let lastSeenEventCount = $state(0);
  $effect(() => {
    if (!roomId) return;
    const h = subscribeToRoomEvents(roomId);
    sseHandle = h;
    lastSeenEventCount = 0;
    return () => {
      h.close();
      sseHandle = null;
    };
  });
  $effect(() => {
    const count = sseHandle?.eventCount ?? 0;
    if (count <= lastSeenEventCount) return;
    lastSeenEventCount = count;
    const event = sseHandle?.lastEvent;
    if (!event) return;
    if (event.type === 'agent_activity' || event.type === 'message_added') {
      void refreshStatuses();
    }
  });

  function statusForMember(member: RoomMember): AgentStatus {
    return statusByHandle.get(member.handle)?.status ?? 'idle';
  }

  function labelForStatus(status: AgentStatus): string {
    if (status === 'response-required') return 'needs reply';
    if (status === 'unknown') return 'unknown';
    return status;
  }

  // Phase C2 (0.1.13) — flip an archived terminal back to live for this
  // room+handle pair. Server enforces caller identity + that the caller's
  // own pidChain resolves to a live terminal (re-pointing the membership
  // if the caller is on a freshly-rebuilt terminal). Best-effort UX: any
  // error refreshes the panel so the user sees the post-state truth.
</script>

<section class="participants-panel" aria-labelledby="participantsHeading">
  <header class="panel-header">
    <h2 id="participantsHeading">Participants ({members.length})</h2>
    {#if canManageMembers && onInviteRequested}
      <button type="button" class="invite-cta" onclick={onInviteRequested}>
        + Invite
      </button>
    {/if}
  </header>

  {#if members.length === 0}
    <p class="empty-state">No participants yet.</p>
  {:else}
    <ul class="member-rows" aria-live="polite">
      {#each members as member (member.handle)}
        {@const aliasForRow = findAliasFor(member.handle)}
        {@const memberStatus = statusForMember(member)}
        {@const statusForRow = statusByHandle.get(member.handle)}
        {@const isArchived = statusForRow?.lifecycleStatus === 'archived'}
        <li>
          <div
            class={`member-row member-status-${memberStatus}`}
            class:archived={isArchived}
            style:--member-color={member.displayColor}
            data-background-style={member.displayBackgroundStyle}
            data-member-handle={member.handle}
          >
            <button
              type="button"
              class="member-row-main"
              onclick={() => onMemberPicked?.(member)}
              aria-label={`Open detail for ${aliasForRow ?? member.handle}`}
            >
              <span class="member-icon" aria-hidden="true">
                <MemberIcon icon={member.displayIcon} fallbackText={member.displayName} size="sm" />
              </span>
              <span class="member-handle">{aliasForRow ?? member.displayName}</span>
              {#if aliasForRow}
                <span class="alias-badge">alias</span>
              {/if}
              <AgentContextChip
                uptimeMs={statusForRow?.uptimeMs ?? null}
                contextFill={statusForRow?.contextFill ?? null}
              />
              <span class="member-state">
                {#if isArchived}
                  <span class="archived-pill" aria-hidden="true">📦 archived</span>
                {:else if isFocused(member.handle)}
                  <span class="member-state-dot focus-dot" aria-hidden="true"></span>
                  <span class="focus-label">focused</span>
                {:else}
                  <span class="member-state-dot" aria-hidden="true"></span>
                  <span>{labelForStatus(memberStatus)}</span>
                {/if}
                {#if statusForRow?.openAsk}
                  <span class="needs-you-badge" title="Waiting on a response">needs you</span>
                {/if}
              </span>
            </button>
            <!--
              No "Reclaim" button here (removed JWPK 2026-06-15). Reclaim
              rebinds an archived membership to the CALLER's terminal, which
              needs a pidChain to resolve that terminal — the browser has none,
              so from the UI it could at most flip a dead terminal's status to
              'live' (a misleading no-op, not a real reclaim). The real path is
              `ant reclaim` from the CLI (sends a pidChain, hits the same gated
              server endpoint). So this surface had no usable user action.
            -->
          </div>
        </li>
      {/each}
    </ul>
  {/if}
</section>

<style>
  .participants-panel {
    padding: 1.1rem 1.3rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
  }
  .panel-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.75rem;
  }
  .panel-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .invite-cta {
    padding: 0.4rem 0.95rem;
    font-weight: 800;
    font-size: 0.85rem;
    color: white;
    background: var(--accent);
    border: none;
    border-radius: 999px;
    cursor: pointer;
  }
  .invite-cta:hover {
    filter: brightness(1.05);
  }
  .empty-state {
    margin: 0;
    color: var(--ink-soft);
  }
  .member-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .member-row {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 0.4rem;
    padding: 0.55rem 0.7rem;
    background: var(--bg);
    border: 1px solid transparent;
    border-left: 3px solid var(--member-color);
    border-radius: 0.55rem;
    text-align: left;
    color: var(--ink-strong);
    font: inherit;
  }
  .member-row.archived {
    opacity: 0.7;
    background: color-mix(in srgb, var(--ink-soft) 6%, var(--bg));
  }
  .member-row-main {
    flex: 1 1 auto;
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0;
    background: transparent;
    border: none;
    cursor: pointer;
    text-align: left;
    color: inherit;
    font: inherit;
  }
  .archived-pill {
    font-size: 0.72rem;
    font-weight: 700;
    color: var(--ink-soft);
    background: color-mix(in srgb, var(--ink-soft) 12%, transparent);
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }
  .needs-you-badge {
    font-size: 0.72rem;
    font-weight: 800;
    color: #b9770f;
    background: color-mix(in srgb, #f0a020 16%, transparent);
    border: 1px solid color-mix(in srgb, #f0a020 45%, transparent);
    padding: 0.05rem 0.4rem;
    border-radius: 999px;
    letter-spacing: 0.02em;
  }
  .member-row[data-background-style='transparent'] {
    background: transparent;
  }
  .member-row[data-background-style='tint'] {
    background: color-mix(in srgb, var(--member-color) 9%, var(--bg));
  }
  .member-row:hover,
  .member-row:focus-within {
    border-color: var(--accent);
    outline: none;
  }
  .member-row-main:focus-visible {
    outline: none;
  }
  .member-icon {
    flex: 0 0 auto;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.55rem;
    height: 1.55rem;
    border-radius: 0.45rem;
    background: var(--member-color);
    color: white;
    font-size: 0.82rem;
    font-weight: 900;
    line-height: 1;
    /* JWPK msg_dacswgrsg3: white is a valid colour option, so the avatar
       needs a hairline so it doesn't disappear on a light surface. Inset
       shadow rides under the white text without affecting the layout. */
    box-shadow: inset 0 0 0 1px var(--line-soft);
  }
  .member-handle {
    font-weight: 800;
    flex: 1 1 auto;
  }
  .alias-badge {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent);
    font-weight: 800;
  }
  .member-state {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    font-size: 0.78rem;
    color: var(--ink-soft);
  }
  .member-state-dot {
    width: 0.48rem;
    height: 0.48rem;
    border-radius: 999px;
    background: #9ca3af;
    opacity: 0.72;
  }
  .member-status-working .member-state-dot {
    background: #16a34a;
    opacity: 1;
    box-shadow: 0 0 0 2px color-mix(in srgb, #16a34a 30%, transparent);
  }
  .member-status-thinking .member-state-dot {
    background: #f59e0b;
    opacity: 1;
    box-shadow: 0 0 0 2px color-mix(in srgb, #f59e0b 30%, transparent);
  }
  .member-status-response-required .member-state-dot {
    background: #dc2626;
    opacity: 1;
    box-shadow: 0 0 0 2px color-mix(in srgb, #dc2626 30%, transparent);
  }
  .member-status-unknown .member-state-dot {
    opacity: 0.45;
  }
  .focus-dot {
    background: var(--accent);
    opacity: 1;
    box-shadow: 0 0 0 2px color-mix(in srgb, var(--accent) 18%, transparent);
  }
  .focus-label {
    color: var(--accent);
    font-weight: 800;
  }
</style>
