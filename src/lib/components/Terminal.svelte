<script lang="ts">
  import { onMount } from 'svelte';
  import { browser } from '$app/environment';

  let { sessionId, onData }: { sessionId: string; onData?: (data: string) => void } = $props();

  let termRef = $state<HTMLDivElement | undefined>();
  let terminal: any = $state(null);
  let ws: WebSocket | null = $state(null);
  let slowEdit = $state(false);
  let slowEditText = $state('');

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

  function flushOutput(term: any) {
    if (outputBuffer.length === 0) return;
    const data = outputBuffer.join('');
    outputBuffer = [];
    outputSize = 0;
    flushTimer = null;
    microtaskScheduled = false;
    writeChunked(term, data);
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
      if (offset < data.length) requestAnimationFrame(next);
      else onDone?.();
    }
    requestAnimationFrame(next);
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

  onMount(async () => {
    if (!browser || !termRef) return;

    const { Terminal } = await import('@xterm/xterm');
    const { FitAddon } = await import('@xterm/addon-fit');
    const { SerializeAddon } = await import('@xterm/addon-serialize');
    await import('@xterm/xterm/css/xterm.css');

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Fira Code", "Cascadia Code", monospace',
      fontSize: 13,
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

    try {
      const { WebglAddon } = await import('@xterm/addon-webgl');
      term.loadAddon(new WebglAddon());
    } catch {
      // Canvas fallback for Safari/WebKit
    }

    term.open(termRef);
    fitAddon.fit();
    term.focus(); // Must call after open() — arrows/Tab stop working without this (v2 lesson)
    terminal = term;

    // Click anywhere in the terminal container to restore keyboard focus (v2 lesson)
    termRef.addEventListener('click', () => term.focus());

    // WebSocket connection
    const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
    const socket = new WebSocket(`${protocol}//${location.host}/ws`);
    ws = socket;

    socket.onopen = () => {
      socket.send(JSON.stringify({ type: 'join_session', sessionId }));
    };

    socket.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'terminal_output' && msg.sessionId === sessionId) {
          enqueueOutput(term, msg.data);
          onData?.(msg.data);
        }
      } catch {}
    };

    socket.onclose = () => {
      setTimeout(() => {
        if (termRef) {
          const newSocket = new WebSocket(`${protocol}//${location.host}/ws`);
          newSocket.onopen = () => {
            newSocket.send(JSON.stringify({ type: 'join_session', sessionId }));
          };
          newSocket.onmessage = socket.onmessage;
          ws = newSocket;
        }
      }, 2000);
    };

    // Forward user input — filter xterm auto-responses to prevent PTY feedback loop (v2 lesson)
    term.onData((data: string) => {
      if (slowEdit) return; // Slow edit captures input separately
      if (TERM_RESPONSE_RE.test(data)) return; // Block DA1/DA2/DSR cursor reports
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'terminal_input', sessionId, data }));
      }
    });

    // Handle resize
    const resizeObserver = new ResizeObserver(() => {
      fitAddon.fit();
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({
          type: 'terminal_resize',
          sessionId,
          cols: term.cols,
          rows: term.rows,
        }));
      }
    });
    resizeObserver.observe(termRef);

    // iPad wake/sleep reconnection
    const handleVisibility = () => {
      if (document.visibilityState === 'visible' && socket.readyState !== WebSocket.OPEN) {
        socket.close();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      resizeObserver.disconnect();
      document.removeEventListener('visibilitychange', handleVisibility);
      socket.close();
      term.dispose();
    };
  });
</script>

<div class="w-full h-full min-h-0 relative flex flex-col">
  <!-- xterm.js container — dimmed when Slow Edit is active -->
  <div bind:this={termRef} class="w-full flex-1 min-h-0" class:opacity-30={slowEdit}></div>

  <!-- Slow Edit overlay — compose large/multi-line input before sending (v2 lesson) -->
  {#if slowEdit}
    <div class="absolute inset-0 bottom-8 flex flex-col bg-[#0D0D12]/95 p-3 gap-2">
      <div class="flex items-center gap-2 text-xs text-gray-400 mb-1">
        <span class="text-yellow-400 font-mono">✎</span>
        <span>Slow Edit — compose then send with Ctrl+Enter</span>
      </div>
      <textarea
        class="flex-1 bg-[#1A1A22] text-white font-mono text-sm p-3 rounded-lg border border-[#6366F1] resize-none focus:outline-none focus:ring-2 focus:ring-[#6366F1]"
        placeholder="Type your command here..."
        bind:value={slowEditText}
        onkeydown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            if (ws) sendSlowEdit(terminal, ws);
          }
          if (e.key === 'Escape') {
            slowEdit = false;
            requestAnimationFrame(() => terminal?.focus());
          }
        }}
        autofocus
      ></textarea>
      <div class="flex gap-2 text-xs text-gray-500">
        <kbd class="px-1.5 py-0.5 bg-[#1A1A22] rounded border border-[var(--border-subtle)]">Ctrl+Enter</kbd>
        <span>send</span>
        <span class="mx-2">·</span>
        <kbd class="px-1.5 py-0.5 bg-[#1A1A22] rounded border border-[var(--border-subtle)]">Esc</kbd>
        <span>cancel</span>
      </div>
    </div>
  {/if}

  <!-- Bottom bar: Slow Edit toggle -->
  <div class="flex items-center gap-2 px-2 py-1 bg-[#16161A] border-t border-[var(--border-subtle)]">
    <button
      onclick={() => {
        slowEdit = !slowEdit;
        if (!slowEdit) requestAnimationFrame(() => terminal?.focus());
      }}
      class="flex items-center gap-1.5 px-2 py-0.5 text-xs rounded transition-all"
      class:bg-yellow-500={slowEdit}
      class:text-black={slowEdit}
      class:text-gray-500={!slowEdit}
      class:hover:text-gray-300={!slowEdit}
      title="Toggle Slow Edit for paste or multi-line commands"
    >
      <span>✎</span>
      <span>Slow Edit</span>
    </button>
  </div>
</div>
