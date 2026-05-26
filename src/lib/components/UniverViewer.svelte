<!--
  UniverViewer — mounts a Univer instance (doc | sheet | slide) inside a
  container div using the deserialised contentBody snapshot. SSR-guarded
  via `browser` from $app/environment because Univer relies on canvas +
  ResizeObserver + DOM APIs that don't exist server-side.

  Wired into /artefacts/[artefactId]/+page.svelte for the F-Univer slice
  (JWPK msg_qu7iikjd55, 2026-05-26: "drop everything and get Univer
  working"). Replaces the placeholder iframe in the .univer-shell.

  Save-back path: the parent supplies `roomId`, `artefactId`, and the
  current content row id. The viewer debounces edits and PUTs the
  fresh univer-json snapshot through the existing deck/doc content
  endpoints.

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
    contentId: string;
    roomId: string;
    contentBody: string | null;
    contentFormat: string | null;
    onError?: (message: string) => void;
  };

  let { kind, artefactId, contentId, roomId, contentBody, contentFormat, onError }: Props = $props();

  let containerEl: HTMLDivElement | undefined = $state();
  let bootError = $state('');
  let saveStatus = $state<'idle' | 'saving' | 'saved' | 'error' | 'unsupported'>('idle');
  let lastSavedAt = $state<number | null>(null);
  let univerInstance: { dispose: () => void } | null = null;
  let saveDebounceTimer: ReturnType<typeof setTimeout> | null = null;
  let saveAbortController: AbortController | null = null;
  let mounted = false;

  type SnapshotUnit = {
    getSnapshot: () => unknown;
  };

  type Disposable = {
    dispose?: () => void;
  };

  const canPersist = $derived(kind === 'deck' || kind === 'doc');

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
      { Univer, LocaleType, LogLevel, UniverInstanceType, ICommandService },
      { UniverRenderEnginePlugin },
      { UniverUIPlugin },
      { default: UniverUIDesignEnUS },
      { default: UniverUIEnUS },
      { default: UniverSheetsEnUS }
    ] = await Promise.all([
      import('@univerjs/core'),
      import('@univerjs/engine-render'),
      import('@univerjs/ui'),
      import('@univerjs/design/locale/en-US'),
      import('@univerjs/ui/locale/en-US'),
      import('@univerjs/sheets/locale/en-US')
    ]);

    const univer = new Univer({
      locale: LocaleType.EN_US,
      locales: {
        [LocaleType.EN_US]: {
          ...UniverUIDesignEnUS,
          ...UniverUIEnUS,
          ...UniverSheetsEnUS
        }
      },
      logLevel: LogLevel.WARN
    });
    univer.registerPlugin(UniverRenderEnginePlugin);
    univer.registerPlugin(UniverUIPlugin, { container: host });

    // Only register the plugin we actually need — the other Univer
    // plugins each bring their own dependency injection so loading
    // unused ones just inflates the boot.
    const snapshot = deserialiseSnapshot();
    let unit: SnapshotUnit | null = null;
    if (kind === 'deck') {
      const { UniverSlidesPlugin } = await import('@univerjs/slides');
      univer.registerPlugin(UniverSlidesPlugin);
      unit = univer.createUnit(UniverInstanceType.UNIVER_SLIDE, snapshot as Partial<unknown>) as SnapshotUnit;
    } else if (kind === 'doc') {
      const { UniverDocsPlugin } = await import('@univerjs/docs');
      univer.registerPlugin(UniverDocsPlugin);
      unit = univer.createUnit(UniverInstanceType.UNIVER_DOC, snapshot as Partial<unknown>) as SnapshotUnit;
    } else {
      const { UniverSheetsPlugin } = await import('@univerjs/sheets');
      univer.registerPlugin(UniverSheetsPlugin);
      unit = univer.createUnit(UniverInstanceType.UNIVER_SHEET, snapshot as Partial<unknown>) as SnapshotUnit;
    }

    const injector = (univer as unknown as { __getInjector?: () => { get: (token: unknown) => unknown } }).__getInjector?.();
    const commandService = injector?.get(ICommandService) as { onCommandExecuted?: (handler: () => void) => Disposable } | undefined;
    const commandSubscription = commandService?.onCommandExecuted?.(() => {
      if (!unit || !canPersist) return;
      scheduleSave(JSON.stringify(unit.getSnapshot()));
    });

    return {
      dispose: () => {
        commandSubscription?.dispose?.();
        univer.dispose();
      }
    };
  }

  // Debounced save: every 1.2s of inactivity after an edit, PUT the
  // current Univer snapshot to the content endpoint. The URL id is the
  // content row id, while the body carries the owning artefact id.
  function scheduleSave(snapshotJson: string): void {
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveDebounceTimer = setTimeout(() => {
      void persistSnapshot(snapshotJson);
    }, 1200);
  }

  async function persistSnapshot(snapshotJson: string): Promise<void> {
    if (!browser) return;
    if (!canPersist) {
      saveStatus = 'unsupported';
      return;
    }
    saveAbortController?.abort();
    const controller = new AbortController();
    saveAbortController = controller;
    saveStatus = 'saving';
    try {
      const endpoint = kind === 'deck'
        ? `/api/chat-rooms/${encodeURIComponent(roomId)}/decks/${encodeURIComponent(contentId)}`
        : `/api/chat-rooms/${encodeURIComponent(roomId)}/docs/${encodeURIComponent(contentId)}`;
      const res = await fetch(endpoint, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ artefactId, contentFormat: 'univer-json', contentBody: snapshotJson }),
        signal: controller.signal
      });
      if (!res.ok) throw new Error(`save ${res.status}`);
      saveStatus = 'saved';
      lastSavedAt = Date.now();
    } catch (cause) {
      if (cause instanceof Error && cause.name === 'AbortError') return;
      saveStatus = 'error';
      const msg = cause instanceof Error ? cause.message : 'save failed';
      onError?.(msg);
    } finally {
      if (saveAbortController === controller) saveAbortController = null;
    }
  }

  onMount(() => {
    if (!browser || !containerEl) return;
    mounted = true;
    bootUniver(containerEl)
      .then((univer) => {
        if (!mounted) {
          try { univer?.dispose(); } catch { /* dispose best-effort */ }
          return;
        }
        univerInstance = univer;
      })
      .catch((cause) => {
        if (!mounted) return;
        const msg = cause instanceof Error ? cause.message : 'Univer failed to load';
        bootError = msg;
        onError?.(msg);
      });
  });

  onDestroy(() => {
    mounted = false;
    if (saveDebounceTimer) clearTimeout(saveDebounceTimer);
    saveAbortController?.abort();
    try { univerInstance?.dispose(); } catch { /* dispose best-effort */ }
  });
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
    {:else if saveStatus === 'unsupported'}
      Editing preview only — spreadsheet persistence is not wired yet
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
