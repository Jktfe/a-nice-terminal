<script lang="ts">
  import { useQuickLaunch, type QuickLaunchButton } from '$lib/stores/quicklaunch.svelte.js';

  let {
    sessionId,
    driver,
    onInsertCommand,
  }: {
    sessionId: string;
    driver?: string | null;
    onInsertCommand: (text: string) => void;
  } = $props();

  // svelte-ignore state_referenced_locally -- sessionId and driver are stable per terminal session instance
  const ql = useQuickLaunch(sessionId, driver);

  // ── Edit mode state ──
  let editing = $state(false);
  let editingId = $state<string | null>(null);
  let showAddForm = $state(false);

  // ── Add-form fields ──
  let newLabel = $state('');
  let newIcon = $state('⚡');
  let newCommand = $state('');
  let newColor = $state('#6366F1');

  function handleTap(btn: QuickLaunchButton) {
    if (editing) {
      editingId = editingId === btn.id ? null : btn.id;
      return;
    }
    onInsertCommand(btn.command);
  }

  function handleAdd() {
    if (!newLabel.trim() || !newCommand.trim()) return;
    ql.add({ label: newLabel.trim(), icon: newIcon, command: newCommand.trim(), color: newColor });
    newLabel = '';
    newIcon = '⚡';
    newCommand = '';
    newColor = '#6366F1';
    showAddForm = false;
  }

  function handleRemove(id: string) {
    ql.remove(id);
    editingId = null;
  }
</script>

<div class="quick-launch-bar">
  <!-- Button strip -->
  <div class="flex items-center gap-1.5 px-2 py-1.5 overflow-x-auto scrollbar-none">
    {#each ql.buttons as btn (btn.id)}
      <button
        class="quick-btn"
        class:editing-highlight={editing && editingId === btn.id}
        style="--accent:{btn.color ?? '#6366F1'};"
        onclick={() => handleTap(btn)}
        title={editing ? 'Click to edit' : `Insert: ${btn.command}`}
      >
        <span class="btn-icon">{btn.icon}</span>
        <span class="btn-label">{btn.label}</span>
      </button>
    {/each}

    <!-- Config toggle -->
    <button
      class="config-btn"
      class:config-active={editing}
      onclick={() => { editing = !editing; editingId = null; showAddForm = false; }}
      title={editing ? 'Done editing' : 'Configure buttons'}
    >
      {editing ? '✓' : '⚙'}
    </button>

    {#if editing}
      <button
        class="config-btn add-btn"
        onclick={() => { showAddForm = !showAddForm; editingId = null; }}
        title="Add button"
      >+</button>
    {/if}
  </div>

  <!-- Inline editor for selected button -->
  {#if editing && editingId}
    {@const btn = ql.buttons.find(b => b.id === editingId)}
    {#if btn}
      <div class="edit-panel">
        <div class="edit-row">
          <input class="edit-input w-12" value={btn.icon}
            oninput={(e) => ql.update(btn.id, { icon: (e.target as HTMLInputElement).value })} placeholder="🔥" />
          <input class="edit-input flex-1" value={btn.label}
            oninput={(e) => ql.update(btn.id, { label: (e.target as HTMLInputElement).value })} placeholder="Label" />
          <input class="edit-input w-5 p-0 border-0" type="color" value={btn.color ?? '#6366F1'}
            oninput={(e) => ql.update(btn.id, { color: (e.target as HTMLInputElement).value })} />
        </div>
        <div class="edit-row">
          <input class="edit-input flex-1 font-mono" value={btn.command}
            oninput={(e) => ql.update(btn.id, { command: (e.target as HTMLInputElement).value })} placeholder="cd ~/project && claude" />
          <button class="remove-btn" onclick={() => handleRemove(btn.id)} title="Remove">🗑</button>
        </div>
      </div>
    {/if}
  {/if}

  <!-- Add new button form -->
  {#if showAddForm}
    <div class="edit-panel">
      <div class="edit-row">
        <input class="edit-input w-12" bind:value={newIcon} placeholder="⚡" />
        <input class="edit-input flex-1" bind:value={newLabel} placeholder="Button label" />
        <input class="edit-input w-5 p-0 border-0" type="color" bind:value={newColor} />
      </div>
      <div class="edit-row">
        <input class="edit-input flex-1 font-mono" bind:value={newCommand}
          placeholder="cd ~/project && claude"
          onkeydown={(e) => { if (e.key === 'Enter') handleAdd(); }} />
        <button class="add-confirm-btn" onclick={handleAdd} disabled={!newLabel.trim() || !newCommand.trim()}>Add</button>
      </div>
    </div>
  {/if}
</div>

<style>
  .quick-launch-bar {
    border-bottom: 1px solid var(--border-subtle, #ffffff10);
    background: var(--bg-card, #1A1A22);
  }

  .quick-btn {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 4px 10px;
    border-radius: 6px;
    font-size: 12px;
    white-space: nowrap;
    flex-shrink: 0;
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    background: color-mix(in srgb, var(--accent) 8%, transparent);
    color: var(--accent);
    transition: all 0.15s ease;
    cursor: pointer;
  }
  .quick-btn:hover {
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    border-color: color-mix(in srgb, var(--accent) 50%, transparent);
    box-shadow: 0 0 12px color-mix(in srgb, var(--accent) 20%, transparent);
  }
  .quick-btn:active {
    transform: scale(0.96);
  }
  .quick-btn.editing-highlight {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 25%, transparent);
  }

  .btn-icon { font-size: 13px; }
  .btn-label { font-weight: 500; }

  .config-btn {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 28px;
    height: 28px;
    border-radius: 6px;
    font-size: 14px;
    flex-shrink: 0;
    border: 1px solid var(--border-subtle, #ffffff10);
    background: transparent;
    color: var(--text-muted, #888);
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .config-btn:hover { background: #ffffff08; color: #fff; }
  .config-btn.config-active { background: #6366F122; color: #6366F1; border-color: #6366F155; }
  .add-btn { color: #10B981; }
  .add-btn:hover { background: #10B98118; border-color: #10B98155; }

  .edit-panel {
    display: flex;
    flex-direction: column;
    gap: 6px;
    padding: 8px 10px;
    border-top: 1px solid var(--border-subtle, #ffffff10);
  }
  .edit-row {
    display: flex;
    align-items: center;
    gap: 6px;
  }
  .edit-input {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 11px;
    background: #0A1628;
    border: 1px solid var(--border-subtle, #ffffff10);
    color: #fff;
    outline: none;
  }
  .edit-input:focus { border-color: #6366F1; }

  .remove-btn {
    padding: 4px 8px;
    border-radius: 4px;
    font-size: 13px;
    background: #ef444418;
    border: 1px solid #ef444433;
    color: #ef4444;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .remove-btn:hover { background: #ef444430; }

  .add-confirm-btn {
    padding: 4px 12px;
    border-radius: 4px;
    font-size: 11px;
    font-weight: 600;
    background: #6366F1;
    border: none;
    color: #fff;
    cursor: pointer;
    transition: all 0.15s ease;
  }
  .add-confirm-btn:hover { background: #818cf8; }
  .add-confirm-btn:disabled { opacity: 0.4; cursor: not-allowed; }
</style>
