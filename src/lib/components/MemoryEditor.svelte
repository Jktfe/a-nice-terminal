<script lang="ts">
  import { renderMarkdown } from '$lib/chat/renderMarkdown';

  type MemoryEntry = {
    id: string;
    key: string;
    value: string;
    scope: string;
    scopeTarget: string | null;
  };

  let entries = $state<MemoryEntry[]>([]);
  let loading = $state(true);
  let error = $state('');
  let editingKey = $state<string | null>(null);
  let editValue = $state('');
  let newKey = $state('');
  let newValue = $state('');
  let newScope = $state('global');
  let showNew = $state(false);
  let auditEntries = $state<any[]>([]);
  let showAudit = $state(false);

  async function loadEntries() {
    loading = true;
    error = '';
    try {
      const res = await fetch('/api/memories');
      if (!res.ok) throw new Error('Failed to load');
      const data = await res.json();
      entries = data.memories ?? [];
    } catch (e: any) {
      error = e.message ?? 'Load failed';
    } finally {
      loading = false;
    }
  }

  async function saveEdit(key: string) {
    try {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, value: editValue })
      });
      editingKey = null;
      loadEntries();
    } catch { /* ignore */ }
  }

  async function deleteEntry(key: string) {
    if (!confirm('Delete this memory entry?')) return;
    try {
      await fetch(`/api/memories/key/${encodeURIComponent(key)}`, { method: 'DELETE' });
      loadEntries();
    } catch { /* ignore */ }
  }

  async function createEntry() {
    if (!newKey.trim() || !newValue.trim()) return;
    try {
      await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ key: newKey.trim(), value: newValue.trim(), scope: newScope })
      });
      newKey = '';
      newValue = '';
      showNew = false;
      loadEntries();
    } catch { /* ignore */ }
  }

  async function loadAudit() {
    try {
      const res = await fetch('/api/memories/audit');
      if (res.ok) {
        const data = await res.json();
        auditEntries = data.audit ?? [];
      }
    } catch { /* ignore */ }
  }

  function toggleAudit() {
    showAudit = !showAudit;
    if (showAudit) loadAudit();
  }

  $effect(() => { loadEntries(); });
</script>

<section class="memory-editor">
  <header class="me-header">
    <h2>Memory Editor</h2>
    <div class="me-actions">
      <button class="me-btn" onclick={() => { showNew = !showNew; newKey = ''; newValue = ''; }}>
        + New
      </button>
      <button class="me-btn" onclick={toggleAudit}>
        {showAudit ? 'Hide Audit' : 'Audit Log'}
      </button>
    </div>
  </header>

  {#if error}
    <p class="me-error">{error}</p>
  {/if}

  {#if showNew}
    <div class="me-new-form">
      <input class="me-input" bind:value={newKey} placeholder="memory key (e.g. agents/researchant/role)" />
      <textarea class="me-textarea" bind:value={newValue} placeholder="value" rows={3}></textarea>
      <select class="me-select" bind:value={newScope}>
        <option value="global">Global</option>
        <option value="room">Room</option>
        <option value="terminal">Terminal</option>
      </select>
      <div class="me-new-btns">
        <button class="me-btn me-btn-save" onclick={createEntry}>Save</button>
        <button class="me-btn" onclick={() => showNew = false}>Cancel</button>
      </div>
    </div>
  {/if}

  {#if loading}
    <p class="me-loading">Loading...</p>
  {:else}
    <ul class="me-list">
      {#each entries as entry (entry.id)}
        <li class="me-item">
          {#if editingKey === entry.key}
            <div class="me-edit-form">
              <strong class="me-key">{entry.key}</strong>
              <textarea class="me-textarea" bind:value={editValue} rows={3}></textarea>
              <div class="me-edit-btns">
                <button class="me-btn me-btn-save" onclick={() => saveEdit(entry.key)}>Save</button>
                <button class="me-btn" onclick={() => editingKey = null}>Cancel</button>
              </div>
            </div>
          {:else}
            <div class="me-row">
              <div class="me-info">
                <strong class="me-key">{entry.key}</strong>
                <span class="me-scope">{entry.scope}{entry.scopeTarget ? ` / ${entry.scopeTarget}` : ''}</span>
              </div>
              <div class="me-value">{@html renderMarkdown(entry.value)}</div>
              <div class="me-row-btns">
                <button class="me-btn-sm" onclick={() => { editingKey = entry.key; editValue = entry.value; }}>Edit</button>
                <button class="me-btn-sm me-btn-del" onclick={() => deleteEntry(entry.key)}>Delete</button>
              </div>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
    {#if entries.length === 0}
      <p class="me-empty">No memory entries. Create one with + New.</p>
    {/if}
  {/if}

  {#if showAudit}
    <div class="me-audit">
      <h3>Audit Log</h3>
      {#if auditEntries.length === 0}
        <p class="me-empty">No audit entries.</p>
      {:else}
        <ul class="me-list">
          {#each auditEntries as a}
            <li class="me-audit-row">
              <span class="me-audit-action">{a.action}</span>
              <span class="me-audit-key">{a.memory_key ?? a.memoryKey}</span>
              <span class="me-audit-by">{a.by_handle ?? a.byHandle ?? '?'}</span>
              <span class="me-audit-at">{new Date(a.at_ms ?? a.atMs).toLocaleString()}</span>
            </li>
          {/each}
        </ul>
      {/if}
    </div>
  {/if}
</section>

<style>
  .memory-editor { margin: 1rem 0; border-top: 1px solid var(--surface-edge); padding-top: 1rem; }
  .me-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.75rem; }
  .me-header h2 { margin: 0; font-size: 1rem; }
  .me-actions { display: flex; gap: 0.4rem; }
  .me-btn { padding: 0.25rem 0.6rem; border: 1px solid var(--surface-edge); border-radius: 0.35rem; background: var(--surface); color: var(--ink); font-size: 0.78rem; cursor: pointer; }
  .me-btn:hover { background: var(--surface-edge); }
  .me-btn-save { background: var(--accent); color: white; border-color: var(--accent); }
  .me-btn-del { color: #e53e3e; border-color: #e53e3e; }
  .me-btn-sm { padding: 0.15rem 0.4rem; font-size: 0.7rem; border: 1px solid var(--surface-edge); border-radius: 0.25rem; background: transparent; color: var(--ink-soft); cursor: pointer; }
  .me-btn-sm:hover { background: var(--surface); }
  .me-error { color: #e53e3e; font-size: 0.8rem; }
  .me-loading, .me-empty { color: var(--ink-soft); font-size: 0.82rem; }
  .me-new-form, .me-edit-form { display: flex; flex-direction: column; gap: 0.4rem; margin-bottom: 0.6rem; }
  .me-input, .me-select { padding: 0.3rem 0.5rem; border: 1px solid var(--surface-edge); border-radius: 0.3rem; background: var(--bg); color: var(--ink); font-size: 0.82rem; }
  .me-textarea { padding: 0.3rem 0.5rem; border: 1px solid var(--surface-edge); border-radius: 0.3rem; background: var(--bg); color: var(--ink); font-size: 0.82rem; resize: vertical; }
  .me-new-btns, .me-edit-btns { display: flex; gap: 0.4rem; }
  .me-list { list-style: none; padding: 0; margin: 0; }
  .me-item { padding: 0.5rem 0; border-bottom: 1px solid var(--surface-edge); }
  .me-row { display: flex; flex-direction: column; gap: 0.25rem; }
  .me-info { display: flex; gap: 0.5rem; align-items: baseline; }
  .me-key { font-size: 0.85rem; color: var(--accent); }
  .me-scope { font-size: 0.7rem; color: var(--ink-soft); background: var(--surface); padding: 0.1rem 0.35rem; border-radius: 0.2rem; }
  .me-value { font-size: 0.82rem; color: var(--ink-strong); line-height: 1.4; }
  .me-row-btns { display: flex; gap: 0.3rem; margin-top: 0.2rem; }
  .me-audit { margin-top: 1rem; }
  .me-audit h3 { font-size: 0.9rem; margin: 0 0 0.5rem 0; }
  .me-audit-row { display: flex; gap: 0.5rem; font-size: 0.75rem; padding: 0.2rem 0; }
  .me-audit-action { font-weight: 700; color: var(--accent); min-width: 3.5rem; }
  .me-audit-key { color: var(--ink); flex: 1; }
  .me-audit-by { color: var(--ink-soft); }
  .me-audit-at { color: var(--ink-soft); font-size: 0.7rem; }
</style>
