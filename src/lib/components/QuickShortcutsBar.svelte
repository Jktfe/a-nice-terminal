<!--
  QuickShortcutsBar — horizontally scrolling row of user-defined PTY chips.

  Global, server-persisted shortcut list (one set across all terminals,
  per JWPK 2026-05-15 lock). Each chip carries a `text` payload and an
  `autoEnter` flag. Clicking a chip fires `onSend(shortcut)` and the
  parent does the PTY inject.

  Each chip has a small pencil affordance to open an inline editor; a
  "+" pill at the end of the bar adds a new shortcut. The editor is a
  native <dialog> modal (showModal()) — Cancel / Save / Delete (for
  existing) — same pattern as ConfirmRoomActionModal.

  The same component is mounted inside Settings (vertical list mode)
  so editing from either surface uses the same store and API.
-->
<script lang="ts">
  import { onMount } from 'svelte';

  export type QuickShortcut = {
    id: string;
    label: string;
    text: string;
    autoEnter: boolean;
    orderIndex: number;
    createdAtMs: number;
    updatedAtMs: number;
  };

  type Props = {
    onSend?: (chip: QuickShortcut) => void;
    /** Render style. `bar` = horizontal scroller (default, terminal card use).
     *  `list` = vertical list (Settings page use). Editor is identical. */
    layout?: 'bar' | 'list';
    /** Wrap bar chips into a capped tray when the parent reveals many shortcuts. */
    compactTray?: boolean;
  };

  let { onSend, layout = 'bar', compactTray = false }: Props = $props();

  let shortcuts = $state<QuickShortcut[]>([]);
  let loaded = $state(false);
  let loadError = $state<string | null>(null);

  // Editor state. `mode` discriminates create-vs-edit; when editing, also
  // holds the shortcut id for the PATCH/DELETE calls.
  type EditorMode = { kind: 'closed' } | { kind: 'new' } | { kind: 'edit'; id: string };
  let editor = $state<EditorMode>({ kind: 'closed' });
  let draftLabel = $state('');
  let draftText = $state('');
  let draftAutoEnter = $state(true);
  let isSaving = $state(false);
  let isDeleting = $state(false);
  let formError = $state<string | null>(null);

  let dialogElement = $state<HTMLDialogElement | null>(null);

  $effect(() => {
    if (!dialogElement) return;
    if (editor.kind !== 'closed' && !dialogElement.open) {
      dialogElement.showModal();
    } else if (editor.kind === 'closed' && dialogElement.open) {
      dialogElement.close();
    }
  });

  onMount(() => { void loadShortcuts(); });

  async function loadShortcuts(): Promise<void> {
    try {
      const r = await fetch('/api/quick-shortcuts');
      if (!r.ok) { loadError = `HTTP ${r.status}`; return; }
      const body = (await r.json()) as { shortcuts: QuickShortcut[] };
      shortcuts = body.shortcuts ?? [];
      loadError = null;
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    } finally {
      loaded = true;
    }
  }

  function handleChipClick(s: QuickShortcut): void {
    onSend?.(s);
  }

  function openCreate(): void {
    editor = { kind: 'new' };
    draftLabel = '';
    draftText = '';
    draftAutoEnter = true;
    formError = null;
  }

  function openEdit(s: QuickShortcut): void {
    editor = { kind: 'edit', id: s.id };
    draftLabel = s.label;
    draftText = s.text;
    draftAutoEnter = s.autoEnter;
    formError = null;
  }

  function closeEditor(): void {
    editor = { kind: 'closed' };
    formError = null;
  }

  async function saveDraft(): Promise<void> {
    const label = draftLabel.trim();
    const text = draftText.trim();
    if (!label || !text) {
      formError = 'Label and text are both required.';
      return;
    }
    isSaving = true;
    formError = null;
    try {
      if (editor.kind === 'new') {
        const r = await fetch('/api/quick-shortcuts', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label, text, autoEnter: draftAutoEnter })
        });
        if (!r.ok) {
          formError = `Save failed: HTTP ${r.status}`;
          return;
        }
      } else if (editor.kind === 'edit') {
        const r = await fetch(`/api/quick-shortcuts/${editor.id}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ label, text, autoEnter: draftAutoEnter })
        });
        if (!r.ok) {
          formError = `Save failed: HTTP ${r.status}`;
          return;
        }
      }
      await loadShortcuts();
      closeEditor();
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err);
    } finally {
      isSaving = false;
    }
  }

  async function deleteDraft(): Promise<void> {
    if (editor.kind !== 'edit') return;
    isDeleting = true;
    formError = null;
    try {
      const r = await fetch(`/api/quick-shortcuts/${editor.id}`, { method: 'DELETE' });
      if (!r.ok && r.status !== 204) {
        formError = `Delete failed: HTTP ${r.status}`;
        return;
      }
      await loadShortcuts();
      closeEditor();
    } catch (err) {
      formError = err instanceof Error ? err.message : String(err);
    } finally {
      isDeleting = false;
    }
  }

  function handleCancelEvent(event: Event): void {
    event.preventDefault();
    closeEditor();
  }

  function handleBackdropClick(event: MouseEvent): void {
    if (event.target === dialogElement) closeEditor();
  }
</script>

<div class="quick-shortcuts {layout === 'list' ? 'as-list' : 'as-bar'} {compactTray ? 'compact-tray' : ''}">
  {#if !loaded}
    <span class="empty-hint">Loading shortcuts…</span>
  {:else if loadError}
    <span class="empty-hint err">Couldn't load shortcuts ({loadError}).</span>
  {:else}
    <div class="scroller" role="group" aria-label="Quick shortcuts">
      {#each shortcuts as s (s.id)}
        <div class="chip-wrap">
          <button
            type="button"
            class="chip"
            onclick={() => handleChipClick(s)}
            title={s.text + (s.autoEnter ? ' ⏎' : '')}
          >{s.label}</button>
          <button
            type="button"
            class="edit-btn"
            onclick={() => openEdit(s)}
            aria-label={`Edit shortcut "${s.label}"`}
            title="Edit shortcut"
          >
            <svg viewBox="0 0 24 24" aria-hidden="true" width="12" height="12">
              <path d="M4 20l4-1 11-11-3-3-11 11-1 4z M14 6l3 3" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linejoin="round"/>
            </svg>
          </button>
        </div>
      {/each}
      <button
        type="button"
        class="add-btn"
        onclick={openCreate}
        aria-label="Add shortcut"
        title="Add a shortcut"
      >+ {shortcuts.length === 0 ? 'Add shortcut' : ''}</button>
    </div>
  {/if}
</div>

<!-- svelte-ignore a11y_click_events_have_key_events -->
<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
<dialog
  bind:this={dialogElement}
  class="shortcut-editor-dialog"
  aria-labelledby="shortcutEditorHeading"
  onclick={handleBackdropClick}
  oncancel={handleCancelEvent}
>
  <h2 id="shortcutEditorHeading">{editor.kind === 'new' ? 'Add shortcut' : 'Edit shortcut'}</h2>
  <div class="form">
    <label>
      <span>Label</span>
      <input type="text" bind:value={draftLabel} placeholder="e.g. clear" maxlength="40" />
    </label>
    <label>
      <span>Text sent to terminal</span>
      <input type="text" bind:value={draftText} placeholder="e.g. clear" />
    </label>
    <label class="checkbox-row">
      <input type="checkbox" bind:checked={draftAutoEnter} />
      <span>Press Enter after sending</span>
    </label>
    {#if formError}<p class="err" role="alert">{formError}</p>{/if}
  </div>
  <div class="actions">
    <!-- svelte-ignore a11y_autofocus -->
    <button type="button" class="safe" onclick={closeEditor} autofocus>Cancel</button>
    {#if editor.kind === 'edit'}
      <button type="button" class="destructive" onclick={deleteDraft} disabled={isDeleting}>
        {isDeleting ? 'Deleting…' : 'Delete'}
      </button>
    {/if}
    <button
      type="button"
      class="primary"
      onclick={saveDraft}
      disabled={isSaving || !draftLabel.trim() || !draftText.trim()}
    >
      {isSaving ? 'Saving…' : 'Save'}
    </button>
  </div>
</dialog>

<style>
  .quick-shortcuts {
    width: 100%;
    background: var(--surface-card);
    border-top: 1px solid var(--line-soft);
    font-size: 0.85rem;
  }

  .quick-shortcuts.as-bar { padding: 0.45rem 0.6rem; }
  .quick-shortcuts.as-list { padding: 0.6rem 0.8rem; border-top: none; }
  .quick-shortcuts.as-bar.compact-tray {
    padding: 0.5rem 0.65rem 0.65rem;
  }

  .empty-hint {
    display: inline-block;
    padding: 0.25rem 0.4rem;
    color: var(--ink-soft);
    font-style: italic;
    font-size: 0.82rem;
  }
  .empty-hint.err { color: var(--warn, #c92020); font-style: normal; }

  .scroller {
    display: flex;
    flex-wrap: nowrap;
    overflow-x: auto;
    gap: 0.35rem;
    -webkit-overflow-scrolling: touch;
    scrollbar-width: thin;
  }
  .as-list .scroller {
    flex-wrap: wrap;
    overflow-x: visible;
  }
  .compact-tray .scroller {
    flex-wrap: wrap;
    align-content: flex-start;
    overflow-x: hidden;
    overflow-y: auto;
    max-height: min(9rem, 32vh);
    padding-right: 0.15rem;
  }

  .chip-wrap {
    display: inline-flex;
    align-items: center;
    flex: 0 0 auto;
    border-radius: 999px;
    border: 1px solid var(--line-soft);
    background: var(--bg);
    overflow: hidden;
  }
  .compact-tray .chip-wrap,
  .compact-tray .add-btn {
    max-width: min(18rem, 100%);
  }
  .chip-wrap:hover { border-color: var(--accent); }

  .chip {
    padding: 0.3rem 0.65rem;
    border: none;
    background: transparent;
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .compact-tray .chip {
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
  }
  .chip:hover { color: var(--accent); }

  .edit-btn {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    width: 1.5rem;
    height: 1.5rem;
    padding: 0;
    margin-right: 0.15rem;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    border-radius: 999px;
  }
  .edit-btn:hover {
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
  }

  .add-btn {
    flex: 0 0 auto;
    padding: 0.3rem 0.7rem;
    border: 1px dashed var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--ink-soft);
    font: inherit;
    font-size: 0.82rem;
    font-weight: 700;
    cursor: pointer;
    white-space: nowrap;
  }
  .add-btn:hover {
    border-style: solid;
    border-color: var(--accent);
    color: var(--accent);
  }

  .shortcut-editor-dialog[open] {
    width: min(420px, calc(100vw - 2rem));
    padding: 1.4rem 1.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 1rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    box-shadow: var(--shadow-card);
  }
  .shortcut-editor-dialog::backdrop { background: rgb(0 0 0 / 40%); }

  .shortcut-editor-dialog h2 {
    margin: 0 0 1rem;
    font-size: 1.05rem;
    font-weight: 800;
  }

  .form {
    display: flex;
    flex-direction: column;
    gap: 0.75rem;
    margin-bottom: 1.2rem;
  }

  .form label {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    font-size: 0.85rem;
    font-weight: 700;
    color: var(--ink-soft);
  }

  .form label.checkbox-row {
    flex-direction: row;
    align-items: center;
    gap: 0.5rem;
    color: var(--ink-strong);
    font-weight: 700;
  }
  .form label.checkbox-row input { accent-color: var(--accent); }

  .form input[type='text'] {
    padding: 0.5rem 0.7rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.5rem;
    background: var(--bg);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.92rem;
  }
  .form input[type='text']:focus {
    outline: none;
    border-color: var(--accent);
    box-shadow: 0 0 0 3px color-mix(in srgb, var(--accent) 22%, transparent);
  }

  .err {
    margin: 0;
    color: var(--warn, #c92020);
    font-size: 0.85rem;
    font-weight: 700;
  }

  .actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.5rem;
  }

  .actions button {
    padding: 0.5rem 1rem;
    border-radius: 999px;
    font: inherit;
    font-weight: 800;
    font-size: 0.9rem;
    cursor: pointer;
  }
  .safe { border: 1px solid var(--line-soft); background: transparent; color: var(--ink-strong); }
  .primary { border: none; background: var(--accent); color: white; }
  .primary:hover:not(:disabled) { filter: brightness(1.05); }
  .primary:disabled { opacity: 0.5; cursor: not-allowed; }
  .destructive { border: none; background: var(--warn, #c92020); color: white; }
  .destructive:hover:not(:disabled) { filter: brightness(1.05); }
  .destructive:disabled { opacity: 0.6; cursor: progress; }
</style>
