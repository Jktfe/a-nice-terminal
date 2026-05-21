<!--
  ChairRow — one room's chair digest as a single row.
  Backs M29 chair session-tracker slice 1.

  Shows: room name, member count, message-by-kind counts, last-message
  summary, time since last activity, and a needs-attention flag if the
  chair flagged the room as wanting human eyes.
-->
<script lang="ts">
  import type { ChairRowDigest } from '$lib/server/chairStore';

  type Props = {
    digest: ChairRowDigest;
  };

  let { digest }: Props = $props();

  function describeTimeSince(isoTimestamp: string | null): string {
    if (!isoTimestamp) return 'no activity yet';
    const secondsAgo = Math.max(0, Math.round((Date.now() - new Date(isoTimestamp).getTime()) / 1000));
    if (secondsAgo < 60) return `${secondsAgo}s ago`;
    const minutesAgo = Math.round(secondsAgo / 60);
    if (minutesAgo < 60) return `${minutesAgo}m ago`;
    const hoursAgo = Math.round(minutesAgo / 60);
    return `${hoursAgo}h ago`;
  }
</script>

<article class="chair-row" class:needs-attention={digest.needsAttentionReason !== null}>
  <header>
    <a class="room-name-link" href={`/rooms/${digest.roomId}`}>
      <h3 class="room-name">{digest.roomName}</h3>
    </a>
    <span class="time-since">{describeTimeSince(digest.lastMessagePostedAt)}</span>
  </header>

  <p class="last-message-summary">
    {digest.lastMessageSummary ?? 'No messages yet.'}
  </p>

  <ul class="metric-chips" aria-label="Room metrics">
    <li><span class="chip-label">members</span><span class="chip-value">{digest.memberCount}</span></li>
    <li><span class="chip-label">human</span><span class="chip-value">{digest.messageCountHuman}</span></li>
    <li><span class="chip-label">agent</span><span class="chip-value">{digest.messageCountAgent}</span></li>
    <li><span class="chip-label">system</span><span class="chip-value">{digest.messageCountSystem}</span></li>
    {#if digest.openAsksCount > 0}
      <li>
        <a class="chip-link" href={`/asks?roomId=${encodeURIComponent(digest.roomId)}`}>
          <span class="chip-label">open asks</span>
          <span class="chip-value">{digest.openAsksCount}</span>
        </a>
      </li>
    {:else}
      <li><span class="chip-label">open asks</span><span class="chip-value">0</span></li>
    {/if}
  </ul>

  {#if digest.recentOpenAsks.length > 0}
    <!-- #77 Chair-mediated asks: surface the ask titles inline so the
         operator can scan what's outstanding before clicking through. -->
    <section class="chair-asks" aria-label="Recent open asks">
      <header class="chair-asks-head">
        <span class="chair-asks-label">Open asks</span>
        <a class="chair-asks-all" href={`/asks?roomId=${encodeURIComponent(digest.roomId)}`}>
          View all ({digest.openAsksCount}) →
        </a>
      </header>
      <ul class="chair-asks-list">
        {#each digest.recentOpenAsks as ask (ask.id)}
          <li class="chair-ask-row">
            <a class="chair-ask-link" href={`/asks?roomId=${encodeURIComponent(digest.roomId)}&askId=${encodeURIComponent(ask.id)}`}>
              <span class="chair-ask-title">{ask.title}</span>
              <span class="chair-ask-meta">{ask.openedByDisplayName} · {describeTimeSince(ask.openedAt)}</span>
            </a>
          </li>
        {/each}
      </ul>
    </section>
  {/if}

  {#if digest.llmGeneratedSummary}
    <p class="chair-summary" role="note">
      <span class="chair-label">Chair</span> {digest.llmGeneratedSummary}
    </p>
  {/if}

  {#if digest.needsAttentionReason}
    <p class="attention-reason" role="status">
      <span aria-hidden="true">⚠</span> {digest.needsAttentionReason}
    </p>
  {/if}
</article>

<style>
  .chair-row {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.95rem 1.1rem;
    background: var(--surface-card);
    border: 1px solid var(--surface-edge);
    border-radius: 1rem;
    color: inherit;
    transition: border-color 0.12s;
  }
  .chair-row:hover { border-color: var(--accent); }
  .room-name-link {
    color: inherit;
    text-decoration: none;
  }
  .room-name-link:hover .room-name { color: var(--accent); }
  .chip-link {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    text-decoration: none;
    color: inherit;
  }
  .chip-link:hover { color: var(--accent); }

  .chair-row.needs-attention {
    border-left: 4px solid var(--warn);
  }

  header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
  }

  .room-name {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }

  .time-since {
    font-size: 0.75rem;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }

  .last-message-summary {
    margin: 0;
    color: var(--ink);
    font-size: 0.9rem;
    line-height: 1.4;
  }

  .metric-chips {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-wrap: wrap;
    gap: 0.4rem;
  }

  .metric-chips li {
    display: inline-flex;
    align-items: center;
    gap: 0.3rem;
    padding: 0.2rem 0.55rem;
    background: var(--surface);
    border: 1px solid var(--surface-edge);
    border-radius: 999px;
    font-size: 0.7rem;
  }

  .chip-label {
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--ink-soft);
    font-weight: 700;
  }

  .chip-value {
    color: var(--ink-strong);
    font-weight: 800;
    font-variant-numeric: tabular-nums;
  }

  .attention-reason {
    margin: 0;
    padding: 0.4rem 0.65rem;
    border-radius: 0.55rem;
    font-size: 0.82rem;
    color: var(--warn);
    background: color-mix(in srgb, var(--warn) 14%, var(--surface));
  }

  .chair-summary {
    margin: 0;
    font-style: italic;
    color: var(--ink-soft);
    font-size: 0.88rem;
    line-height: 1.4;
  }
  /* #77 Chair-mediated asks UI — inline recent-asks list. */
  .chair-asks {
    margin: 0.25rem 0 0;
    padding: 0.5rem 0.75rem;
    background: color-mix(in srgb, var(--accent) 6%, var(--surface));
    border: 1px solid color-mix(in srgb, var(--accent) 20%, var(--surface-edge));
    border-radius: 0.65rem;
  }
  .chair-asks-head {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    margin-bottom: 0.35rem;
  }
  .chair-asks-label {
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--accent);
    font-weight: 800;
  }
  .chair-asks-all {
    font-size: 0.75rem;
    color: var(--accent);
    text-decoration: none;
    font-weight: 700;
  }
  .chair-asks-all:hover { text-decoration: underline; }
  .chair-asks-list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.2rem;
  }
  .chair-ask-row { margin: 0; }
  .chair-ask-link {
    display: flex;
    flex-direction: column;
    gap: 0.1rem;
    padding: 0.3rem 0.4rem;
    border-radius: 0.4rem;
    text-decoration: none;
    color: inherit;
    transition: background 0.12s;
  }
  .chair-ask-link:hover { background: color-mix(in srgb, var(--accent) 12%, transparent); }
  .chair-ask-title {
    font-size: 0.88rem;
    font-weight: 700;
    color: var(--ink-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .chair-ask-meta {
    font-size: 0.72rem;
    color: var(--ink-soft);
  }
  .chair-label {
    font-weight: 800;
    font-style: normal;
    margin-right: 0.35rem;
    color: var(--ink);
  }
</style>
