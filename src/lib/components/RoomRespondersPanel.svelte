<!--
  RoomRespondersPanel — ordered responder list with reorder, add, remove.
  Per the responders design contract 2026-05-13 (M3.b.5).

  Up/down arrows move a responder in the ordered list (PATCH move).
  Remove evicts a responder from the list (DELETE).
  Add promotes a non-responder member into the list (POST).
-->
<script lang="ts">
  import type { RoomMember } from '$lib/server/chatRoomStore';

  type Responder = {
    id: number;
    terminal_id: string;
    order_index: number;
    handle: string;
    pane_status: 'unknown' | 'verified' | 'stale';
  };

  type Props = {
    roomId: string;
    members: RoomMember[];
    responders: Responder[];
    callerHandle: string;
    onChanged?: () => void;
  };

  let { roomId, members, responders, callerHandle, onChanged }: Props = $props();

  let busy = $state(false);
  let errorText = $state('');

  const nonResponderMembers = $derived(
    members.filter((m) => !responders.some((r) => r.handle === m.handle))
  );

  function statusLabel(status: Responder['pane_status']): string {
    if (status === 'verified') return 'verified';
    if (status === 'stale') return 'stale';
    return 'unknown';
  }

  function statusColor(status: Responder['pane_status']): string {
    if (status === 'verified') return '#16a34a';
    if (status === 'stale') return '#9ca3af';
    return '#d1d5db';
  }

  async function apiCall(method: string, body: Record<string, unknown>): Promise<boolean> {
    busy = true;
    errorText = '';
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/responders`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, pidChain: [] })
      });
      if (!response.ok) {
        const text = await response.text().catch(() => `${response.status}`);
        errorText = `${method} failed: ${text}`;
        return false;
      }
      onChanged?.();
      return true;
    } catch (e) {
      errorText = e instanceof Error ? e.message : 'Network error';
      return false;
    } finally {
      busy = false;
    }
  }

  async function moveResponder(handle: string, to: number) {
    await apiCall('PATCH', { handle, to });
  }

  async function removeResponder(handle: string) {
    await apiCall('DELETE', { handle });
  }

  async function addResponder(handle: string) {
    await apiCall('POST', { handle });
  }
</script>

<section class="responders-panel" aria-labelledby="respondersHeading">
  <header class="panel-header">
    <h2 id="respondersHeading">Responders ({responders.length})</h2>
    <p class="panel-hint">
      Ordered list for heads-down routing. First verified responder gets the message.
    </p>
  </header>

  {#if errorText}
    <p class="error-text" role="alert">{errorText}</p>
  {/if}

  {#if responders.length === 0}
    <p class="empty-state">No responders set. In heads-down mode, messages will broadcast to all members for a claim.</p>
  {:else}
    <ol class="responder-rows" aria-label="Ordered responder list">
      {#each responders as responder, index (responder.handle)}
        <li class="responder-row">
          <span class="responder-order" aria-label="Position {index + 1}">{index + 1}</span>
          <span class="responder-status-dot" style:background={statusColor(responder.pane_status)} aria-label={statusLabel(responder.pane_status)}></span>
          <span class="responder-handle">{responder.handle}</span>
          <span class="responder-status-label">{statusLabel(responder.pane_status)}</span>
          <span class="responder-actions">
            <button
              type="button"
              class="action-btn"
              disabled={busy || index === 0}
              onclick={() => moveResponder(responder.handle, index - 1)}
              aria-label={`Move ${responder.handle} up`}
              title="Move up"
            >
              ↑
            </button>
            <button
              type="button"
              class="action-btn"
              disabled={busy || index === responders.length - 1}
              onclick={() => moveResponder(responder.handle, index + 1)}
              aria-label={`Move ${responder.handle} down`}
              title="Move down"
            >
              ↓
            </button>
            <button
              type="button"
              class="action-btn action-remove"
              disabled={busy}
              onclick={() => removeResponder(responder.handle)}
              aria-label={`Remove ${responder.handle}`}
              title="Remove"
            >
              ✕
            </button>
          </span>
        </li>
      {/each}
    </ol>
  {/if}

  {#if nonResponderMembers.length > 0}
    <div class="add-section">
      <h3 class="add-heading">Add responder</h3>
      <div class="add-rows">
        {#each nonResponderMembers as member (member.handle)}
          <button
            type="button"
            class="add-row"
            disabled={busy}
            onclick={() => addResponder(member.handle)}
          >
            <span class="member-icon" style:background={member.displayColor}>{member.displayName.slice(0, 1)}</span>
            <span class="member-handle">{member.handle}</span>
            <span class="add-label">+ Add</span>
          </button>
        {/each}
      </div>
    </div>
  {/if}
</section>

<style>
  .responders-panel {
    padding: 1.1rem 1.3rem;
  }
  .panel-header {
    margin-bottom: 0.75rem;
  }
  .panel-header h2 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .panel-hint {
    margin: 0.35rem 0 0;
    font-size: 0.82rem;
    color: var(--ink-soft);
    line-height: 1.4;
  }
  .error-text {
    margin: 0 0 0.75rem;
    padding: 0.5rem 0.75rem;
    border-radius: 0.5rem;
    background: color-mix(in srgb, var(--danger, #b91c1c) 8%, var(--surface-card));
    color: var(--danger, #b91c1c);
    font-size: 0.85rem;
    font-weight: 700;
  }
  .empty-state {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.9rem;
    line-height: 1.45;
  }
  .responder-rows {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .responder-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.5rem 0.6rem;
    background: var(--bg);
    border: 1px solid var(--line-soft);
    border-radius: 0.55rem;
  }
  .responder-order {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-width: 1.35rem;
    height: 1.35rem;
    border-radius: 999px;
    background: color-mix(in srgb, var(--ink-soft) 9%, transparent);
    color: var(--ink-soft);
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.7rem;
    font-weight: 800;
    line-height: 1;
  }
  .responder-status-dot {
    width: 0.48rem;
    height: 0.48rem;
    border-radius: 999px;
    flex-shrink: 0;
  }
  .responder-handle {
    font-weight: 800;
    flex: 1 1 auto;
    font-family: 'JetBrains Mono', ui-monospace, monospace;
    font-size: 0.9rem;
  }
  .responder-status-label {
    font-size: 0.78rem;
    color: var(--ink-soft);
    text-transform: capitalize;
  }
  .responder-actions {
    display: inline-flex;
    gap: 0.2rem;
  }
  .action-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.6rem;
    height: 1.6rem;
    padding: 0;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    font-size: 0.85rem;
    cursor: pointer;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .action-btn:hover:not(:disabled) {
    background: var(--surface-card);
    border-color: var(--accent);
    color: var(--accent);
  }
  .action-btn:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .action-remove:hover:not(:disabled) {
    border-color: var(--danger, #b91c1c);
    color: var(--danger, #b91c1c);
  }
  .add-section {
    margin-top: 1rem;
    padding-top: 1rem;
    border-top: 1px solid var(--line-soft);
  }
  .add-heading {
    margin: 0 0 0.6rem;
    font-size: 0.92rem;
    font-weight: 800;
    color: var(--ink-strong);
  }
  .add-rows {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
  }
  .add-row {
    display: flex;
    align-items: center;
    gap: 0.55rem;
    padding: 0.45rem 0.6rem;
    background: var(--surface-raised);
    border: 1px solid transparent;
    border-radius: 0.5rem;
    cursor: pointer;
    text-align: left;
    color: var(--ink-strong);
    font: inherit;
    transition: background 120ms ease, border-color 120ms ease;
  }
  .add-row:hover:not(:disabled) {
    background: var(--surface-card);
    border-color: var(--accent);
  }
  .add-row:disabled {
    opacity: 0.4;
    cursor: not-allowed;
  }
  .member-icon {
    flex-shrink: 0;
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.4rem;
    height: 1.4rem;
    border-radius: 0.4rem;
    color: white;
    font-size: 0.75rem;
    font-weight: 900;
    box-shadow: inset 0 0 0 1px var(--line-soft);
  }
  .member-handle {
    flex: 1 1 auto;
    font-weight: 700;
    font-size: 0.9rem;
  }
  .add-label {
    font-size: 0.82rem;
    font-weight: 800;
    color: var(--accent);
  }
</style>
