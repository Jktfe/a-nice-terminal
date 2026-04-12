<script lang="ts">
  import { onMount } from 'svelte';
  import { slide } from 'svelte/transition';
  import { browser } from '$app/environment';

  let { sessionId, onData }: { sessionId: string; onData?: (data: string) => void } = $props();

  let termRef = $state<HTMLDivElement | undefined>();
  let terminal: any = $state(null);
  let ws: WebSocket | null = $state(null);
  let slowEdit = $state(false);
  let slowEditText = $state('');
  let slowEditRef = $state<HTMLTextAreaElement | null>(null);
  let paneTitle = $state('');

  // Scroll track state
  let scrollRatio = $state(1);
  let scrollThumbTop = $derived.by(() => {
    const trackHeight = 400; // approximate, updated by resize observer
    const thumbHeight = Math.max(40, Math.min(120, trackHeight * 0.15));
    const maxOffset = trackHeight - thumbHeight - 80;
    return 40 + (1 - scrollRatio) * maxOffset;
  });
  let scrollThumbHeight = $derived(Math.max(40, 120));

  // Special keys for mobile/touch input
  const specialKeys = [
    { label: 'Esc', seq: '\x1b' },
    { label: '↑', seq: '\x1b[A' },
    { label: '↓', seq: '\x1b[B' },
    { label: '←', seq: '\x1b[D' },
    { label: '→', seq: '\x1b[C' },
    { label: 'Paste', seq: '__paste__' },
    { label: '^C', seq: '\x03' },
    { label: '⇧Tab', seq: '\x1b[Z' },
    { label: 'Tab', seq: '\t' },
  ];

  function sendKey(seq: string) {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (seq === '__paste__') {
      navigator.clipboard.readText().then(text => {
        ws!.send(JSON.stringify({ type: 'terminal_input', sessionId, data: text }));
      });
      return;
    }
    ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data: seq }));
  }

  $effect(() => {
    if (slowEdit && slowEditRef) slowEditRef.focus();
  });

  // Scroll track drag handling
  function startScrollDrag(e: PointerEvent) {
    const track = (e.target as HTMLElement).parentElement!;
    const rect = track.getBoundingClientRect();

    function onMove(ev: PointerEvent) {
      const y = ev.clientY - rect.top;
      const ratio = Math.max(0, Math.min(1, y / rect.height));
      if (terminal?.buffer?.active) {
        terminal.scrollToLine(Math.round(ratio * terminal.buffer.active.baseY));
      }
    }

    function onUp() {
      document.removeEventListener('pointermove', onMove);
      document.removeEventListener('pointerup', onUp);
    }

    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    onMove(e);
  }

  // Block DA1/DA2/DSR cursor-report responses from looping back into the PTY (v2 lesson)
  const TERM_RESPONSE_RE = /^\x1b\[\??[>]?[\d;]*c$|^\x1b\[\d+;\d+[Rn]$|^\x1b\[\d*n$/;

  // Adaptive output buffering (v2 lesson):
  // <256B → microtask (near-zero keystroke echo latency)
  // ≥256B → 2ms coalesce (batch bulk output to avoid thrashing xterm)
  const MICROTASK_THRESHOLD = 256;
  let outputBuffer: string[] = [];
  let outputSize = 0;
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let microtaskScheduled = false;

  // Write queue — ensures sequential writes to xterm.
  // writeChunked uses setTimeout chains; if scrollback (262KB, ~43 chunks, ~430ms)
  // and a concurrent SIGWINCH response both run, their chunks interleave and corrupt
  // xterm's ANSI state machine (cursor positions, erase sequences clash → blank screen).
  let writeQueue: string[] = [];
  let writeActive = false;

  function drainWriteQueue(term: any) {
    if (writeQueue.length === 0) { writeActive = false; return; }
    writeActive = true;
    const data = writeQueue.shift()!;
    writeChunked(term, data, () => drainWriteQueue(term));
  }

  function scheduleWrite(term: any, data: string) {
    writeQueue.push(data);
    if (!writeActive) drainWriteQueue(term);
  }

  function flushOutput(term: any) {
    if (outputBuffer.length === 0) return;
    const data = outputBuffer.join('');
    outputBuffer = [];
    outputSize = 0;
    flushTimer = null;
    microtaskScheduled = false;
    scheduleWrite(term, data);
  }

  function enqueueOutput(term: any, data: string) {
    outputBuffer.push(data);
    outputSize += data.length;
    if (outputSize < MICROTASK_THRESHOLD) {
      if (!microtaskScheduled) {
        microtaskScheduled = true;
        queueMicrotask(() => flushOutput(term));
      }
    } else {
      if (!flushTimer) {
        flushTimer = setTimeout(() => flushOutput(term), 2);
      }
    }
  }

  // Chunked write — prevents Safari/iPad main thread block on large ANSI state blobs (v2 lesson)
  const CHUNK_SIZE = 6144; // 6 KB per frame
  function writeChunked(term: any, data: string, onDone?: () => void) {
    if (data.length <= CHUNK_SIZE) {
      term.write(data);
      onDone?.();
      return;
    }
    let offset = 0;
    function next() {
      const chunk = data.slice(offset, offset + CHUNK_SIZE);
      if (!chunk) { onDone?.(); return; }
      term.write(chunk);
      offset += CHUNK_SIZE;
      if (offset < data.length) setTimeout(next, 0);
      else {
        // Force repaint after chunked write — xterm holds the data but won't
        // paint it without this when the terminal was hidden during the writes.
        // Use setTimeout here too: rAF is suppressed during SvelteKit navigation
        // which would leave scrollback written to the buffer but never painted.
        setTimeout(() => { term.refresh(0, term.rows - 1); onDone?.(); }, 0);
      }
    }
    setTimeout(next, 0);
  }

  async function sendSlowEdit(term: any, socket: WebSocket) {
    if (!slowEditText.trim() || socket.readyState !== WebSocket.OPEN) return;
    const text = slowEditText.endsWith('\n') ? slowEditText.slice(0, -1) : slowEditText;
    // Two-call protocol: text then Enter with a gap (v2 lesson — prevents bracketed paste issues)
    socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: text }));
    await new Promise(r => setTimeout(r, 5));
    socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data: '\r' }));
    slowEditText = '';
    slowEdit = false;
    requestAnimationFrame(() => term.focus());
  }

  onMount(() => {
    if (!browser || !termRef) return;

    // Dynamic imports require async, but onMount cleanup must be returned synchronously.
    // Capture the teardown in a closure so Svelte can call it on destroy.
    let destroyFn: (() => void) | undefined;
    (async () => {

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { SerializeAddon } = await import('@xterm/addon-serialize');
    await import('@xterm/xterm/css/xterm.css');

    // iOS/mobile Safari: use system monospace — JetBrains Mono isn't available and causes metric issues
    const isMobile = /iPhone|iPad|iPod|Android/i.test(navigator.userAgent);
    const fontFamily = isMobile
      ? 'ui-monospace, "SF Mono", Menlo, monospace'
      : '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace';

    const term = new Terminal({
      fontFamily,
      fontSize: isMobile ? 12 : 13,
      lineHeight: 1.3,
      cursorBlink: true,
      cursorStyle: 'block',
      allowTransparency: true,
      macOptionIsMeta: true,     // Option → Meta/Alt for word-jump (Option+B/F) in bash/vim
      allowProposedApi: true,    // Required for SerializeAddon
      scrollback: 5000,
      rightClickSelectsWord: true,
      theme: {
        background: '#0D0D12',
        foreground: '#E0E0E0',
        cursor: '#22C55E',
        selectionBackground: '#6366F150',
        black: '#1E1E24',
        red: '#EF4444',
        green: '#22C55E',
        yellow: '#F59E0B',
        blue: '#6366F1',
        magenta: '#AB47BC',
        cyan: '#26A69A',
        white: '#E0E0E0',
        brightBlack: '#78909C',
        brightRed: '#EF5350',
        brightGreen: '#66BB6A',
        brightYellow: '#FFC107',
        brightBlue: '#42A5F5',
        brightMagenta: '#CE93D8',
        brightCyan: '#4DB6AC',
        brightWhite: '#FFFFFF',
      },
    });

    const fitAddon = new FitAddon();
    const serializeAddon = new SerializeAddon();
    term.loadAddon(fitAddon);
    term.loadAddon(serializeAddon);

    // DOM renderer only — WebGL glyph atlas can build before the font is ready,
    // producing garbled/replacement-character output on first render.

    term.open(termRef);
    term.focus(); // Must call after open() — arrows/Tab stop working without this (v2 lesson)
    terminal = term;

    // Wire scroll position to the custom scroll track
    term.onScroll(() => {
      const buf = term.buffer.active;
      scrollRatio = buf.baseY > 0 ? buf.viewportY / buf.baseY : 1;
    });

    // Click anywhere in the terminal container to restore keyboard focus + trigger SIGWINCH
    // repaint. This handles "click off and click back within the same page" where
    // visibilitychange doesn't fire but the xterm buffer may need refreshing.
    termRef.addEventListener('click', () => {
      term.focus();
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminal_resize', sessionId, cols: term.cols, rows: term.rows }));
      }
    });

    // WebSocket connection — extracted to a function so reconnects reuse all handlers
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      const socket = new WebSocket(`${protocol}//${location.host}/ws`);
      ws = socket;

      // If session_health isn't received within 3s the server likely dropped our
      // join_session (race during async connection handler setup). Close to trigger
      // the 2s reconnect cycle, which sends a fresh join_session.
      let healthReceived = false;
      const healthTimeout = setTimeout(() => {
        if (!healthReceived && !destroyed) {
          console.warn('[ant] session_health not received — reconnecting');
          socket.close();
        }
      }, 8000);

      socket.onopen = () => {
        // Clear any stale write queue from the previous connection so old scrollback
        // chunks don't interleave with the fresh scrollback about to arrive.
        writeQueue = [];
        writeActive = false;
        // spawnPty: true tells the server to start/attach the PTY daemon session.
        // Passing actual cols/rows ensures the PTY is spawned at the right size —
        // fitAddon.fit() has already run by this point (connect() is called after term.open()).
        socket.send(JSON.stringify({ type: 'join_session', sessionId, spawnPty: true, cols: term.cols, rows: term.rows }));
        // Force-repaint 600ms after connect: covers SvelteKit client-side navigation where
        // the browser suppresses requestAnimationFrame during the route transition. xterm uses
        // rAF internally so term.write() content can land in the DOM without ever being painted.
        // Accessing offsetHeight forces a synchronous layout, then refresh() repaints all rows.
        setTimeout(() => {
          if (term.element) {
            term.element.offsetHeight; // synchronous layout invalidation
            term.refresh(0, term.rows - 1);
          }
        }, 600);
      };

      socket.onerror = () => {
        clearTimeout(healthTimeout);
        term.writeln('\r\n\x1b[31m✗ WebSocket connection failed.\x1b[0m');
        term.writeln('\x1b[90mRetrying in 2s…\x1b[0m\r\n');
      };

      socket.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
            enqueueOutput(term, msg.data);
            onData?.(msg.data);
          } else if (msg.type === 'session_health' && msg.sessionId === sessionId) {
            healthReceived = true;
            clearTimeout(healthTimeout);
            if (!msg.alive) {
              term.writeln('\r\n\x1b[31m✗ PTY session failed to start.\x1b[0m');
              term.writeln('\x1b[90mThe daemon may be unreachable. Click the refresh button (↻) to retry.\x1b[0m\r\n');
            }
          } else if (msg.type === 'build_id') {
            const stored = sessionStorage.getItem('ant-build-id');
            if (!stored) {
              sessionStorage.setItem('ant-build-id', msg.buildId);
            } else if (stored !== msg.buildId) {
              console.warn('[ant] Server build changed — reloading');
              sessionStorage.setItem('ant-build-id', msg.buildId);
              setTimeout(() => window.location.reload(), 200);
            }
          }
        } catch {}
      };

      // Reconnect on close — unless the component was torn down
      socket.onclose = () => {
        clearTimeout(healthTimeout);
        if (!destroyed) setTimeout(connect, 2000);
      };
    }

    // Forward user input — always reads ws at call-time so reconnects work (v2 lesson fix)
    term.onData((data: string) => {
      if (slowEdit) return; // Slow edit captures input separately
      if (TERM_RESPONSE_RE.test(data)) return; // Block DA1/DA2/DSR cursor reports
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'terminal_input', sessionId, data }));
      }
    });

    // Connect only after the container has a real height — on SvelteKit client-side
    // navigation the flex layout hasn't resolved when onMount runs, so fitAddon.fit()
    // would compute 0 cols/rows. The scrollback would then land in a mis-sized terminal
    // and never repaint. Waiting for the first ResizeObserver entry with clientHeight > 0
    // guarantees layout has settled before we spawn the PTY or replay scrollback.
    let initialConnectDone = false;
    const resizeObserver = new ResizeObserver(() => {
      if (!initialConnectDone && termRef!.clientHeight > 0) {
        initialConnectDone = true;
        fitAddon.fit();
        connect();
      } else if (initialConnectDone) {
        fitAddon.fit();
      }
      if (ws?.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: 'terminal_resize',
          sessionId,
          cols: term.cols,
          rows: term.rows,
        }));
      }
    });
    resizeObserver.observe(termRef);

    // Tab restore: repaint xterm and force SIGWINCH so the shell redraws its current state.
    // term.refresh() only repaints the existing xterm buffer — if the buffer is blank/stale
    // the screen stays blank. Sending terminal_resize triggers SIGWINCH which causes the
    // shell (or any foreground TUI) to emit a fresh repaint.
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestAnimationFrame(() => {
          fitAddon.fit();
          term.refresh(0, term.rows - 1);
          // Force shell repaint regardless of WS state
          if (ws?.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'terminal_resize', sessionId, cols: term.cols, rows: term.rows }));
          }
        });
        if (ws && ws.readyState !== WebSocket.OPEN) {
          ws.close(); // triggers onclose → reconnect
        }
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

      destroyFn = () => {
        destroyed = true;
        resizeObserver.disconnect();
        document.removeEventListener('visibilitychange', handleVisibility);
        ws?.close();
        term.dispose();
      };
    })();

    return () => destroyFn?.();
  });
</script>

<div class="w-full flex-1 min-h-0 flex flex-col">
  <!-- 1. tmux status bar -->
  <div class="flex items-center justify-between px-2 h-[22px] bg-[#22C55E] text-[#0D0D12] text-[10px] font-mono shrink-0">
    <span>[{sessionId.slice(0,10)}*]</span>
    <span>{paneTitle || sessionId} {new Date().toLocaleTimeString('en-GB', {hour:'2-digit',minute:'2-digit'})}</span>
  </div>

  <!-- 2. Terminal + scroll track -->
  <div class="flex flex-1 min-h-0">
    <!-- xterm.js container -->
    <div bind:this={termRef} class="flex-1 min-h-0" class:opacity-30={slowEdit}></div>

    <!-- Scroll track -->
    <div class="w-8 bg-[#111318] relative shrink-0" class:opacity-30={slowEdit}>
      <div
        class="absolute left-1 w-6 rounded-xl bg-[#30363D] hover:bg-[#4B5563] cursor-grab transition-colors"
        style="top: {scrollThumbTop}px; height: {scrollThumbHeight}px; touch-action: none;"
        onpointerdown={startScrollDrag}
      ></div>
    </div>
  </div>

  <!-- 3. Special keys row -->
  <div class="flex items-center gap-1.5 px-2 h-9 bg-[#111318] overflow-x-auto shrink-0 scrollbar-none">
    {#each specialKeys as key}
      <button
        onclick={() => sendKey(key.seq)}
        class="shrink-0 px-3 py-1.5 rounded-md bg-[#1E2228] text-xs text-[#8B949E] hover:bg-[#2A2F38] active:bg-[#363B44] transition-colors"
      >{key.label}</button>
    {/each}
  </div>

  <!-- 4. Slow Edit panel -->
  {#if slowEdit}
    <div class="bg-[#161B22] rounded-t-xl px-3 py-3 flex flex-col gap-2 shrink-0" transition:slide={{ duration: 200 }}>
      <div class="flex items-center justify-between">
        <span class="text-xs font-semibold text-white">Slow Edit</span>
        <button onclick={() => { slowEdit = false; requestAnimationFrame(() => terminal?.focus()); }} class="text-sm text-[#8B949E]">✕</button>
      </div>
      <textarea
        class="bg-[#1E2228] text-white font-mono text-sm p-3 rounded-lg border border-[#3B82F6] resize-none focus:outline-none min-h-[80px] max-h-[120px]"
        placeholder="Type your command..."
        bind:value={slowEditText}
        bind:this={slowEditRef}
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (ws) sendSlowEdit(terminal, ws);
          }
          if (e.key === 'Escape') { slowEdit = false; requestAnimationFrame(() => terminal?.focus()); }
        }}
      ></textarea>
      <span class="text-[11px] text-[#8B949E]">Paste, type, or use voice — then tap Send</span>
    </div>
  {/if}

  <!-- 5. Input row -->
  <div class="flex items-center gap-1.5 px-2 py-1.5 bg-[#0D0D12] shrink-0">
    <!-- Back -->
    <button onclick={() => history.back()} class="w-[34px] h-[34px] rounded-lg bg-[#1E2228] flex items-center justify-center text-[#8B949E] hover:bg-[#2A2F38]">←</button>

    <!-- Input pill (tap target for slow edit) -->
    <button
      onclick={() => { slowEdit = true; }}
      class="flex-1 h-[34px] rounded-full bg-[#1E2228] px-3 text-left text-sm truncate"
      class:text-[#8B949E]={!slowEditText}
      class:text-[#E6EDF3]={!!slowEditText}
      class:ring-1={slowEdit}
      class:ring-[#3B82F6]={slowEdit}
    >{slowEditText || 'Type a command...'}</button>

    <!-- Attach -->
    <button class="w-[34px] h-[34px] rounded-lg bg-[#1E2228] flex items-center justify-center text-[#8B949E]">📎</button>

    <!-- Chat switcher -->
    <button onclick={() => { /* TODO: dispatch switchToChat event */ }} class="h-[34px] rounded-lg bg-[#1E2228] px-2.5 flex items-center gap-1 text-xs text-[#8B949E]">💬 Chat</button>

    <!-- Send -->
    <button
      onclick={() => { if (ws && slowEditText) sendSlowEdit(terminal, ws); }}
      class="w-[34px] h-[34px] rounded-full flex items-center justify-center text-white font-bold"
      class:bg-[#3B82F6]={!slowEditText}
      class:bg-[#22C55E]={!!slowEditText}
    >↑</button>
  </div>
</div>
