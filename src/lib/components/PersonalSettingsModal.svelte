<script lang="ts">
  import { onMount } from 'svelte';
  import { usePersonalSettings } from '$lib/stores/personal-settings.svelte';

  let { onClose }: { onClose: () => void } = $props();

  const personal = usePersonalSettings();

  let preferencesText = $state('{}');
  let preferencesDirty = $state(false);
  let preferencesError = $state('');

  let reapBusy = $state(false);
  let reapMessage = $state('');
  let reapError = $state('');

  async function handleReapTmux() {
    reapBusy = true;
    reapMessage = '';
    reapError = '';
    try {
      const res = await fetch('/api/admin/reap-tmux', { method: 'POST' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { killed: string[]; killedCount: number; knownCount: number };
      reapMessage = body.killedCount === 0
        ? `No orphans found (${body.knownCount} live terminals).`
        : `Killed ${body.killedCount} orphan${body.killedCount === 1 ? '' : 's'}.`;
    } catch (err) {
      reapError = err instanceof Error ? err.message : String(err);
    } finally {
      reapBusy = false;
    }
  }

  onMount(async () => {
    await personal.load();
    syncPreferencesText();
  });

  $effect(() => {
    personal.settings.preferences;
    if (!preferencesDirty) syncPreferencesText();
  });

  function syncPreferencesText() {
    preferencesText = JSON.stringify(personal.settings.preferences ?? {}, null, 2);
    preferencesError = '';
  }

  function handlePreferencesSave() {
    preferencesError = '';
    let parsed: unknown;
    try {
      parsed = JSON.parse(preferencesText || '{}');
    } catch (err) {
      preferencesError = err instanceof Error ? err.message : 'Invalid JSON';
      return;
    }

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      preferencesError = 'Preferences must be a JSON object';
      return;
    }

    personal.updatePreferences(parsed as Record<string, unknown>);
    preferencesDirty = false;
  }

  function handleKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') onClose();
  }
</script>

<svelte:window onkeydown={handleKeydown} />

<div
  class="settings-backdrop"
  role="presentation"
  onmousedown={(event) => { if (event.target === event.currentTarget) onClose(); }}
>
  <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Personal settings">
    <header class="settings-header">
      <div class="min-w-0">
        <h2>Personal Settings</h2>
        {#if personal.path}
          <p>{personal.path}</p>
        {/if}
      </div>
      <button type="button" class="close-btn" onclick={onClose} aria-label="Close settings" title="Close">
        <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </header>

    <div class="settings-body">
      <section class="settings-section">
        <div class="section-title-row">
          <h3>Quick actions</h3>
        </div>
        <p class="hint">
          Edit chatroom and linked-chat quick actions inline using the gear icon (⚙) on the chip bar above the message composer.
        </p>
      </section>

      <section class="settings-section">
        <div class="section-title-row">
          <h3>Preferences JSON</h3>
          <button type="button" class="secondary-btn" onclick={handlePreferencesSave} disabled={!preferencesDirty}>Save</button>
        </div>
        <p class="hint">
          Advanced. A free-form JSON bag persisted with your account.
          No settings currently consume this — it is here as a forward
          hatch for feature flags, so leave it empty unless an ANT
          maintainer asks you to set a specific key. Invalid JSON is
          rejected on save.
        </p>
        <textarea
          class="preferences-editor"
          bind:value={preferencesText}
          oninput={() => { preferencesDirty = true; preferencesError = ''; }}
          spellcheck="false"
          aria-label="Preferences JSON"
        ></textarea>
        {#if preferencesError}
          <p class="error-text">{preferencesError}</p>
        {/if}
      </section>

      <section class="settings-section">
        <div class="section-title-row">
          <h3>Maintenance</h3>
          <button type="button" class="secondary-btn" onclick={handleReapTmux} disabled={reapBusy}>
            {reapBusy ? 'Cleaning…' : 'Clean up tmux sessions'}
          </button>
        </div>
        <p class="hint">
          Kills tmux sessions that have no matching live ANT terminal row. Useful after a crash or test run that leaked PTYs.
        </p>
        {#if reapMessage}
          <p class="hint" style="padding-top: 0;">{reapMessage}</p>
        {/if}
        {#if reapError}
          <p class="error-text">{reapError}</p>
        {/if}
      </section>
    </div>

    <footer class="settings-footer">
      {#if personal.error}
        <span class="error-text">{personal.error}</span>
      {:else if personal.saving}
        <span class="muted-text">Saving</span>
      {:else if personal.loading}
        <span class="muted-text">Loading</span>
      {:else}
        <span class="muted-text">Local</span>
      {/if}
      <button type="button" class="secondary-btn" onclick={onClose}>Done</button>
    </footer>
  </div>
</div>

<style>
  .settings-backdrop {
    position: fixed;
    inset: 0;
    z-index: 100;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 18px;
    background: rgba(15, 23, 42, 0.58);
    backdrop-filter: blur(5px);
  }

  .settings-modal {
    width: min(640px, 100%);
    max-height: min(640px, calc(100vh - 36px));
    display: flex;
    flex-direction: column;
    overflow: hidden;
    border: 1px solid var(--border-light);
    border-radius: 12px;
    background: var(--bg);
    color: var(--text);
    box-shadow: 0 24px 60px rgba(15, 23, 42, 0.28);
  }

  .settings-header,
  .settings-footer {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 12px;
    padding: 12px 14px;
    border-color: var(--border-light);
  }

  .settings-header {
    border-bottom: 1px solid var(--border-light);
  }

  .settings-footer {
    border-top: 1px solid var(--border-light);
  }

  h2,
  h3,
  p {
    margin: 0;
  }

  h2 {
    font-size: 15px;
    font-weight: 750;
  }

  h3 {
    font-size: 12px;
    font-weight: 750;
  }

  .settings-header p {
    margin-top: 3px;
    max-width: 78vw;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    color: var(--text-faint);
    font-family: var(--font-mono);
    font-size: 10px;
  }

  .settings-body {
    flex: 1;
    min-height: 0;
    overflow-y: auto;
    padding: 14px;
  }

  .settings-section {
    border: 1px solid var(--border-light);
    border-radius: 10px;
    background: var(--bg-card);
  }

  .settings-section + .settings-section {
    margin-top: 14px;
  }

  .section-title-row {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 10px 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .hint {
    padding: 12px;
    color: var(--text-muted);
    font-size: 12px;
    line-height: 1.45;
  }

  .preferences-editor {
    display: block;
    width: calc(100% - 24px);
    min-height: 150px;
    margin: 12px;
    padding: 10px;
    resize: vertical;
    font-family: var(--font-mono);
    font-size: 12px;
    line-height: 1.45;
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  .preferences-editor:focus {
    border-color: #6366F1;
    box-shadow: 0 0 0 2px #6366F122;
  }

  .secondary-btn,
  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .secondary-btn {
    height: 32px;
    padding: 0 12px;
    border: 1px solid var(--border-subtle);
    background: var(--bg-card);
    color: var(--text-muted);
    font-size: 12px;
    font-weight: 700;
  }

  .secondary-btn:hover {
    color: #6366F1;
    border-color: #6366F155;
    background: #6366F112;
  }

  .close-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-muted);
  }

  .close-btn:hover {
    color: var(--text);
    background: var(--bg-card);
  }

  button:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .error-text {
    color: #EF4444;
    font-size: 12px;
  }

  .settings-section .error-text {
    padding: 0 12px 12px;
  }

  .muted-text {
    color: var(--text-faint);
    font-size: 12px;
  }
</style>
