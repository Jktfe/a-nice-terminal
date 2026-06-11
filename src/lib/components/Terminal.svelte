<!--
  Terminal.svelte — fresh-ANT xterm-js pane (T1 frontend per terminal-frontend-research-2026-05-14).
  Consumes the locked TERMINALS BACKEND surface:
    POST /api/terminals/[id]/input  { data }   → 202
    POST /api/terminals/[id]/resize { cols, rows } → 202
    GET  /api/terminals/[id]/stream            → SSE, frame `data: JSON({data: string})`
  Mount lifecycle: lazy-import @xterm/xterm + addon-fit under browser
  guard, attach to host <div>, open EventSource, write incoming frames
  to xterm via a chunked write-queue. Input via term.onData → POST.
  Resize via FitAddon + ResizeObserver → POST /resize.
-->
<script lang="ts">
  import { onMount, onDestroy } from 'svelte';
  import { browser } from '$app/environment';
  import {
    postInput as ptyPostInput,
    handleSpecialKey as ptyHandleSpecialKey
  } from '$lib/terminal/ptyInput';
  import TerminalSpecialKeys from './TerminalSpecialKeys.svelte';

  // Passive OSC 7 / OSC 1337 cwd detection per FOLDER-IMPL design.
  // OSC 7: \x1b]7;file://host/path\x1b\\
  // OSC 1337 CurrentDir: \x1b]1337;CurrentDir=/path\x07 (or \x1b\\)
  const OSC7_RE = /\x1b\]7;file:\/\/[^/]*(\/[^\x07\x1b]+)(?:\x07|\x1b\\)/;
  const OSC1337_CWD_RE = /\x1b\]1337;CurrentDir=([^\x07\x1b]+)(?:\x07|\x1b\\)/;
  function detectCwd(chunk: string): string | null {
    const m1 = chunk.match(OSC7_RE);
    if (m1) try { return decodeURIComponent(m1[1]); } catch { return m1[1]; }
    const m2 = chunk.match(OSC1337_CWD_RE);
    if (m2) return m2[1];
    return null;
  }

  type Props = {
    terminalId: string;
    onTitleChange?: (title: string) => void;
    initialCwd?: string | null;
    /** Bubble OSC-detected cwd up to TerminalCard so the folder picker
     *  + navigator (shared across Chat/ANT/Raw views) stay live. */
    onCwdDetected?: (path: string) => void;
  };
  let { terminalId, onTitleChange, initialCwd = null, onCwdDetected }: Props = $props();

  let hostEl: HTMLDivElement | undefined = $state();
  let term: import('@xterm/xterm').Terminal | null = null;
  let fitAddon: import('@xterm/addon-fit').FitAddon | null = null;
  let eventSource: EventSource | null = null;
  let resizeObserver: ResizeObserver | null = null;
  let writeQueue: string[] = [];
  let writeFlushTimer: ReturnType<typeof setTimeout> | null = null;

  // Push the seed cwd up to the parent on first attach so the breadcrumb
  // is correct before the first OSC-7 prompt marker arrives.
  $effect(() => {
    if (initialCwd) onCwdDetected?.(initialCwd);
  });

  // (Removed seedRawHistory: it replayed persisted kind=raw run-events that
  // are ANSI-stripped at capture, painting escape-free + duplicated scrollback
  // under /stream's own raw capturePaneScrollback snapshot. /stream provides
  // the initial scrollback on connect, so the replay was both redundant and
  // the source of the mis-render. Deep escape-preserving history is a separate
  // server-side capture fix.)

  // Thin wrappers binding this pane's terminalId to the shared PTY-input
  // path (src/lib/terminal/ptyInput). Behaviour is identical to the
  // former inline handlers — the ANT view now uses the same module so
  // the two views cannot drift (FINDING-1 ANT-input-parity).
  const postInput = (data: string) => ptyPostInput(terminalId, data);
  const handleSpecialKey = (seq: string) => ptyHandleSpecialKey(terminalId, seq);

  async function postResize(cols: number, rows: number): Promise<void> {
    if (cols <= 0 || rows <= 0) return;
    await fetch(`/api/terminals/${encodeURIComponent(terminalId)}/resize`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ cols, rows })
    }).catch(() => { /* fire-and-forget per backend Q1 contract */ });
  }

  function flushWriteQueue(): void {
    if (!term || writeQueue.length === 0) return;
    const chunk = writeQueue.join('');
    writeQueue = [];
    writeFlushTimer = null;
    term.write(chunk);
  }

  function enqueueWrite(data: string): void {
    writeQueue.push(data);
    // ≥256B → 2ms coalesce per v3 write-queue lesson (avoid xterm
    // ANSI-state thrashing on bulk output).
    const totalSize = writeQueue.reduce((sum, s) => sum + s.length, 0);
    if (totalSize >= 256) {
      if (writeFlushTimer !== null) {
        clearTimeout(writeFlushTimer);
        writeFlushTimer = null;
      }
      writeFlushTimer = setTimeout(flushWriteQueue, 2);
    } else {
      // Small payloads: flush next microtask
      if (writeFlushTimer === null) {
        writeFlushTimer = setTimeout(flushWriteQueue, 0);
      }
    }
  }

  function handleResize(): void {
    if (!fitAddon || !term) return;
    fitAddon.fit();
    void postResize(term.cols, term.rows);
  }

  onMount(() => {
    if (!browser || !hostEl) return;
    (async () => {
      const { Terminal } = await import('@xterm/xterm');
      const { FitAddon } = await import('@xterm/addon-fit');
      await import('@xterm/xterm/css/xterm.css');
      // Ensure the Nerd Font is loaded BEFORE xterm measures glyph widths,
      // otherwise xterm uses the fallback metrics and never re-measures.
      if (typeof document !== 'undefined' && document.fonts) {
        try { await document.fonts.load("14px 'Symbols Nerd Font'"); } catch { /* swallow */ }
      }
      term = new Terminal({
        cursorBlink: true,
        // "Symbols Nerd Font" first so powerline / starship / git icons in
        // the user's prompt render as glyphs instead of missing-char boxes.
        // Falls back to system monospace for everything else.
        fontFamily: '"Symbols Nerd Font", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        fontSize: 14,
        theme: { background: '#000000', foreground: '#f7ffe8' },
        scrollback: 5000
      });
      fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      term.open(hostEl!);
      fitAddon.fit();
      void postResize(term.cols, term.rows);

      term.onData((data) => { void postInput(data); });
      term.onTitleChange?.((title) => { onTitleChange?.(title); });

      // Resize on container changes (window resize / room layout shifts).
      resizeObserver = new ResizeObserver(() => handleResize());
      resizeObserver.observe(hostEl!);

      // Initial scrollback comes from /stream's capturePaneScrollback on
      // connect (raw tmux bytes, escapes intact). We deliberately do NOT
      // replay persisted run-events here: the kind=raw rows are ANSI-stripped
      // at capture (normalizeForClassifier in the ingest feeds cleanChunk to
      // everything), so replaying them painted escape-free, mis-rendered +
      // DUPLICATED scrollback under the (correct) live tail — JWPK's "not
      // rendering correctly" bug. Alt-screen TUIs still rely on the SIGWINCH
      // repaint nudge below.

      // Open SSE stream + write incoming frames via the chunked queue.
      eventSource = new EventSource(
        `/api/terminals/${encodeURIComponent(terminalId)}/stream`
      );
      eventSource.onmessage = (ev) => {
        try {
          const parsed = JSON.parse(ev.data) as { data?: string; cwd?: string | null; reset?: boolean };
          if (typeof parsed.cwd === 'string' && parsed.cwd.length > 0) onCwdDetected?.(parsed.cwd);
          // reset:true means the server-side .out file was truncated/rotated
          // (e.g. post-restart) and what we're holding is now stale. Drop the
          // queued writes and clear the screen before painting the fresh
          // scrollback seed; the live tail then resumes cleanly from here.
          if (parsed.reset === true && term) {
            writeQueue = [];
            if (writeFlushTimer !== null) { clearTimeout(writeFlushTimer); writeFlushTimer = null; }
            term.reset();
          }
          if (typeof parsed.data === 'string') {
            const detected = detectCwd(parsed.data);
            if (detected !== null) onCwdDetected?.(detected);
            enqueueWrite(parsed.data);
          }
        } catch {
          /* heartbeat or malformed frame — ignore */
        }
      };
      eventSource.onerror = () => {
        // EventSource auto-reconnects; surface only persistent failures.
      };

      // After the SSE is listening, nudge the PTY with a resize so a
      // foreground full-screen TUI (claude-code etc) repaints its CURRENT
      // screen into the live stream. Without this, an alt-screen TUI that
      // isn't actively emitting leaves the xterm blank on attach (the
      // persisted scrollback can't reconstruct alt-screen state). v3 did
      // the same SIGWINCH-on-attach trick. Slight delay so SSE is bound.
      setTimeout(() => {
        if (term && fitAddon) {
          fitAddon.fit();
          // Toggle one row then restore → guarantees a dimension *change*
          // so the daemon emits SIGWINCH even if cols/rows are unchanged.
          void postResize(term.cols, Math.max(1, term.rows - 1));
          setTimeout(() => { if (term) void postResize(term.cols, term.rows); }, 60);
        }
      }, 250);
    })().catch((cause) => {
      console.error('[Terminal] init failed', cause);
    });
  });

  onDestroy(() => {
    if (writeFlushTimer !== null) clearTimeout(writeFlushTimer);
    if (eventSource) {
      eventSource.onmessage = null;
      eventSource.onerror = null;
      eventSource.close();
    }
    resizeObserver?.disconnect();
    term?.dispose();
    eventSource = null;
    term = null;
    fitAddon = null;
  });
</script>

<div class="terminal-stack">
  <TerminalSpecialKeys onKey={handleSpecialKey} />
  <!-- Wheel-passthrough: xterm.js attaches its own wheel handler on the
       .xterm-viewport child that intercepts scroll for its scrollback.
       JWPK wants page-level scroll to win instead. We intercept wheel in
       the CAPTURE phase on the host, stop the event before it reaches
       xterm's listener, then manually translate to window.scrollBy.
       Shift-wheel preserves the original xterm scrollback gesture for
       power users (modifier short-circuits the override). -->
  <div
    class="ant-terminal-host"
    bind:this={hostEl}
    onwheelcapture={(e) => {
      if (e.shiftKey) return;
      e.stopPropagation();
      window.scrollBy({ top: e.deltaY, left: e.deltaX, behavior: 'auto' });
    }}
  ></div>
</div>

<style>
  /* SymbolsNerdFont — covers the powerline / starship / git / weather
     glyphs your shell prompt emits. Self-hosted in /static/fonts so the
     terminal renders identically on every machine on the tailnet without
     a network round-trip. font-display:block keeps the boxes off-screen
     until the font is ready so the first paint doesn't flash □. */
  @font-face {
    font-family: 'Symbols Nerd Font';
    src: url('/fonts/SymbolsNerdFont-Regular.ttf') format('truetype');
    font-display: block;
    font-weight: normal;
    font-style: normal;
  }
  .terminal-stack {
    display: flex; flex-direction: column;
    max-height: 32rem; height: 32rem; overflow: hidden;
    border-radius: 0 0 0.6rem 0.6rem;
  }
  .ant-terminal-host {
    flex: 1 1 auto;
    width: 100%;
    background: #000000;
    padding: 0.5rem;
    overflow: hidden;
  }
  /* xterm-js handles its own internal layout; the host just provides the
     bounding box + the black background that bleeds through any padding. */

  /* Visible, always-on scrollbar on xterm's scrollback viewport (JWPK
     2026-06-11: "can we just add a scroll bar?"). Plain-wheel is bound to
     page-scroll (see onwheelcapture above), so a draggable bar is the
     discoverable way to reach the 5000-line scrollback — dragging the thumb
     is a mouse drag, not a wheel event, so it sidesteps the wheel override.
     Explicitly styling ::-webkit-scrollbar overrides the macOS overlay
     scrollbar's auto-hide so the bar stays visible. (Full-screen TUI panes —
     the agents — still have little in scrollback by nature; that history
     lives in the ANT view.) :global() because xterm renders .xterm-viewport
     itself, outside this component's scoped markup. */
  .ant-terminal-host :global(.xterm-viewport) {
    scrollbar-width: thin;
    scrollbar-color: #555 #1a1a1a;
  }
  .ant-terminal-host :global(.xterm-viewport)::-webkit-scrollbar {
    width: 12px;
  }
  .ant-terminal-host :global(.xterm-viewport)::-webkit-scrollbar-track {
    background: #1a1a1a;
  }
  .ant-terminal-host :global(.xterm-viewport)::-webkit-scrollbar-thumb {
    background: #555;
    border-radius: 6px;
    border: 2px solid #1a1a1a;
  }
  .ant-terminal-host :global(.xterm-viewport)::-webkit-scrollbar-thumb:hover {
    background: #777;
  }
</style>
