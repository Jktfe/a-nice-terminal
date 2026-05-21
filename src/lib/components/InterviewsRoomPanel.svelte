<!--
  InterviewsRoomPanel — Task #80 UI half.

  Lists current + recent interviews per room and surfaces the v3-style
  InterviewModal for focused interviews (port from a-nice-terminal —
  see commit history msg_ktp35erytz "DO NOT REINVENT THE WHEEL").

  - 'Start interview' button when no active interview + ≥1 other member
    → opens v3 modal pre-seeded with the picked subject as the target
    participant. Modal handles compose/send/end + TTS.
  - 'Resume interview' button when an interview is active and the
    caller is interviewer-or-subject → reopens modal on that session.
  - End-button on the active banner (also calls PATCH /end).

  Note: v4 backend is currently 1-subject (chat_room_interviews.subject_handle
  single TEXT). Multi-participant from v3 is a Phase 2 schema delta.
-->
<script lang="ts">
  import type { RoomMember } from '$lib/server/chatRoomStore';
  import InterviewModal from './InterviewModal.svelte';
  import type { InterviewMessage, InterviewParticipant } from './InterviewModal.svelte';

  type Interview = {
    id: string;
    room_id: string;
    interviewer: string;
    subject_handle: string;
    started_at_ms: number;
    ended_at_ms: number | null;
    end_reason: string | null;
  };

  type Props = {
    roomId: string;
    asHandle?: string;
    members?: RoomMember[];
  };

  let { roomId, asHandle = '@you', members = [] }: Props = $props();

  // v3 modal state
  let modalOpen = $state(false);
  let modalParentMessage = $state<{ id: string; content: string; sender_id?: string | null }>({
    id: 'panel-launch',
    content: '',
    sender_id: null
  });
  let modalParticipants = $state<InterviewParticipant[]>([]);
  let modalMessages = $state<InterviewMessage[]>([]);
  let modalBusy = $state(false);
  let modalInterviewId = $state<string | null>(null);

  let active = $state<Interview | null>(null);
  let recent = $state<Interview[]>([]);
  let isLoading = $state(true);
  let isEnding = $state(false);
  let isStarting = $state(false);
  let startFormOpen = $state(false);
  let subjectPick = $state<string>('');
  let lastErrorMessage = $state('');

  const interviewableMembers = $derived(
    members.filter((member) => member.handle !== asHandle)
  );

  async function refreshFromServer() {
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/interviews`);
      if (!response.ok) throw new Error(`Could not load interviews (${response.status}).`);
      const body = (await response.json()) as { active: Interview | null; recent: Interview[] };
      active = body.active ?? null;
      recent = body.recent ?? [];
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not load interviews.';
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (roomId) {
      isLoading = true;
      void refreshFromServer();
    }
  });

  function isParticipantInActive(): boolean {
    if (!active) return false;
    return active.interviewer === asHandle || active.subject_handle === asHandle;
  }

  function durationSinceStart(startedAtMs: number): string {
    const minutes = Math.max(0, Math.round((Date.now() - startedAtMs) / 60_000));
    if (minutes < 60) return `${minutes}m`;
    const hours = Math.floor(minutes / 60);
    const remainder = minutes % 60;
    return remainder > 0 ? `${hours}h ${remainder}m` : `${hours}h`;
  }

  function formatTimeOfDay(ms: number): string {
    return new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  async function startInterview() {
    if (isStarting) return;
    if (!subjectPick) {
      lastErrorMessage = 'Pick a subject.';
      return;
    }
    isStarting = true;
    lastErrorMessage = '';
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/interviews`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ subjectHandle: subjectPick })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not start interview.');
      }
      const body = (await response.json()) as { interview: Interview };
      const newInterview = body.interview;
      await refreshFromServer();
      // Open the v3 modal immediately on the new interview.
      openModalFor(newInterview);
      startFormOpen = false;
      subjectPick = '';
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not start interview.';
    } finally {
      isStarting = false;
    }
  }

  function openModalFor(interview: Interview) {
    modalInterviewId = interview.id;
    modalParentMessage = {
      id: `interview-${interview.id}`,
      content: `Interview with ${interview.subject_handle}`,
      sender_id: interview.interviewer
    };
    modalParticipants = [{
      handle: interview.subject_handle,
      displayName: members.find((m) => m.handle === interview.subject_handle)?.displayName ?? interview.subject_handle,
      isTarget: true,
      muted: false
    }];
    modalMessages = [];
    modalBusy = false;
    modalOpen = true;
  }

  async function handleModalSend(content: string): Promise<void> {
    if (!modalInterviewId) return;
    modalBusy = true;
    const localId = `local-${Date.now()}-u`;
    modalMessages = [
      ...modalMessages,
      { id: localId, role: 'user', content, createdAt: Date.now() }
    ];
    try {
      const response = await fetch(`/api/interviews/${encodeURIComponent(modalInterviewId)}/messages`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        // v4 contract: body field (NOT v3's role+content shape).
        body: JSON.stringify({ body: content })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        lastErrorMessage = failure.message ?? 'Send failed.';
      }
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Send failed.';
    } finally {
      modalBusy = false;
    }
  }

  async function handleModalEnd(): Promise<void> {
    if (!modalInterviewId) return;
    try {
      // v4 contract: PATCH (NOT POST as the prior panel had).
      const response = await fetch(`/api/interviews/${encodeURIComponent(modalInterviewId)}/end`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({})
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        lastErrorMessage = failure.message ?? 'Could not end interview.';
        return;
      }
      modalOpen = false;
      modalInterviewId = null;
      await refreshFromServer();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not end interview.';
    }
  }

  function handleModalToggleMute(handle: string, muted: boolean): void {
    modalParticipants = modalParticipants.map((p) =>
      p.handle === handle ? { ...p, muted } : p
    );
  }

  async function endActiveInterview() {
    if (!active) return;
    isEnding = true;
    lastErrorMessage = '';
    try {
      // v4 contract: PATCH (NOT POST — the existing panel had this wrong;
      // POST returned method-not-allowed and the End button was a no-op).
      const response = await fetch(`/api/interviews/${encodeURIComponent(active.id)}/end`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endedBy: asHandle })
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not end interview.');
      }
      await refreshFromServer();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not end interview.';
    } finally {
      isEnding = false;
    }
  }
</script>

<section class="interviews-panel" aria-label="Interviews">
  {#if isLoading}
    <p class="muted">Loading interviews…</p>
  {:else}
    {#if active}
      <div class="active-banner" role="status" aria-live="polite">
        <span class="active-tag">Live interview</span>
        <span class="active-line">
          <strong>{active.interviewer}</strong> ↔ <strong>{active.subject_handle}</strong>
          <span class="muted">· {durationSinceStart(active.started_at_ms)} elapsed</span>
        </span>
        {#if isParticipantInActive()}
          <button
            type="button"
            class="resume-btn"
            onclick={() => active && openModalFor(active)}
          >Resume</button>
          <button
            type="button"
            class="end-btn"
            onclick={() => void endActiveInterview()}
            disabled={isEnding}
          >{isEnding ? 'Ending…' : 'End interview'}</button>
        {/if}
      </div>
    {:else if startFormOpen && interviewableMembers.length > 0}
      <form class="start-form" onsubmit={(e) => { e.preventDefault(); void startInterview(); }}>
        <label class="start-label">
          <span>Interview</span>
          <select bind:value={subjectPick} disabled={isStarting} aria-label="Pick a room member to interview">
            <option value="" disabled>Pick a member…</option>
            {#each interviewableMembers as member (member.handle)}
              <option value={member.handle}>{member.displayName ?? member.handle} ({member.handle})</option>
            {/each}
          </select>
        </label>
        <div class="start-actions">
          <button type="submit" class="start-confirm" disabled={isStarting || !subjectPick}>
            {isStarting ? 'Starting…' : 'Start'}
          </button>
          <button type="button" class="start-cancel" onclick={() => { startFormOpen = false; subjectPick = ''; lastErrorMessage = ''; }}>
            Cancel
          </button>
        </div>
      </form>
    {:else}
      <p class="muted">No interview is currently active in this room.</p>
      {#if interviewableMembers.length > 0}
        <button type="button" class="start-btn" onclick={() => (startFormOpen = true)}>
          Start interview
        </button>
        <p class="hint">Or from the CLI: <code>ant interview start &lt;roomId&gt; --subject @handle</code></p>
      {:else}
        <p class="hint">Invite another member to the room to start an interview.</p>
      {/if}
    {/if}

    {#if recent.length > 0}
      <details class="recent-list">
        <summary>Recent interviews ({recent.length})</summary>
        <ul>
          {#each recent as entry (entry.id)}
            <li>
              <span class="entry-line">
                <strong>{entry.interviewer}</strong> ↔ <strong>{entry.subject_handle}</strong>
              </span>
              <span class="entry-time muted">
                {formatTimeOfDay(entry.started_at_ms)}
                {#if entry.ended_at_ms !== null}· {Math.round((entry.ended_at_ms - entry.started_at_ms) / 60_000)}m{/if}
                {#if entry.end_reason}· {entry.end_reason}{/if}
              </span>
            </li>
          {/each}
        </ul>
      </details>
    {/if}

    {#if lastErrorMessage}
      <p class="error" role="alert">{lastErrorMessage}</p>
    {/if}
  {/if}
</section>

<InterviewModal
  open={modalOpen}
  parentMessage={modalParentMessage}
  parentRoomId={roomId}
  participants={modalParticipants}
  candidateAgents={[]}
  messages={modalMessages}
  busy={modalBusy}
  lastErrorMessage={modalOpen ? lastErrorMessage : ''}
  onClose={() => { modalOpen = false; lastErrorMessage = ''; }}
  onSend={handleModalSend}
  onToggleMute={handleModalToggleMute}
  onEndInterview={handleModalEnd}
/>

<style>
  .interviews-panel {
    display: flex;
    flex-direction: column;
    gap: 0.55rem;
    padding: 0.6rem 0.75rem;
  }
  .muted {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
  .hint {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.78rem;
  }
  .hint code {
    padding: 0.05rem 0.3rem;
    border-radius: 0.3rem;
    background: var(--bg);
    font-size: 0.72rem;
  }
  .active-banner {
    display: flex;
    align-items: center;
    flex-wrap: wrap;
    gap: 0.55rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: 0.65rem;
    background: color-mix(in srgb, var(--accent) 8%, transparent);
  }
  .active-tag {
    padding: 0.15rem 0.5rem;
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font-size: 0.7rem;
    font-weight: 800;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }
  .active-line {
    flex: 1;
    font-size: 0.88rem;
    color: var(--ink-strong);
  }
  .end-btn {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: transparent;
    color: var(--accent);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .end-btn:hover:not(:disabled) {
    background: var(--accent);
    color: white;
  }
  .end-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .resume-btn {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .resume-btn:hover { filter: brightness(1.05); }
  .start-btn {
    align-self: flex-start;
    padding: 0.35rem 0.85rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-size: 0.82rem;
    font-weight: 800;
    cursor: pointer;
  }
  .start-btn:hover { filter: brightness(1.05); }
  .start-form {
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
    padding: 0.55rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.65rem;
    background: var(--surface-card);
  }
  .start-label {
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
    font-size: 0.78rem;
    color: var(--ink-strong);
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
  }
  .start-label select {
    padding: 0.4rem 0.55rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.85rem;
    font-weight: 500;
    text-transform: none;
    letter-spacing: 0;
  }
  .start-actions {
    display: flex;
    gap: 0.45rem;
  }
  .start-confirm {
    padding: 0.3rem 0.75rem;
    border: 1px solid var(--accent);
    border-radius: 999px;
    background: var(--accent);
    color: white;
    font: inherit;
    font-size: 0.78rem;
    font-weight: 800;
    cursor: pointer;
  }
  .start-confirm:disabled { opacity: 0.5; cursor: not-allowed; }
  .start-cancel {
    padding: 0.3rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.78rem;
    font-weight: 600;
    cursor: pointer;
  }
  .start-cancel:hover { color: var(--ink-strong); }
  .recent-list summary {
    cursor: pointer;
    font-size: 0.78rem;
    color: var(--ink-soft);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 800;
  }
  .recent-list ul {
    margin: 0.3rem 0 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .recent-list li {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    padding: 0.25rem 0;
    font-size: 0.82rem;
  }
  .entry-line { color: var(--ink-strong); }
  .entry-time { font-size: 0.74rem; }
  .error {
    margin: 0;
    color: var(--accent);
    font-size: 0.82rem;
  }
</style>
