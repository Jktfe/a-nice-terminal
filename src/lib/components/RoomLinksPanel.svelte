<script lang="ts">
  import { goto } from '$app/navigation';

  interface RoomLink {
    id: string;
    source_room_id: string;
    target_room_id: string;
    relationship: string;
    title: string | null;
    target_name?: string;
    target_type?: string;
    source_name?: string;
    source_type?: string;
    settings?: string;
    created_at: string;
  }

  let {
    sessionId,
    serverUrl = '',
  }: {
    sessionId: string;
    serverUrl?: string;
  } = $props();

  let outgoing = $state<RoomLink[]>([]);
  let incoming = $state<RoomLink[]>([]);
  let loading = $state(true);
  let creating = $state(false);
  let newTitle = $state('');
  let showCreateForm = $state(false);

  const RELATIONSHIP_LABELS: Record<string, string> = {
    discussion_of: 'Discussion',
    promoted_summary_for: 'Summary',
    spawned_from: 'Spawned from',
    follows_up: 'Follow-up',
  };

  const RELATIONSHIP_COLORS: Record<string, string> = {
    discussion_of: '#6366F1',
    promoted_summary_for: '#10B981',
    spawned_from: '#F59E0B',
    follows_up: '#3B82F6',
  };

  async function loadLinks() {
    loading = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/links`);
      if (res.ok) {
        const data = await res.json();
        outgoing = data.outgoing || [];
        incoming = data.incoming || [];
      }
    } catch { /* silent */ }
    loading = false;
  }

  async function createDiscussion() {
    if (!newTitle.trim()) return;
    creating = true;
    try {
      const res = await fetch(`/api/sessions/${sessionId}/links`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle.trim() }),
      });
      if (res.ok) {
        const data = await res.json();
        newTitle = '';
        showCreateForm = false;
        await loadLinks();
        // Navigate to the new discussion
        goto(`/session/${data.targetRoomId}`);
      }
    } catch { /* silent */ }
    creating = false;
  }

  async function removeLink(linkId: string) {
    await fetch(`/api/sessions/${sessionId}/links?linkId=${linkId}`, { method: 'DELETE' });
    await loadLinks();
  }

  // Load on mount
  $effect(() => {
    if (sessionId) loadLinks();
  });
</script>

<div class="room-links-panel">
  <div class="section-header">
    <span class="section-title">Discussions</span>
    <button
      class="add-btn"
      onclick={() => { showCreateForm = !showCreateForm; }}
      title="Create discussion"
    >+</button>
  </div>

  {#if showCreateForm}
    <div class="create-form">
      <input
        class="create-input"
        bind:value={newTitle}
        placeholder="Discussion topic..."
        onkeydown={(e) => { if (e.key === 'Enter') createDiscussion(); if (e.key === 'Escape') showCreateForm = false; }}
      />
      <button
        class="create-btn"
        onclick={createDiscussion}
        disabled={!newTitle.trim() || creating}
      >{creating ? '...' : 'Create'}</button>
    </div>
  {/if}

  {#if loading}
    <div class="empty-state">Loading...</div>
  {:else if outgoing.length === 0 && incoming.length === 0}
    <div class="empty-state">No linked discussions yet</div>
  {:else}
    {#if outgoing.length > 0}
      <div class="link-list">
        {#each outgoing as link (link.id)}
          <div
            class="link-item"
            role="button"
            tabindex="0"
            onclick={() => goto(`/session/${link.target_room_id}`)}
            onkeydown={(e) => { if (e.key === 'Enter') goto(`/session/${link.target_room_id}`); }}
            style="--accent: {RELATIONSHIP_COLORS[link.relationship] || '#6366F1'}"
          >
            <span class="link-badge">{RELATIONSHIP_LABELS[link.relationship] || link.relationship}</span>
            <span class="link-name">{link.title || link.target_name || 'Untitled'}</span>
            <button
              class="remove-link"
              onclick={(e) => { e.stopPropagation(); removeLink(link.id); }}
              title="Remove link"
            >x</button>
          </div>
        {/each}
      </div>
    {/if}

    {#if incoming.length > 0}
      <div class="incoming-label">Parent rooms</div>
      <div class="link-list">
        {#each incoming as link (link.id)}
          <div
            class="link-item parent-link"
            role="button"
            tabindex="0"
            onclick={() => goto(`/session/${link.source_room_id}`)}
            onkeydown={(e) => { if (e.key === 'Enter') goto(`/session/${link.source_room_id}`); }}
            style="--accent: #9CA3AF"
          >
            <span class="link-badge">Parent</span>
            <span class="link-name">{link.source_name || 'Parent room'}</span>
          </div>
        {/each}
      </div>
    {/if}
  {/if}
</div>

<style>
  .room-links-panel {
    padding: 8px 0;
  }

  .section-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 4px 12px 8px;
  }

  .section-title {
    font-size: 11px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--text-muted, #888);
  }

  .add-btn {
    width: 22px;
    height: 22px;
    border-radius: 4px;
    border: 1px solid var(--border-subtle, #ffffff10);
    background: transparent;
    color: #10B981;
    font-size: 14px;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: all 0.15s ease;
  }
  .add-btn:hover { background: #10B98118; border-color: #10B98155; }

  .create-form {
    display: flex;
    gap: 6px;
    padding: 4px 12px 8px;
  }

  .create-input {
    flex: 1;
    padding: 5px 8px;
    border-radius: 6px;
    font-size: 12px;
    background: #0A1628;
    border: 1px solid var(--border-subtle, #ffffff10);
    color: #fff;
    outline: none;
  }
  .create-input:focus { border-color: #6366F1; }

  .create-btn {
    padding: 5px 12px;
    border-radius: 6px;
    font-size: 11px;
    font-weight: 600;
    background: #6366F1;
    border: none;
    color: #fff;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .create-btn:hover { background: #818cf8; }
  .create-btn:disabled { opacity: 0.4; cursor: not-allowed; }

  .link-list {
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 0 8px;
  }

  .link-item {
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 6px 8px;
    border-radius: 6px;
    border: 1px solid color-mix(in srgb, var(--accent) 20%, transparent);
    background: color-mix(in srgb, var(--accent) 5%, transparent);
    cursor: pointer;
    transition: all 0.15s ease;
    text-align: left;
    width: 100%;
  }
  .link-item:hover {
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border-color: color-mix(in srgb, var(--accent) 40%, transparent);
  }

  .link-badge {
    font-size: 9px;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    padding: 2px 6px;
    border-radius: 3px;
    background: color-mix(in srgb, var(--accent) 20%, transparent);
    color: var(--accent);
    flex-shrink: 0;
  }

  .link-name {
    font-size: 12px;
    color: var(--text, #fff);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    flex: 1;
  }

  .remove-link {
    width: 18px;
    height: 18px;
    border-radius: 3px;
    border: none;
    background: transparent;
    color: var(--text-muted, #888);
    font-size: 11px;
    cursor: pointer;
    opacity: 0;
    transition: all 0.15s ease;
    display: flex;
    align-items: center;
    justify-content: center;
    flex-shrink: 0;
  }
  .link-item:hover .remove-link { opacity: 1; }
  .remove-link:hover { background: #ef444420; color: #ef4444; }

  .incoming-label {
    font-size: 10px;
    color: var(--text-muted, #888);
    padding: 8px 12px 4px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .parent-link {
    border-style: dashed;
  }

  .empty-state {
    padding: 12px;
    text-align: center;
    font-size: 11px;
    color: var(--text-muted, #666);
  }
</style>
