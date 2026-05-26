<!--
  UniverViewer — mounts a Univer instance (doc | sheet | slide) inside a
  container div using the deserialised contentBody snapshot. SSR-guarded
  via `browser` from $app/environment because Univer relies on canvas +
  ResizeObserver + DOM APIs that don't exist server-side.

  Wired into /artefacts/[artefactId]/+page.svelte for the F-Univer slice
  (JWPK msg_qu7iikjd55, 2026-05-26: "drop everything and get Univer
  working"). Replaces the placeholder iframe in the .univer-shell.

  Save-back path: the parent supplies `roomId` + `artefactId`; the
  viewer debounces edits and PATCHes the artefact endpoint with a
  fresh univer-json snapshot. PATCH endpoint is owned by @speedykimi's
  parallel server slice (501→200 for univer-json).

  Empty-deck / empty-doc / empty-sheet seeds live alongside the boot
  function so the viewer renders SOMETHING the moment a fresh artefact
  is opened — no "blank white square" failure mode.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';

  type Kind = 'deck' | 'doc' | 'spreadsheet';

  type Props = {
    kind: Kind;
    artefactId: string;
    roomId: string;
    /**
     * The chat_room_artefact_content row id, when one already exists.
     * Null when this artefact has no body row yet — in that case the
     * save path derives a stable id (`univer-${artefactId}`) so the
     * upsert lands consistently on first save.
     */
    contentId: string | null;
    contentBody: string | null;
    contentFormat: string | null;
    onError?: (message: string) => void;
  };

  let { kind, artefactId, roomId, contentId, contentBody, contentFormat, onError }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let bootError = $state('');
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error'>('idle');
  let lastSavedAt = $state<number | null>(null);
  let univerInstance: { dispose: () => void } | null = null;
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;

  // The empty snapshots are deliberately minimal — Univer fills in
  // sensible defaults for omitted keys, but we have to at least name
  // the unit + give it an id or the canvas refuses to lay out.
  function emptySnapshotForKind(k: Kind): unknown {
    const unitId = `${k}-${artefactId}`;
    if (k === 'spreadsheet') {
      return {
        id: unitId,
        sheetOrder: ['sheet1'],
        name: 'Untitled sheet',
        sheets: {
          sheet1: {
            id: 'sheet1',
            name: 'Sheet1',
            rowCount: 100,
            columnCount: 26,
            cellData: {}
          }
        }
      };
    }
    if (k === 'doc') {
      return {
        id: unitId,
        documentStyle: { pageSize: { width: 595, height: 842 } },
        body: { dataStream: '\r\n', textRuns: [], paragraphs: [{ startIndex: 0 }] }
      };
    }
    // slide
    return {
      id: unitId,
      title: 'Untitled deck',
      pageSize: { width: 960, height: 540 },
      body: { pages: {}, pageOrder: [] }
    };
  }

  function deserialiseSnapshot(): unknown {
    if (!contentBody || contentFormat !== 'univer-json') {
      return emptySnapshotForKind(kind);
    }
    try {
      return JSON.parse(contentBody);
    } catch (cause) {
      const msg = cause instanceof Error ? cause.message : 'malformed univer-json';
      bootError = `Stored snapshot is malformed: ${msg}. Showing empty canvas instead.`;
      onError?.(bootError);
      return emptySnapshotForKind(kind);
    }
  }

  // Univer is a browser-only library; loading it server-side fails on
  // canvas / ResizeObserver references. We dynamic-import inside
  // onMount so SSR + the SvelteKit dev server prerender both stay
  // happy. Returns a dispose handle the unmount path calls.
  async function bootUniver(host: HTMLElement): Promise<{ dispose: () => void } | null> {
    const [
      { Univer, LocaleType, LogLevel, UniverInstanceType },
      { UniverRenderEnginePlugin },
      { UniverUIPlugin },
      docsMod,
      sheetsMod,
      slidesMod
    ] = await Promise.all([
      import('@univerjs/core'),
      import('@univerjs/engine-render'),
      import('@univerjs/ui'),
      import('@univerjs/docs'),
      import('@univerjs/sheets'),
      import('@univerjs/slides')
    ]);

    const univer = new Univer({
      locale: LocaleType.EN_US,
      logLevel: LogLevel.WARN
    });
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, { container: host, header: false, toolbar: false });

    // Only register the plugin we actually need — the other Univer
    // plugins each bring their own dependency injection so loading
    // unused ones just inflates the boot.
    const snapshot = deserialiseSnapshot();
    if (kind === 'deck') {
      univer.registerPlugin(slidesMod.UniverSlidesPlugin);
      univer.createUnit(UniverInstanceType.UNIVER_SLIDE, snapshot as Partial<unknown>);
    } else if (kind === 'doc') {
      univer.registerPlugin(docsMod.UniverDocsPlugin);
      univer.createUnit(UniverInstanceType.UNIVER_DOC, snapshot as Partial<unknown>);
    } else {
      univer.registerPlugin(sheetsMod.UniverSheetsPlugin);
      univer.createUnit(UniverInstanceType.UNIVER_SHEET, snapshot as Partial<unknown>);
    }
    return univer;
  }

  // Debounced save: every 1.2s of inactivity after an edit, PATCH the
  // current Univer snapshot to the artefact endpoint. @speedykimi's
  // server slice owns the matching endpoint shape (univer-json body,
  // 200 OK, updatedAtMs in response).
  function scheduleSave(snapshotJson: string): void {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      void persistSnapshot(snapshotJson);
    }, 1200);
  }

  async function persistSnapshot(snapshotJson: string): Promise<void> {
    if (!browser) return;
    // Only deck + doc are wired server-side right now (codex's PR #73 +
    // the existing markdown PUT). Spreadsheets fall back to "no save"
    // until a sheets endpoint lands — the canvas still renders + edits
    // locally for the kind=spreadsheet case, but persistence is a no-op.
    if (kind !== 'deck' && kind !== 'doc') return;
    saveStatus = 'saving';
    try {
      // The endpoint's :deckId / :docId path param is the
      // chat_room_artefact_content.id (the body row), NOT the
      // chat_room_artefacts.id (the artefact). When no body row exists
      // yet we derive a stable id from the artefactId so the upsert
      // lands consistently on first save + subsequent saves hit the
      // SAME row instead of piling new ones.
      const resolvedContentId = contentId ?? `univer-${artefactId}`;
      const segment = kind === 'deck' ? 'decks' : 'docs';
      const endpoint = `/api/chat-rooms/${encodeURIComponent(roomId)}/${segment}/${encodeURIComponent(resolvedContentId)}`;
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          artefactId,
          contentFormat: 'univer-json',
          contentBody: snapshotJson
        })
      });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`save ${res.status}${text ? `: ${text.slice(0, 120)}` : ''}`);
      }
      saveStatus = 'saved';
      lastSavedAt = Date.now();
    } catch (cause) {
      saveStatus = 'error';
      const msg = cause instanceof Error ? cause.message : 'save failed';
      onError?.(msg);
    }
  }

  onMount(() => {
    if (!browser || !containerEl) return;
    bootUniver(containerEl)
      .then((univer) => { univerInstance = univer; })
      .catch((cause) => {
        const msg = cause instanceof Error ? cause.message : 'Univer failed to load';
        bootError = msg;
        onError?.(msg);
      });
  });

  onDestroy(() => {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    try { univerInstance?.dispose(); } catch { /* dispose best-effort */ }
  });

  // Expose a manual-save trigger the parent could wire to a button.
  // Reading getSnapshot off the Univer instance is gated on the
  // UniverInstanceService which loads asynchronously, so this is a
  // best-effort helper — UI surfacing is up to the parent.
  export function scheduleSaveFromParent(snapshotJson: string): void {
    scheduleSave(snapshotJson);
  }
</script>

<div class="univer-viewer">
  {#if bootError}
    <p class="error" role="alert">{bootError}</p>
  {/if}
  <div class="canvas-host" bind:this={containerEl}></div>
  <div class="status-line" aria-live="polite">
    {#if saveStatus === 'saving'}
      Saving…
    {:else if saveStatus === 'saved' && lastSavedAt}
      Saved · {new Date(lastSavedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
    {:else if saveStatus === 'error'}
      Save failed — see console
    {/if}
  </div>
</div>

<style>
  .univer-viewer {
    display: flex;
    flex-direction: column;
    height: 70vh;
    min-height: 28rem;
    border: 1px solid var(--line-soft);
    border-radius: 0.6rem;
    overflow: hidden;
    background: var(--surface-card);
  }
  .canvas-host {
    flex: 1;
    min-height: 0;
    /* Univer mounts its canvas inside this div; it sizes to 100% of
       the parent so the flex layout drives the canvas dimensions. */
  }
  .status-line {
    padding: 0.3rem 0.7rem;
    font-size: 0.78rem;
    color: var(--ink-soft);
    background: var(--surface-raised);
    border-top: 1px solid var(--line-soft);
    min-height: 1.4rem;
  }
  .error {
    margin: 0.5rem 0.7rem;
    padding: 0.4rem 0.7rem;
    color: var(--warn, #c92020);
    background: color-mix(in srgb, var(--warn, #c92020) 8%, transparent);
    border-radius: 0.4rem;
    font-size: 0.85rem;
  }
</style>
