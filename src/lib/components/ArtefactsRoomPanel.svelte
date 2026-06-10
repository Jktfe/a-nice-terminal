<!--
  ArtefactsRoomPanel — Task #91/#98 UI half.

  Sectioned list of room artefacts (HTML / decks / Stage / spreadsheets / docs /
  mockups / other), with a compact add form for each section. Backed by
  /api/chat-rooms/:roomId/artefacts (GET/POST/DELETE) — shipped 5ac765c.
-->
<script lang="ts">
  import { hrefForRoomArtefact } from '$lib/chat/artefactLinks';

  type ArtefactKind = 'html' | 'deck' | 'stage' | 'spreadsheet' | 'doc' | 'mockup' | 'tracker' | 'other';

  type RoomArtefact = {
    id: string;
    roomId: string;
    kind: ArtefactKind;
    title: string;
    refUrl: string | null;
    summary: string | null;
    createdBy: string | null;
    createdAtMs: number;
  };

  type Props = {
    roomId: string;
    asHandle?: string;
  };

  let { roomId, asHandle = '@JWPK' }: Props = $props();

  // JWPK msg_1cksqfbcyp: 'Spreadsheets' → 'Sheets' to match the
  // 'Decks' shortform + keep the panel header from breaking alignment
  // on narrow rails. Kind ids on the wire stay 'spreadsheet' — label
  // is presentation-only.
  const KIND_LABELS: Record<ArtefactKind, string> = {
    html: 'HTML',
    deck: 'Decks',
    stage: 'ANT Stage',
    spreadsheet: 'Sheets',
    doc: 'Docs',
    mockup: 'Mockups',
    tracker: 'Trackers',
    other: 'Other'
  };

  const KIND_GLYPH: Record<ArtefactKind, string> = {
    html: '🌐',
    deck: '🎞️',
    stage: '🎙️',
    spreadsheet: '📊',
    doc: '📝',
    mockup: '🎨',
    tracker: '📋',
    other: '📁'
  };

  let artefacts = $state<RoomArtefact[]>([]);
  let isLoading = $state(true);
  let lastErrorMessage = $state('');
  let addingKind = $state<ArtefactKind | null>(null);
  let newTitle = $state('');
  let newRefUrl = $state('');
  let isSubmitting = $state(false);

  async function refreshFromServer() {
    try {
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/artefacts`);
      if (!response.ok) throw new Error(`Could not load artefacts (${response.status}).`);
      const body = (await response.json()) as { artefacts: RoomArtefact[] };
      artefacts = body.artefacts ?? [];
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not load artefacts.';
    } finally {
      isLoading = false;
    }
  }

  $effect(() => {
    if (roomId) {
      isLoading = true;
      void refreshFromServer();
    }
  });

  function artefactsForKind(kind: ArtefactKind): RoomArtefact[] {
    return artefacts.filter((entry) => entry.kind === kind);
  }

  function startAdding(kind: ArtefactKind) {
    addingKind = kind;
    newTitle = '';
    newRefUrl = '';
    lastErrorMessage = '';
  }

  function cancelAdding() {
    addingKind = null;
    newTitle = '';
    newRefUrl = '';
  }

  async function submitNewArtefact() {
    if (!addingKind || newTitle.trim().length === 0) return;
    isSubmitting = true;
    lastErrorMessage = '';
    try {
      const requestBody: { kind: ArtefactKind; title: string; refUrl?: string; createdBy: string } = {
        kind: addingKind,
        title: newTitle.trim(),
        createdBy: asHandle
      };
      const trimmedUrl = newRefUrl.trim();
      if (trimmedUrl.length > 0) requestBody.refUrl = trimmedUrl;
      const response = await fetch(`/api/chat-rooms/${encodeURIComponent(roomId)}/artefacts`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(requestBody)
      });
      if (!response.ok) {
        const failure = await response.json().catch(() => ({ message: response.statusText }));
        throw new Error(failure.message ?? 'Could not create artefact.');
      }
      cancelAdding();
      await refreshFromServer();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not create artefact.';
    } finally {
      isSubmitting = false;
    }
  }

  async function removeArtefact(artefactId: string) {
    lastErrorMessage = '';
    try {
      const response = await fetch(
        `/api/chat-rooms/${encodeURIComponent(roomId)}/artefacts?artefactId=${encodeURIComponent(artefactId)}`,
        { method: 'DELETE' }
      );
      if (!response.ok && response.status !== 204) {
        throw new Error(`Could not remove (${response.status}).`);
      }
      await refreshFromServer();
    } catch (cause) {
      lastErrorMessage = cause instanceof Error ? cause.message : 'Could not remove artefact.';
    }
  }

  function isClickableRef(refUrl: string | null): boolean {
    if (!refUrl) return false;
    return refUrl.startsWith('http://') || refUrl.startsWith('https://') || refUrl.startsWith('/');
  }

  function isFileRef(refUrl: string | null): boolean {
    return refUrl !== null && refUrl.startsWith('file://');
  }

  function artefactHref(entry: RoomArtefact): string {
    return hrefForRoomArtefact(entry);
  }

  // Browsers refuse to navigate to file:// from a regular http(s) page (XSS
  // sandbox rule). For agents that referenced a local file via `ant artefact
  // add --ref-url file:///path/to/the.html`, the next-best UX is "copy the
  // path so the human can open it in Finder / `open` / VS Code". Toast
  // confirms; falls back to a window.prompt if clipboard API is blocked
  // (older / restrictive browser contexts).
  let copiedArtefactId = $state<string | null>(null);
  async function copyFilePath(artefactId: string, refUrl: string): Promise<void> {
    const path = refUrl.startsWith('file://') ? refUrl.slice('file://'.length) : refUrl;
    try {
      await navigator.clipboard.writeText(path);
      copiedArtefactId = artefactId;
      setTimeout(() => {
        if (copiedArtefactId === artefactId) copiedArtefactId = null;
      }, 1800);
    } catch {
      window.prompt('Copy the path:', path);
    }
  }
</script>

<section class="artefacts-panel" aria-label="Room artefacts">
  {#if isLoading}
    <p class="muted">Loading artefacts…</p>
  {:else}
    {#each Object.keys(KIND_LABELS) as kindKey (kindKey)}
      {@const kind = kindKey as ArtefactKind}
      {@const entriesForKind = artefactsForKind(kind)}
      <div class="kind-section">
        <header class="kind-header">
          <span class="kind-title">
            <span class="kind-glyph" aria-hidden="true">{KIND_GLYPH[kind]}</span>
            {KIND_LABELS[kind]}
            <span class="kind-count">{entriesForKind.length}</span>
          </span>
          {#if addingKind !== kind}
            <button type="button" class="add-btn" onclick={() => startAdding(kind)}>+ Add</button>
          {/if}
        </header>

        {#if addingKind === kind}
          <form
            class="add-form"
            onsubmit={(event) => { event.preventDefault(); void submitNewArtefact(); }}
          >
            <input
              type="text"
              placeholder="Title"
              bind:value={newTitle}
              maxlength="120"
              aria-label="Artefact title"
              required
            />
            <input
              type="url"
              placeholder="https://… (optional)"
              bind:value={newRefUrl}
              aria-label="Artefact reference URL"
            />
            <div class="add-actions">
              <button type="button" class="ghost" onclick={cancelAdding} disabled={isSubmitting}>Cancel</button>
              <button type="submit" class="primary" disabled={isSubmitting || newTitle.trim().length === 0}>
                {isSubmitting ? '…' : 'Add'}
              </button>
            </div>
          </form>
        {/if}

        {#if entriesForKind.length > 0}
          <ul class="artefact-list">
            {#each entriesForKind as entry (entry.id)}
              <li class="artefact-row">
                {#if isClickableRef(entry.refUrl)}
                  <a class="artefact-title" href={artefactHref(entry)}>{entry.title}</a>
                {:else if isFileRef(entry.refUrl)}
                  <button
                    type="button"
                    class="artefact-title file-ref"
                    title="Copy the file path to clipboard"
                    onclick={() => void copyFilePath(entry.id, entry.refUrl!)}
                  >{entry.title}</button>
                  {#if copiedArtefactId === entry.id}
                    <span class="copied-toast" role="status">path copied</span>
                  {/if}
                {:else}
                  <span class="artefact-title">{entry.title}</span>
                {/if}
                {#if entry.refUrl && !isClickableRef(entry.refUrl)}
                  <span class="ref-hint">{entry.refUrl}</span>
                {/if}
                <button
                  type="button"
                  class="remove-btn"
                  title={`Remove ${entry.title}`}
                  aria-label={`Remove ${entry.title}`}
                  onclick={() => void removeArtefact(entry.id)}
                >×</button>
              </li>
            {/each}
          </ul>
        {/if}
      </div>
    {/each}

    {#if lastErrorMessage}
      <p class="error" role="alert">{lastErrorMessage}</p>
    {/if}
  {/if}
</section>

<style>
  .artefacts-panel {
    display: flex;
    flex-direction: column;
    gap: 0.7rem;
    padding: 0.6rem 0.75rem;
  }
  .muted {
    margin: 0;
    color: var(--ink-soft);
    font-size: 0.85rem;
    font-style: italic;
  }
  .kind-section {
    display: flex;
    flex-direction: column;
    gap: 0.35rem;
    padding-top: 0.4rem;
    border-top: 1px dashed var(--surface-edge);
  }
  .kind-section:first-of-type { border-top: none; padding-top: 0; }
  .kind-header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 0.5rem;
  }
  .kind-title {
    display: inline-flex;
    align-items: center;
    gap: 0.4rem;
    font-size: 0.78rem;
    font-weight: 800;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--ink-soft);
  }
  .kind-glyph { font-size: 0.9rem; }
  .kind-count {
    padding: 0 0.4rem;
    border-radius: 999px;
    background: var(--bg);
    color: var(--ink-strong);
    font-size: 0.7rem;
    font-weight: 700;
  }
  .add-btn {
    padding: 0.2rem 0.55rem;
    border: 1px solid var(--line-soft);
    border-radius: 999px;
    background: transparent;
    color: var(--accent);
    font-size: 0.74rem;
    font-weight: 800;
    cursor: pointer;
  }
  .add-btn:hover { border-color: var(--accent); }
  .add-form {
    display: flex;
    flex-direction: column;
    gap: 0.3rem;
    padding: 0.45rem 0.55rem;
    border: 1px dashed var(--surface-edge);
    border-radius: 0.5rem;
    background: var(--bg);
  }
  .add-form input {
    padding: 0.35rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.4rem;
    background: var(--surface-card);
    color: var(--ink-strong);
    font: inherit;
    font-size: 0.85rem;
  }
  .add-actions {
    display: flex;
    justify-content: flex-end;
    gap: 0.35rem;
  }
  .ghost,
  .primary {
    padding: 0.3rem 0.7rem;
    border-radius: 999px;
    font-weight: 800;
    font-size: 0.78rem;
    cursor: pointer;
  }
  .ghost { border: 1px solid var(--line-soft); background: transparent; color: var(--ink-strong); }
  .primary { border: none; background: var(--accent); color: white; }
  .primary:disabled { opacity: 0.55; cursor: not-allowed; }
  .artefact-list {
    margin: 0;
    padding: 0;
    list-style: none;
    display: flex;
    flex-direction: column;
    gap: 0.25rem;
  }
  .artefact-row {
    display: flex;
    align-items: center;
    gap: 0.45rem;
    padding: 0.3rem 0.5rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.45rem;
    background: var(--surface-card);
    font-size: 0.85rem;
  }
  .artefact-title {
    flex: 1;
    color: var(--ink-strong);
    text-decoration: none;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }
  a.artefact-title {
    color: var(--accent);
    text-decoration: underline;
    text-underline-offset: 2px;
  }
  button.artefact-title.file-ref {
    border: none;
    background: none;
    padding: 0;
    margin: 0;
    color: var(--accent);
    text-decoration: underline dotted;
    text-underline-offset: 2px;
    cursor: copy;
    font: inherit;
    text-align: left;
  }
  .copied-toast {
    font-size: 0.7rem;
    color: var(--accent);
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    padding: 0.1rem 0.4rem;
    border-radius: 0.3rem;
  }
  .ref-hint {
    font-size: 0.7rem;
    color: var(--ink-soft);
  }
  .remove-btn {
    width: 1.4rem;
    height: 1.4rem;
    padding: 0;
    border-radius: 999px;
    border: none;
    background: transparent;
    color: var(--ink-soft);
    cursor: pointer;
    font-size: 0.9rem;
  }
  .remove-btn:hover { color: var(--accent); }
  .error { margin: 0; color: var(--accent); font-size: 0.82rem; }
</style>
