<script lang="ts">
  import { onMount } from 'svelte';
  import {
    SHORTCUT_SCOPES,
    shortcutScopeLabel,
    type ShortcutScope,
  } from '$lib/shared/personal-settings';
  import { usePersonalSettings } from '$lib/stores/personal-settings.svelte';
  import { isAutoLinkedChatSession } from '$lib/utils/linked-chat';

  interface PageSession {
    id: string;
    name: string;
    type: string;
    linked_chat_id?: string | null;
    meta?: string | Record<string, unknown> | null;
  }

  let { onClose }: { onClose: () => void } = $props();

  const personal = usePersonalSettings();

  let activeScope = $state<ShortcutScope>('chatrooms');
  let sessions = $state<PageSession[]>([]);
  let sessionsLoading = $state(false);
  let newLabel = $state('');
  let newIcon = $state('*');
  let newSessionId = $state('');
  let newColor = $state('#6366F1');
  let preferencesText = $state('{}');
  let preferencesDirty = $state(false);
  let preferencesError = $state('');

  onMount(async () => {
    await personal.load();
    syncPreferencesText();
    await loadSessions();
  });

  const linkedChatIds = $derived.by(() => new Set(
    sessions
      .filter((session) => session.type === 'terminal' && session.linked_chat_id)
      .map((session) => session.linked_chat_id as string)
  ));

  const activeShortcuts = $derived(personal.settings.shortcuts[activeScope] ?? []);
  const activeSessionOptions = $derived.by(() => sessionOptions(activeScope));
  const datalistId = $derived(`shortcut-session-options-${activeScope}`);

  $effect(() => {
    personal.settings.preferences;
    if (!preferencesDirty) syncPreferencesText();
  });

  $effect(() => {
    activeScope;
    const first = activeSessionOptions[0];
    if (first && !newSessionId.trim()) newSessionId = first.id;
  });

  async function loadSessions() {
    sessionsLoading = true;
    try {
      const res = await fetch('/api/sessions');
      if (!res.ok) return;
      const data = await res.json();
      sessions = Array.isArray(data.sessions) ? data.sessions : [];
    } catch {
      sessions = [];
    } finally {
      sessionsLoading = false;
    }
  }

  function sessionOptions(scope: ShortcutScope): PageSession[] {
    if (scope === 'linkedChats') {
      return sessions.filter((session) => session.type === 'chat' && linkedChatIds.has(session.id));
    }

    return sessions.filter((session) =>
      session.type === 'chat'
      && !linkedChatIds.has(session.id)
      && !isAutoLinkedChatSession(session)
    );
  }

  function sessionName(id: string): string {
    return sessions.find((session) => session.id === id)?.name ?? id;
  }

  function syncPreferencesText() {
    preferencesText = JSON.stringify(personal.settings.preferences ?? {}, null, 2);
    preferencesError = '';
  }

  function handleAddShortcut() {
    const targetSessionId = newSessionId.trim() || activeSessionOptions[0]?.id || '';
    if (!targetSessionId) return;

    personal.addShortcut(activeScope, {
      label: newLabel.trim() || sessionName(targetSessionId),
      icon: newIcon.trim() || '*',
      sessionId: targetSessionId,
      color: /^#[0-9a-f]{6}$/i.test(newColor) ? newColor : '#6366F1',
    });

    newLabel = '';
    newIcon = '*';
    newSessionId = activeSessionOptions[0]?.id ?? '';
    newColor = '#6366F1';
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
          <h3>Shortcut Editor</h3>
          <div class="scope-toggle" aria-label="Shortcut group">
            {#each SHORTCUT_SCOPES as scope}
              <button
                type="button"
                class:active={activeScope === scope}
                onclick={() => { activeScope = scope; newSessionId = sessionOptions(scope)[0]?.id ?? ''; }}
              >{shortcutScopeLabel(scope)}</button>
            {/each}
          </div>
        </div>

        <datalist id={datalistId}>
          {#each activeSessionOptions as option (option.id)}
            <option value={option.id}>{option.name}</option>
          {/each}
        </datalist>

        <div class="shortcut-add-row">
          <input class="icon-input" bind:value={newIcon} aria-label="Icon" title="Icon" />
          <input class="label-input" bind:value={newLabel} placeholder="Label" aria-label="Label" />
          <input
            class="session-input"
            bind:value={newSessionId}
            list={datalistId}
            placeholder={sessionsLoading ? 'Loading sessions' : 'Session ID'}
            aria-label="Session ID"
          />
          <input class="color-input" type="color" bind:value={newColor} aria-label="Color" />
          <button
            type="button"
            class="primary-btn"
            onclick={handleAddShortcut}
            disabled={!newSessionId.trim() && activeSessionOptions.length === 0}
          >Add</button>
        </div>

        <div class="shortcut-list">
          {#if activeShortcuts.length === 0}
            <div class="empty-row">No {shortcutScopeLabel(activeScope).toLowerCase()} shortcuts</div>
          {:else}
            {#each activeShortcuts as shortcut, index (shortcut.id)}
              <div class="shortcut-row" style="--accent:{shortcut.color};">
                <div class="order-controls">
                  <button
                    type="button"
                    class="icon-btn"
                    onclick={() => personal.moveShortcut(activeScope, index, index - 1)}
                    disabled={index === 0}
                    title="Move up"
                    aria-label="Move shortcut up"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"/>
                    </svg>
                  </button>
                  <button
                    type="button"
                    class="icon-btn"
                    onclick={() => personal.moveShortcut(activeScope, index, index + 1)}
                    disabled={index === activeShortcuts.length - 1}
                    title="Move down"
                    aria-label="Move shortcut down"
                  >
                    <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"/>
                    </svg>
                  </button>
                </div>
                <input
                  class="icon-input"
                  value={shortcut.icon}
                  oninput={(event) => personal.updateShortcut(activeScope, shortcut.id, { icon: (event.currentTarget as HTMLInputElement).value })}
                  aria-label="Icon"
                  title="Icon"
                />
                <input
                  class="label-input"
                  value={shortcut.label}
                  oninput={(event) => personal.updateShortcut(activeScope, shortcut.id, { label: (event.currentTarget as HTMLInputElement).value })}
                  aria-label="Label"
                />
                <input
                  class="session-input"
                  value={shortcut.sessionId}
                  list={datalistId}
                  oninput={(event) => personal.updateShortcut(activeScope, shortcut.id, { sessionId: (event.currentTarget as HTMLInputElement).value })}
                  aria-label="Session ID"
                  title={sessionName(shortcut.sessionId)}
                />
                <input
                  class="color-input"
                  type="color"
                  value={shortcut.color}
                  oninput={(event) => personal.updateShortcut(activeScope, shortcut.id, { color: (event.currentTarget as HTMLInputElement).value })}
                  aria-label="Color"
                />
                <button
                  type="button"
                  class="delete-btn"
                  onclick={() => personal.removeShortcut(activeScope, shortcut.id)}
                  title="Delete shortcut"
                  aria-label="Delete shortcut"
                >
                  <svg class="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
                    <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2"
                      d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6M4 7h16M9 7V5a1 1 0 011-1h4a1 1 0 011 1v2"/>
                  </svg>
                </button>
              </div>
            {/each}
          {/if}
        </div>
      </section>

      <section class="settings-section">
        <div class="section-title-row">
          <h3>Preferences JSON</h3>
          <button type="button" class="secondary-btn" onclick={handlePreferencesSave} disabled={!preferencesDirty}>Save</button>
        </div>
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
    width: min(920px, 100%);
    max-height: min(780px, calc(100vh - 36px));
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

  .scope-toggle {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px;
    border: 1px solid var(--border-subtle);
    border-radius: 8px;
    background: var(--bg);
  }

  .scope-toggle button {
    padding: 5px 8px;
    border: 0;
    border-radius: 6px;
    background: transparent;
    color: var(--text-muted);
    font-size: 11px;
    font-weight: 700;
    cursor: pointer;
  }

  .scope-toggle button.active {
    background: #6366F1;
    color: #fff;
  }

  .shortcut-add-row,
  .shortcut-row {
    display: grid;
    grid-template-columns: 46px minmax(100px, 1fr) minmax(160px, 1.5fr) 34px auto;
    gap: 8px;
    align-items: center;
  }

  .shortcut-add-row {
    padding: 12px;
    border-bottom: 1px solid var(--border-subtle);
  }

  .shortcut-list {
    display: flex;
    flex-direction: column;
  }

  .shortcut-row {
    grid-template-columns: 58px 46px minmax(100px, 1fr) minmax(160px, 1.5fr) 34px 34px;
    padding: 10px 12px;
  }

  .shortcut-row + .shortcut-row {
    border-top: 1px solid var(--border-subtle);
  }

  .order-controls {
    display: flex;
    align-items: center;
    gap: 4px;
  }

  input,
  textarea {
    min-width: 0;
    border: 1px solid var(--border-subtle);
    border-radius: 7px;
    background: var(--bg);
    color: var(--text);
    outline: none;
  }

  input:focus,
  textarea:focus {
    border-color: #6366F1;
    box-shadow: 0 0 0 2px #6366F122;
  }

  .icon-input,
  .label-input,
  .session-input {
    height: 32px;
    padding: 0 9px;
    font-size: 12px;
  }

  .icon-input {
    text-align: center;
  }

  .session-input {
    font-family: var(--font-mono);
    font-size: 11px;
  }

  .color-input {
    width: 34px;
    height: 32px;
    padding: 2px;
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
  }

  .primary-btn,
  .secondary-btn,
  .icon-btn,
  .delete-btn,
  .close-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    cursor: pointer;
    transition: background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease;
  }

  .primary-btn {
    height: 32px;
    padding: 0 12px;
    border: 0;
    background: #6366F1;
    color: #fff;
    font-size: 12px;
    font-weight: 750;
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

  .icon-btn,
  .delete-btn,
  .close-btn {
    width: 32px;
    height: 32px;
    border: 1px solid var(--border-subtle);
    background: transparent;
    color: var(--text-muted);
  }

  .icon-btn:hover {
    color: #6366F1;
    background: #6366F112;
    border-color: #6366F155;
  }

  .delete-btn:hover {
    color: #EF4444;
    background: #EF444412;
    border-color: #EF444455;
  }

  .close-btn:hover {
    color: var(--text);
    background: var(--bg-card);
  }

  button:disabled {
    opacity: 0.42;
    cursor: not-allowed;
  }

  .empty-row {
    padding: 18px 12px;
    color: var(--text-faint);
    font-size: 12px;
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

  @media (max-width: 760px) {
    .settings-backdrop {
      padding: 10px;
      align-items: stretch;
    }

    .settings-modal {
      max-height: none;
    }

    .section-title-row {
      align-items: stretch;
      flex-direction: column;
    }

    .shortcut-add-row,
    .shortcut-row {
      grid-template-columns: 42px 1fr 34px;
    }

    .shortcut-row {
      grid-template-columns: 58px 42px 1fr 34px;
    }

    .session-input,
    .primary-btn,
    .delete-btn {
      grid-column: 1 / -1;
    }

    .shortcut-row .delete-btn {
      grid-column: auto;
    }
  }
</style>
