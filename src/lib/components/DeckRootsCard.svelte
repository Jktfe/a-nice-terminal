<!--
  DeckRootsCard — Settings "System" section, JWPK msg_ocad1i11jg
  2026-05-27 ("build everything ASAP and stable on main").

  Surfaces the operator's deck-root resolution and lets them edit the
  file layer (~/.ant/deck-settings.json) without touching their shell.
  Env-var entries (ANT_BUILT_DECKS_ROOTS) stay read-only here — those
  remain canonical for power users / CI.

  Data path: GET /api/deck-settings + PUT /api/deck-settings, admin-
  bearer gated.

  Each row in the file layer is one absolute path. Empty paths are
  rejected at save time. JWPK's actual setup uses
    /Users/jamesking/New Model Dropbox/James King/ANTdecks
  — spaces in the path are fine (we render the value as-is).
-->
<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  type SettingsPayload = {
    envRoots: string[];
    fileRoots: string[];
    resolved: string[];
  };

  let payload = $state<SettingsPayload | null>(null);
  let editing = $state<string[]>([]);
  let loading = $state(true);
  let saving = $state(false);
  let loadError = $state('');
  let saveError = $state('');
  let lastSavedAt = $state<number | null>(null);

  onMount(() => {
    if (!browser) return;
    void load();
  });

  async function load(): Promise<void> {
    loading = true;
    loadError = '';
    try {
      const res = await fetch('/api/deck-settings');
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
      const res = await fetch('/api/deck-settings', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ decksRoots: cleaned })
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

<div class="deck-roots-card">
  <div class="header">
    <h3>ANT decks folder</h3>
    {#if loading}
      <span class="status">loading…</span>
    {:else if loadError}
      <span class="status error" role="alert">{loadError}</span>
    {:else if lastSavedAt}
      <span class="status saved" aria-live="polite">{lastSavedLabel()}</span>
    {/if}
  </div>

  <p class="hint">
    Built decks live outside this repo. Configure one or more folders below;
    ANT will resolve <code>/d/&lt;slug&gt;</code> from the first matching root.
    Examples: <code>/Users/jamesking/New Model Dropbox/James King/ANTdecks</code>,
    iCloud Drive paths, a mounted share. Spaces are fine.
  </p>

  {#if payload && payload.envRoots.length > 0}
    <div class="env-block">
      <span class="label">From <code>ANT_BUILT_DECKS_ROOTS</code> (env, read-only here)</span>
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
    <span class="label">From <code>~/.ant/deck-settings.json</code> (editable)</span>
    {#if editing.length === 0}
      <p class="muted">No file-layer roots yet. Add one to override the env value or layer additional folders on top.</p>
    {/if}
    <ul class="path-list">
      {#each editing as path, index}
        <li class="editable-row">
          <input
            type="text"
            class="path-input"
            placeholder="/absolute/path/to/your/decks/folder"
            value={path}
            oninput={(e) => updateRow(index, (e.currentTarget as HTMLInputElement).value)}
            aria-label={`Deck root ${index + 1}`}
          />
          <button type="button" class="row-btn" onclick={() => removeRow(index)} aria-label={`Remove deck root ${index + 1}`}>
            Remove
          </button>
        </li>
      {/each}
    </ul>
    <button type="button" class="add-btn" onclick={addRow}>+ Add another folder</button>
  </div>

  {#if payload}
    <div class="resolved-block">
      <span class="label">Effective resolution order</span>
      <ol class="path-list resolved">
        {#each payload.resolved as resolvedPath}
          <li><code>{resolvedPath}</code></li>
        {/each}
      </ol>
    </div>
  {/if}

  {#if saveError}
    <p class="save-error" role="alert">{saveError}</p>
  {/if}

  <div class="action-row">
    <button type="button" class="save-btn" onclick={save} disabled={saving || loading}>
      {saving ? 'Saving…' : 'Save folders'}
    </button>
    <p class="muted small">
      To change the env-var layer, edit your shell rc:
      <code>export ANT_BUILT_DECKS_ROOTS="…"</code>
    </p>
  </div>
</div>

<style>
  .deck-roots-card {
    display: flex;
    flex-direction: column;
    gap: 0.65rem;
  }
  .header {
    display: flex;
    flex-wrap: wrap;
    align-items: baseline;
    gap: 0.8rem;
  }
  .header h3 { margin: 0; font-size: 1rem; }
  .status { color: var(--ink-soft, #777); font-size: 0.85rem; }
  .status.error { color: var(--warn, #c92020); }
  .status.saved { color: var(--ok, #2c8a4d); }
  .hint { margin: 0; font-size: 0.85rem; color: var(--ink-soft, #777); line-height: 1.5; }
  .hint code, .muted code, .resolved-block code, .env-block code, .file-block code {
    padding: 0.05rem 0.35rem;
    font-family: ui-monospace, monospace;
    font-size: 0.8rem;
    background: var(--surface-raised);
    color: var(--ink-strong);
    border-radius: 0.25rem;
  }
  .env-block, .file-block, .resolved-block {
    display: flex;
    flex-direction: column;
    gap: 0.4rem;
  }
  .label {
    font-size: 0.74rem;
    color: var(--ink-soft, #777);
    text-transform: uppercase;
    letter-spacing: 0.04em;
    font-weight: 700;
  }
  .path-list {
    margin: 0;
    padding-left: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
  }
  .path-list.resolved {
    list-style: decimal;
    padding-left: 1.5rem;
  }
  .path-list.env code {
    background: color-mix(in srgb, var(--accent, #4a6cf7) 8%, transparent);
  }
  .editable-row {
    display: flex;
    gap: 0.45rem;
    align-items: center;
  }
  .path-input {
    flex: 1;
    padding: 0.45rem 0.65rem;
    font-family: ui-monospace, monospace;
    font-size: 0.85rem;
    border: 1px solid var(--line-soft, #e0e0e0);
    border-radius: 0.4rem;
    background: var(--surface-card);
    color: var(--ink-strong);
  }
  .row-btn, .add-btn, .save-btn {
    padding: 0.4rem 0.85rem;
    font-size: 0.82rem;
    font-weight: 700;
    border: 1px solid var(--line-soft, #ccc);
    background: var(--surface-card);
    color: var(--ink-strong);
    border-radius: 0.4rem;
    cursor: pointer;
    transition: border-color 0.12s, color 0.12s;
  }
  .row-btn:hover, .add-btn:hover { border-color: var(--accent, #4a6cf7); color: var(--accent, #4a6cf7); }
  .save-btn {
    background: var(--accent, #4a6cf7);
    border-color: var(--accent, #4a6cf7);
    color: white;
  }
  .save-btn:hover:not(:disabled) { filter: brightness(1.05); }
  .save-btn:disabled { opacity: 0.55; cursor: not-allowed; }
  .save-error {
    margin: 0;
    padding: 0.4rem 0.65rem;
    background: color-mix(in srgb, var(--warn, #c92020) 8%, transparent);
    color: var(--warn, #c92020);
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
  .action-row {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: 0.8rem;
  }
  .muted { color: var(--ink-soft, #777); font-size: 0.83rem; margin: 0; }
  .muted.small { font-size: 0.78rem; }
</style>
