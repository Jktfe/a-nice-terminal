<!--
  AssetFoldersCard — Settings "System" section, JWPK msg_7nqg8oaufo
  2026-06-09: served images must NOT live in the repo (OSS-leak risk);
  they live in an external user-configurable folder, and a user can add
  files by hand. This card is the edit surface.

  Surfaces the operator's asset-root resolution and lets them edit the
  file layer (~/.ant/asset-folders.json) without touching their shell.
  Env-var entries (ANT_ASSET_ROOTS) stay read-only here — those remain
  canonical for power users / CI. The repo's `static/` directory is the
  final fallback (read-only, implicit, not listed in the file layer).

  Data path: GET /api/asset-settings + PUT /api/asset-settings, admin-
  bearer gated.

  Each row in the file layer is one absolute path. Empty paths are
  rejected at save time. Examples:
    /Users/you/Pictures/ant-served
    /srv/ant-assets
  Spaces in the path are fine (we render the value as-is).

  Mirror of `DeckRootsCard.svelte`, which this code was cloned from.
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  type SettingsPayload = {
    envRoots: string[];
    fileRoots: string[];
    resolved: string[];
  };

  let { canManage = true }: { canManage?: boolean } = $props();
  let payload = $state<SettingsPayload | null>(null);
  let editing = $state<string[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let loadError = $state('');
  let saveError = $state('');
  let lastSavedAt = $state<number | null>(null);

  onMount(() => {
    if (!browser || !canManage) {
      loading = false;
      return;
    }
    void load();
  });

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/asset-settings');
      if (!res.ok) throw new Error(`status ${res.status}`);
      const next = (await res.json()) as SettingsPayload;
      payload = next;
      editing = [...next.fileRoots];
    } catch (cause) {
      loadError = cause instanceof Error ? cause.message : String(cause);
    } finally {
      loading = false;
    }
  }

  async function save(): Promise<void> {
    if (!browser) return;
    saving = true;
    saveError = '';
    try {
      const cleaned = editing.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
      const res = await fetch('/api/asset-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ assetRoots: cleaned })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`save ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      }
      const next = (await res.json()) as SettingsPayload;
      payload = next;
      editing = [...next.fileRoots];
      lastSavedAt = Date.now();
    } catch (cause) {
      saveError = cause instanceof Error ? cause.message : 'save failed';
    } finally {
      saving = false;
    }
  }

  function addRow(): void {
    editing = [...editing, ''];
  }

  function removeRow(index: number): void {
    editing = editing.filter((_, i) => i !== index);
  }

  function updateRow(index: number, value: string): void {
    editing = editing.map((entry, i) => (i === index ? value : entry));
  }

  function lastSavedLabel(): string {
    if (!lastSavedAt) return '';
    const d = new Date(lastSavedAt);
    return `Saved · ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
  }
</script>

<div class="asset-folders-card">
  <div class="header">
    <h3>External asset folders</h3>
    {#if loading}
      <span class="status">loading…</span>
    {:else if loadError}
      <span class="status error" role="alert">{loadError}</span>
    {:else if lastSavedAt}
      <span class="status saved" aria-live="polite">{lastSavedLabel()}</span>
    {/if}
  </div>

  <p class="hint">
    Served images (and any other assets) live outside this repo. Configure
    one or more folders below; <code>/api/assets/&lt;path&gt;</code> resolves
    from the first matching root. The repo's <code>static/</code> folder
    is the implicit final fallback — it is always consulted last so
    existing served files keep working even before any folder is
    configured. Examples: <code>/Users/you/Pictures/ant-served</code>,
    <code>/srv/ant-assets</code>. Spaces are fine.
  </p>

  {#if !canManage}
    <p class="muted" role="status">
      Sign in as the operator to view and edit external asset folders.
    </p>
  {:else}
  {#if payload && payload.envRoots.length > 0}
    <div class="env-block">
      <span class="label">From <code>ANT_ASSET_ROOTS</code> (env, read-only here)</span>
      <ul class="path-list env">
        {#each payload.envRoots as envRoot}
          <li>
            <code>{envRoot}</code>
          </li>
        {/each}
      </ul>
    </div>
  {/if}

  <div class="file-block">
    <span class="label">From <code>~/.ant/asset-folders.json</code> (editable)</span>
    {#if editing.length === 0}
      <p class="muted">No file-layer roots yet. Add one to point ANT at a folder of images / assets you've curated by hand.</p>
    {/if}
    <ul class="path-list">
      {#each editing as path, index}
        <li class="editable-row">
          <input
            type="text"
            class="path-input"
            placeholder="/absolute/path/to/your/assets/folder"
            value={path}
            oninput={(e) => updateRow(index, (e.currentTarget as HTMLInputElement).value)}
            aria-label={`Asset folder ${index + 1}`}
          />
          <button type="button" class="row-btn" onclick={() => removeRow(index)} aria-label={`Remove asset folder ${index + 1}`}>
            Remove
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="add-btn" onclick={addRow}>+ Add another folder</button>
  </div>

  {#if payload}
    <div class="resolved-block">
      <span class="label">Effective resolution order (first match wins; <code>static/</code> is always last)</span>
      <ol class="path-list resolved">
        {#each payload.resolved as resolvedPath}
          <li><code>{resolvedPath}</code></li>
        {/each}
      </ol>
    </div>
  {/if}

  <div class="actions">
    <button type="button" class="save-btn" onclick={save} disabled={saving}>
      {saving ? 'Saving…' : 'Save'}
    </button>
    {#if saveError}
      <span class="status error" role="alert">{saveError}</span>
    {/if}
  </div>
  {/if}
</div>

<style>
  .asset-folders-card {
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    padding: 1rem 1.15rem;
    background: var(--surface-raised);
  }
  .header {
    display: flex;
    align-items: baseline;
    justify-content: space-between;
    gap: 0.5rem;
    margin-bottom: 0.5rem;
  }
  .header h3 {
    margin: 0;
    font-size: 1.05rem;
    font-weight: 850;
  }
  .status {
    color: var(--ink-soft);
    font-size: 0.83rem;
  }
  .status.error {
    color: var(--danger, #b91c1c);
  }
  .status.saved {
    color: var(--success, #166534);
  }
  .hint {
    margin: 0 0 0.75rem;
    color: var(--ink-soft);
    font-size: 0.86rem;
    line-height: 1.4;
  }
  .env-block,
  .file-block,
  .resolved-block {
    margin-top: 0.85rem;
  }
  .label {
    display: block;
    margin-bottom: 0.35rem;
    color: var(--ink-soft);
    font-size: 0.82rem;
    font-weight: 700;
  }
  .path-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: grid;
    gap: 0.35rem;
  }
  .path-list.resolved {
    counter-reset: resolved;
    list-style: decimal inside;
  }
  .editable-row {
    display: flex;
    gap: 0.4rem;
    align-items: center;
  }
  .path-input {
    flex: 1 1 auto;
    min-height: 2rem;
    padding: 0.4rem 0.6rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-base);
    color: var(--ink-strong);
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    font-size: 0.86rem;
  }
  .row-btn,
  .add-btn,
  .save-btn {
    min-height: 2rem;
    padding: 0.4rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-base);
    color: var(--ink-strong);
    font-weight: 800;
    cursor: pointer;
  }
  .row-btn:hover,
  .add-btn:hover,
  .save-btn:hover {
    background: var(--surface-raised);
  }
  .save-btn:disabled {
    opacity: 0.55;
    cursor: not-allowed;
  }
  .actions {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-top: 0.85rem;
  }
  .muted {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
  }
</style>
