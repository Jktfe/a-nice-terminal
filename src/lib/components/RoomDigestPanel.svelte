<!--
  RoomDigestPanel — slide-in summary of a room's activity.

  Task #56 (v3 parity from DigestPanel): pure statistical digest of the
  room's chat_messages — message count, participant count, duration,
  top key terms — no LLM call. Fetched from /api/chat-rooms/:roomId/digest.
-->
<script lang="ts">
  type ActivityState = 'active' | 'recent' | 'idle' | 'focused';
  type Participant = {
    id: string;
    count: number;
    lastMessageAtMs?: number | null;
    activityState?: ActivityState;
  };
  const ACTIVITY_LABEL: Record<ActivityState, string> = {
    active: 'Active',
    recent: 'Recent',
    idle: 'Idle',
    focused: 'Focused'
  };
  type KeyTerm = { term: string; count: number };
  type Digest = {
    messageCount: number;
    participantCount: number;
    durationMinutes: number;
    messagesPerHour: number;
    participants: Participant[];
    keyTerms: KeyTerm[];
    firstMessage: string | null;
    lastMessage: string | null;
  };

  type Props = {
    roomId: string;
    onClose: () => void;
  };

  let { roomId, onClose }: Props = $props();

  let digest = $state<Digest | null>(null);
  let isLoading = $state(true);
  let didFail = $state(false);

  $effect(() => {
    isLoading = true;
    didFail = false;
    digest = null;
    fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/digest`)
      .then((response) => {
        if (!response.ok) throw new Error('fetch failed');
        return response.json();
      })
      .then((data: Digest) => {
        digest = data;
      })
      .catch(() => {
        didFail = true;
      })
      .finally(() => {
        isLoading = false;
      });
  });

  function formatDuration(minutes: number): string {
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function formatTimeOfDay(iso: string | null): string {
    if (!iso) return '—';
    return new Date(iso).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function shortenHandle(handle: string): string {
    return handle.length > 22 ? handle.slice(0, 20) + '…' : handle;
  }

  function percentForParticipant(count: number, total: number): number {
    if (total <= 0) return 0;
    return Math.round((count / total) * 100);
  }
</script>

<button class="digest-backdrop" type="button" aria-label="Close digest" onclick={onClose}></button>

<aside class="digest-panel" aria-label="Room digest">
  <header class="digest-header">
    <h2 class="digest-title">Room digest</h2>
    <button type="button" class="digest-close" onclick={onClose} aria-label="Close digest">×</button>
  </header>

  <div class="digest-body">
    {#if isLoading}
      <p class="digest-status">Generating digest…</p>
    {:else if didFail}
      <p class="digest-status digest-status-failed" role="alert">Failed to load digest.</p>
    {:else if digest}
      {#if digest.messageCount === 0}
        <p class="digest-status">No messages yet — start the conversation and check back.</p>
      {:else}
        <section class="digest-stats" aria-label="Activity totals">
          <div class="stat-card"><span class="stat-value">{digest.messageCount}</span><span class="stat-label">messages</span></div>
          <div class="stat-card"><span class="stat-value">{digest.participantCount}</span><span class="stat-label">participants</span></div>
          <div class="stat-card"><span class="stat-value">{formatDuration(digest.durationMinutes)}</span><span class="stat-label">duration</span></div>
          <div class="stat-card"><span class="stat-value">{digest.messagesPerHour}</span><span class="stat-label">msgs / hr</span></div>
        </section>

        <section class="digest-section" aria-label="Timeline">
          <h3 class="section-heading">Timeline</h3>
          <div class="timeline">
            <span class="time-pill">{formatTimeOfDay(digest.firstMessage)}</span>
            <span class="time-bar" aria-hidden="true"></span>
            <span class="time-pill time-pill-strong">{formatDuration(digest.durationMinutes)}</span>
            <span class="time-bar" aria-hidden="true"></span>
            <span class="time-pill">{formatTimeOfDay(digest.lastMessage)}</span>
          </div>
        </section>

        {#if digest.participants.length > 0}
          <section class="digest-section" aria-label="Participants by message count">
            <h3 class="section-heading">Participants</h3>
            <ul class="participant-list">
              {#each digest.participants as person (person.id)}
                <li class="participant-row">
                  <span class="participant-handle" title={person.id}>{shortenHandle(person.id)}</span>
                  {#if person.activityState}
                    <span class={`activity-pill activity-${person.activityState}`}>{ACTIVITY_LABEL[person.activityState]}</span>
                  {/if}
                  <span class="participant-bar" aria-hidden="true">
                    <span class="participant-bar-fill" style="width: {percentForParticipant(person.count, digest.messageCount)}%"></span>
                  </span>
                  <span class="participant-count">{person.count}</span>
                </li>
              {/each}
            </ul>
          </section>
        {/if}

        {#if digest.keyTerms.length > 0}
          <section class="digest-section" aria-label="Key terms">
            <h3 class="section-heading">Key terms</h3>
            <div class="term-cloud">
              {#each digest.keyTerms as keyTerm (keyTerm.term)}
                <span class="term-chip" title={`${keyTerm.count} occurrences`}>
                  {keyTerm.term} <span class="term-count">{keyTerm.count}</span>
                </span>
              {/each}
            </div>
          </section>
        {/if}
      {/if}
    {/if}
  </div>
</aside>

<style>
  .digest-backdrop {
    position: fixed;
    inset: 0;
    z-index: 40;
    padding: 0;
    margin: 0;
    border: none;
    background: rgba(20, 18, 14, 0.4);
    cursor: pointer;
  }
  .digest-panel {
    position: fixed;
    top: 0;
    right: 0;
    z-index: 50;
    display: flex;
    flex-direction: column;
    width: min(420px, 100vw);
    height: 100dvh;
    background: var(--surface-card);
    border-left: 1px solid var(--line-soft);
    box-shadow: -8px 0 24px rgba(20, 18, 14, 0.18);
  }
  .digest-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0.85rem 1rem;
    border-bottom: 1px solid var(--line-soft);
  }
  .digest-title {
    margin: 0;
    font-size: 1rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .digest-close {
    width: 2rem;
    height: 2rem;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-soft);
    font-size: 1.1rem;
    cursor: pointer;
  }
  .digest-close:hover { color: var(--accent); border-color: var(--accent); }
  .digest-body {
    flex: 1;
    overflow-y: auto;
    padding: 1rem;
    display: flex;
    flex-direction: column;
    gap: 1.1rem;
  }
  .digest-status {
    margin: 2rem 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
    text-align: center;
  }
  .digest-status-failed { color: var(--accent); }
  .digest-stats {
    display: grid;
    grid-template-columns: repeat(2, 1fr);
    gap: 0.55rem;
  }
  .stat-card {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 0.15rem;
    padding: 0.75rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.7rem;
    background: var(--bg);
  }
  .stat-value {
    font-size: 1.4rem;
    font-weight: 800;
    color: var(--accent);
    line-height: 1;
  }
  .stat-label {
    font-size: 0.72rem;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .digest-section { display: flex; flex-direction: column; gap: 0.5rem; }
  .section-heading {
    margin: 0;
    font-size: 0.7rem;
    text-transform: uppercase;
    letter-spacing: 0.06em;
    color: var(--ink-soft);
    font-weight: 700;
  }
  .timeline {
    display: flex;
    align-items: center;
    gap: 0.4rem;
  }
  .time-pill {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.78rem;
    font-family: 'JetBrains Mono', monospace;
  }
  .time-pill-strong {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    color: var(--accent);
    border-color: color-mix(in srgb, var(--accent) 30%, transparent);
    font-weight: 800;
  }
  .time-bar {
    flex: 1;
    height: 1px;
    background: var(--line-soft);
  }
  .participant-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .participant-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    font-size: 0.82rem;
  }
  .participant-handle {
    flex: 1;
    font-family: 'JetBrains Mono', monospace;
    color: var(--ink-strong);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  .participant-bar {
    width: 6rem;
    height: 0.35rem;
    border-radius: 999px;
    background: var(--line-soft);
    overflow: hidden;
  }
  .participant-bar-fill {
    display: block;
    height: 100%;
    background: var(--accent);
  }
  .participant-count {
    width: 2.2rem;
    text-align: right;
    color: var(--ink-soft);
    font-variant-numeric: tabular-nums;
  }
  .activity-pill {
    padding: 0.1rem 0.45rem;
    border-radius: 999px;
    font-size: 0.65rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    line-height: 1.1;
    flex-shrink: 0;
  }
  .activity-pill.activity-active {
    background: color-mix(in srgb, #16a34a 18%, transparent);
    color: #15803d;
    border: 1px solid color-mix(in srgb, #16a34a 35%, transparent);
  }
  .activity-pill.activity-recent {
    background: color-mix(in srgb, var(--accent) 14%, transparent);
    color: var(--accent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
  }
  .activity-pill.activity-idle {
    background: transparent;
    color: var(--ink-soft);
    border: 1px dashed var(--surface-edge);
  }
  .activity-pill.activity-focused {
    background: color-mix(in srgb, #9333ea 18%, transparent);
    color: #7e22ce;
    border: 1px solid color-mix(in srgb, #9333ea 35%, transparent);
  }
  .term-cloud {
    display: flex;
    flex-wrap: wrap;
    gap: 0.3rem;
  }
  .term-chip {
    padding: 0.2rem 0.55rem;
    border-radius: 999px;
    border: 1px solid color-mix(in srgb, var(--accent) 25%, transparent);
    background: color-mix(in srgb, var(--accent) 10%, transparent);
    color: var(--accent);
    font-size: 0.78rem;
    font-weight: 700;
  }
  .term-count {
    margin-left: 0.25rem;
    color: var(--ink-soft);
    font-weight: 500;
  }
</style>
