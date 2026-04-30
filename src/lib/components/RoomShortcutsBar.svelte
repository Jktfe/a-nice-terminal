<script lang="ts">
  import { onMount } from 'svelte';
  import { goto } from '$app/navigation';

  interface RoomShortcut {
    id: string;
    label: string;
    icon: string;
    sessionId: string;
    color: string;
  }

  let { currentSessionId }: { currentSessionId: string } = $props();

  let shortcuts = $state<RoomShortcut[]>([]);
  let editing = $state(false);
  let editingId = $state<string | null>(null);
  let showAddForm = $state(false);

  let newLabel = $state('');
  let newIcon = $state('💬');
  let newSessionId = $state('');
  let newColor = $state('#6366F1');

  onMount(() => load());

  async function load() {
    try {
      const res = await fetch('/api/room-shortcuts');
      if (res.ok) shortcuts = (await res.json()).shortcuts ?? [];
    } catch {}
  }

  async function persist() {
    try {
      await fetch('/api/room-shortcuts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ shortcuts }),
      });
    } catch {}
  }

  function handleTap(s: RoomShortcut) {
    if (editing) { editingId = editingId === s.id ? null : s.id; return; }
    goto(`/session/${s.sessionId}`);
  }

  function genId() { return Math.random().toString(36).slice(2, 9); }

  function handleAdd() {
    if (!newLabel.trim() || !newSessionId.trim()) return;
    shortcuts = [...shortcuts, {
      id: genId(),
      label: newLabel.trim(),
      icon: newIcon || '💬',
      sessionId: newSessionId.trim(),
      color: newColor,
    }];
    newLabel = ''; newIcon = '💬'; newSessionId = ''; newColor = '#6366F1';
    showAddForm = false;
    persist();
  }

  function handleUpdate(id: string, patch: Partial<RoomShortcut>) {
    shortcuts = shortcuts.map(s => s.id === id ? { ...s, ...patch } : s);
    persist();
  }

  function handleRemove(id: string) {
    shortcuts = shortcuts.filter(s => s.id !== id);
    editingId = null;
    persist();
  }
</script>

{#if shortcuts.length > 0 || editing}
<div class="room-shortcuts-bar">
  <div class="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-none">
    {#each shortcuts as s (s.id)}
      <button
        class="room-btn"
        class:active={s.sessionId === currentSessionId}
        class:editing-highlight={editing && editingId === s.id}
        style="--accent:{s.color};"
        onclick={() => handleTap(s)}
        title={editing ? 'Click to edit' : `Go to ${s.label}`}
      >
        <span class="btn-icon">{s.icon}</span>
        <span class="btn-label">{s.label}</span>
      </button>
    {/each}

    <button
      class="config-btn"
      class:config-active={editing}
      onclick={() => { editing = !editing; editingId = null; showAddForm = false; }}
      title={editing ? 'Done editing' : 'Configure room shortcuts'}
    >{editing ? '✓' : '⚙'}</button>

    {#if editing}
      <button class="config-btn add-btn" onclick={() => { showAddForm = !showAddForm; editingId = null; }} title="Add shortcut">+</button>
    {/if}
  </div>

  {#if editing && editingId}
    {@const s = shortcuts.find(x => x.id === editingId)}
    {#if s}
      <div class="edit-panel">
        <div class="edit-row">
          <input class="edit-input w-12" value={s.icon}
            oninput={(e) => handleUpdate(s.id, { icon: (e.target as HTMLInputElement).value })} placeholder="💬" />
          <input class="edit-input flex-1" value={s.label}
            oninput={(e) => handleUpdate(s.id, { label: (e.target as HTMLInputElement).value })} placeholder="Room name" />
          <input class="edit-input w-5 p-0 border-0" type="color" value={s.color}
            oninput={(e) => handleUpdate(s.id, { color: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="edit-row">
          <input class="edit-input flex-1 font-mono" value={s.sessionId}
            oninput={(e) => handleUpdate(s.id, { sessionId: (e.target as HTMLInputElement).value })} placeholder="Session ID" />
          <button class="remove-btn" onclick={() => handleRemove(s.id)} title="Remove">🗑</button>
        </div>
      </div>
    {/if}
  {/if}

  {#if showAddForm}
    <div class="edit-panel">
      <div class="edit-row">
        <input class="edit-input w-12" bind:value={newIcon} placeholder="💬" />
        <input class="edit-input flex-1" bind:value={newLabel} placeholder="Room label" />
        <input class="edit-input w-5 p-0 border-0" type="color" bind:value={newColor} />
      </div>
      <div class="edit-row">
        <input class="edit-input flex-1 font-mono" bind:value={newSessionId}
          placeholder="Paste session ID here"
          onkeydown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
        <button class="add-confirm-btn" onclick={handleAdd} disabled={!newLabel.trim() || !newSessionId.trim()}>Add</button>
      </div>
    </div>
  {/if}
</div>
{:else}
<!-- Empty: show a subtle "add room shortcut" prompt -->
<div class="flex items-center px-2 py-1" style="border-bottom:1px solid var(--border-subtle,#ffffff10);background:var(--bg-card,#1A1A22);">
  <button
    class="config-btn"
    onclick={() => { editing = true; showAddForm = true; }}
    title="Add room shortcuts"
  >⚙ <span style="font-size:11px;margin-left:4px;color:var(--text-faint);">Add room shortcuts</span></button>
</div>
{/if}

<style>
  .room-shortcuts-bar {
    border-bottom: 1px solid var(--border-subtle, #ffffff10);
    background: var(--bg-card, #1A1A22);
  }
  .room-btn {
    display: flex; align-items: center; gap: 4px;
    padding: 4px 10px; border-radius: 6px; font-size: 12px;
    white-space: nowrap; flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent); transition: all 0.15s ease; cursor: pointer;
  }
  .room-btn:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .room-btn:active { transform: scale(0.96); }
  .room-btn.active {
    background: color-mix(in srgb, var(--accent) 22%, transparent);
    border-color: color-mix(in srgb, var(--accent) 70%, transparent);
  }
  .room-btn.editing-highlight {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 25%, transparent);
  }
  .btn-icon { font-size: 13px; }
  .btn-label { font-weight: 500; }
  .config-btn {
    display: flex; align-items: center; justify-content: center;
    width: 28px; height: 28px; border-radius: 6px; font-size: 14px;
    flex-shrink: 0; border: 1px solid var(--border-subtle, #ffffff10);
    background: transparent; color: var(--text-muted, #888);
    cursor: pointer; transition: all 0.15s ease;
  }
  .config-btn:hover { background: #ffffff08; color: #fff; }
  .config-btn.config-active { background: #6366F122; color: #6366F1; border-color: #6366F155; }
  .add-btn { color: #10B981; }
  .add-btn:hover { background: #10B98118; border-color: #10B98155; }
  .edit-panel {
    display: flex; flex-direction: column; gap: 6px;
    padding: 8px 10px; border-top: 1px solid var(--border-subtle, #ffffff10);
  }
  .edit-row { display: flex; align-items: center; gap: 6px; }
  .edit-input {
    padding: 4px 8px; border-radius: 4px; font-size: 11px;
    background: #0A1628; border: 1px solid var(--border-subtle, #ffffff10);
    color: #fff; outline: none;
  }
  .edit-input:focus { border-color: #6366F1; }
  .remove-btn {
    padding: 4px 8px; border-radius: 4px; font-size: 13px;
    background: #ef444418; border: 1px solid #ef444433;
    color: #ef4444; cursor: pointer; transition: all 0.15s ease;
  }
  .remove-btn:hover { background: #ef444430; }
  .add-confirm-btn {
    padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: 600;
    background: #6366F1; border: none; color: #fff;
    cursor: pointer; transition: all 0.15s ease;
  }
  .add-confirm-btn:hover { background: #818cf8; }
  .add-confirm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
