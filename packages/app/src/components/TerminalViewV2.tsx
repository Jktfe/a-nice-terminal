import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import { Unicode11Addon } from "@xterm/addon-unicode11";
import { SerializeAddon } from "@xterm/addon-serialize";
import { io as ioConnect, type Socket as IOSocket } from "socket.io-client";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, ChevronDown, Clipboard, Check, Edit3, Send, Search, X, Clock } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";
import { getTerminalTheme } from "../themes.ts";
import BridgePicker from "./BridgePicker.tsx";

// Matches terminal-emitted response sequences (DA1, DA2, DSR, cursor position).
// Used to block xterm.js auto-responses from reaching the PTY via onData.
const TERM_RESPONSE_RE = /^\x1b\[\??[>]?[\d;]*c$|^\x1b\[\d+;\d+[Rn]$|^\x1b\[\d*n$/;

// Adaptive flush threshold: below this, use microtask (near-zero latency);
// above this, coalesce for 2ms to batch bulk output.
const MICROTASK_THRESHOLD = 256;

// Singleton terminal namespace socket — shared across all TerminalViewV2 instances
const API_KEY = (import.meta.env.VITE_ANT_API_KEY as string | undefined)?.trim();
let termSocket: IOSocket | null = null;

function getTermSocket(): IOSocket {
  if (!termSocket) {
    termSocket = ioConnect("/terminal", {
      transports: ["websocket"], // skip HTTP polling
      auth: API_KEY ? { apiKey: API_KEY } : undefined,
      query: API_KEY ? { apiKey: API_KEY } : undefined,
    });
  }
  return termSocket;
}

interface SearchResult {
  index: number;
  data: string;
  created_at?: string;
}

export default function TerminalViewV2({ sessionId: sessionIdProp }: { sessionId?: string } = {}) {
  const { activeSessionId: storeActiveSessionId, socket, uploadFile, connected, sessionHealth, terminalFontSize, terminalTheme, sessions, loadSessions } = useStore();
  const activeSessionId = sessionIdProp ?? storeActiveSessionId;
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const serializeAddonRef = useRef<SerializeAddon | null>(null);

  // Adaptive output buffer
  const outputBufferRef = useRef<string[]>([]);
  const outputBufferSizeRef = useRef(0);
  const outputFlushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const outputMicrotaskScheduledRef = useRef(false);

  const slowEditModeRef = useRef(false);
  const slowEditInputRef = useRef<HTMLTextAreaElement>(null);
  const prevConnectedRef = useRef(connected);

  // Resize guard: track last emitted cols/rows to avoid no-op resizes
  const lastEmittedSizeRef = useRef<{ cols: number; rows: number }>({ cols: 0, rows: 0 });

  const [refreshing, setRefreshing] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [slowEditMode, setSlowEditMode] = useState(false);
  const [slowEditInput, setSlowEditInput] = useState("");
  const [commandRunning, setCommandRunning] = useState(false);
  const quietTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchStart, setSearchStart] = useState("");
  const [searchEnd, setSearchEnd] = useState("");
  const [searchPad, setSearchPad] = useState("15");
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [copied, setCopied] = useState(false);
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [bridgeOpen, setBridgeOpen] = useState(false);
  const [bridgeText, setBridgeText] = useState("");
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleRefresh = async () => {
    if (!activeSessionId || !termRef.current || refreshing) return;
    setRefreshing(true);
    try {
      const result = await apiFetch(
        `/api/sessions/${activeSessionId}/terminal/state?format=ansi`
      );
      if (termRef.current && activeSessionId === result.sessionId) {
        termRef.current.reset();
        termRef.current.write(result.state);
      }
    } catch {
      // silently ignore — live socket output continues regardless
    } finally {
      setRefreshing(false);
    }
  };

  const scrollToBottom = useCallback(() => {
    termRef.current?.scrollToBottom();
    setShowScrollButton(false);
  }, []);

  useEffect(() => {
    slowEditModeRef.current = slowEditMode;
    if (slowEditMode) {
      requestAnimationFrame(() => slowEditInputRef.current?.focus());
    } else {
      requestAnimationFrame(() => termRef.current?.focus());
    }
  }, [slowEditMode]);

  // Adaptive output flushing
  const flushOutputBuffer = useCallback(() => {
    outputFlushTimerRef.current = null;
    outputMicrotaskScheduledRef.current = false;
    const term = termRef.current;
    const chunk = outputBufferRef.current.join("");
    outputBufferRef.current = [];
    outputBufferSizeRef.current = 0;

    if (!term || !chunk) return;
    term.write(chunk);
  }, []);

  const sendSlowEditInput = useCallback(() => {
    if (!activeSessionId) return;
    const payload = slowEditInput.endsWith("\n") ? slowEditInput : `${slowEditInput}\n`;
    const hasText = payload.trim().length > 0;
    if (!hasText) return;

    const ts = getTermSocket();
    const encoded = new TextEncoder().encode(payload);
    ts.emit("in", { sid: activeSessionId, d: encoded });
    setSlowEditInput("");
  }, [activeSessionId, slowEditInput]);

  const onCopySelection = useCallback(async () => {
    const selected = termRef.current?.getSelection();
    if (!selected) return;
    try {
      await navigator.clipboard.writeText(selected);
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
      setCopied(true);
      copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
    } catch (error) {
      console.error("Failed to copy terminal selection", error);
    }
  }, []);

  const runTerminalSearch = useCallback(async () => {
    if (!activeSessionId) return;

    const q = searchQuery.trim();
    const start = searchStart.trim();
    const end = searchEnd.trim();
    const hasQuery = q.length > 0;
    const hasStart = start.length > 0;
    const hasEnd = end.length > 0;

    if (!hasQuery && !(hasStart && hasEnd)) {
      setSearchError("Provide a query or both start and end time.");
      return;
    }

    if (hasStart !== hasEnd) {
      setSearchError("Both start and end are required when filtering by time.");
      return;
    }

    const params = new URLSearchParams();
    if (hasQuery) params.set("q", q);
    if (hasStart && hasEnd) {
      params.set("start", start);
      params.set("end", end);
    }
    const pad = Number(searchPad);
    if (Number.isFinite(pad)) {
      const safePad = Math.max(0, Math.min(Math.floor(pad), 120));
      params.set("pad", String(safePad));
    }

    setSearching(true);
    setSearchError("");

    try {
      const result = await apiFetch(
        `/api/sessions/${activeSessionId}/terminal/search?${params.toString()}`
      );
      setSearchResults((result.events ?? []) as SearchResult[]);
    } catch (error) {
      console.error("Failed terminal search", error);
      setSearchResults([]);
      setSearchError("Search failed. Check the time format and try again.");
    } finally {
      setSearching(false);
    }
  }, [activeSessionId, searchPad, searchEnd, searchQuery, searchStart]);

  const clearSearch = () => {
    setSearchQuery("");
    setSearchStart("");
    setSearchEnd("");
    setSearchPad("15");
    setSearchError("");
    setSearchResults([]);
  };

  useEffect(() => {
    clearSearch();
  }, [activeSessionId]);

  // Replay terminal output after a socket reconnect so xterm state is restored
  useEffect(() => {
    const wasDisconnected = !prevConnectedRef.current;
    prevConnectedRef.current = connected;

    if (connected && wasDisconnected && activeSessionId && termRef.current) {
      setRefreshing(true);
      apiFetch(`/api/sessions/${activeSessionId}/terminal/state?format=ansi`)
        .then((result) => {
          if (termRef.current && activeSessionId === result.sessionId) {
            termRef.current.reset();
            termRef.current.write(result.state);
          }
        })
        .finally(() => setRefreshing(false));
    }
  }, [connected, activeSessionId]);

  // Poll dtach session liveness so we can show a "session ended" banner.
  useEffect(() => {
    if (!activeSessionId || !socket) return;
    let interval: ReturnType<typeof setInterval> | null = null;

    const start = () => {
      if (interval) return;
      interval = setInterval(() => {
        socket.emit("check_health", { sessionId: activeSessionId });
      }, 30_000);
    };
    const stop = () => {
      if (interval) { clearInterval(interval); interval = null; }
    };
    const onVisibility = () => document.hidden ? stop() : start();

    if (!document.hidden) start();
    document.addEventListener("visibilitychange", onVisibility);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [activeSessionId, socket]);

  const isSessionDead = activeSessionId ? sessionHealth[activeSessionId] === false : false;

  const restartSession = useCallback(async () => {
    if (!activeSessionId || !socket) return;
    socket.emit("leave_session", { sessionId: activeSessionId });
    socket.emit("join_session", { sessionId: activeSessionId });
    useStore.setState((s) => ({
      sessionHealth: { ...s.sessionHealth, [activeSessionId]: true },
    }));
  }, [activeSessionId, socket]);

  useEffect(() => {
    if (!containerRef.current || !socket || !activeSessionId) return;

    const container = containerRef.current;
    outputBufferRef.current = [];
    outputBufferSizeRef.current = 0;

    // Get dedicated terminal namespace socket for binary I/O
    const ts = getTermSocket();

    const term = new Terminal({
      cursorBlink: true,
      fontSize: terminalFontSize,
      fontFamily: '"JetBrains Mono", monospace',
      theme: getTerminalTheme(terminalTheme),
      scrollback: 10000,
      allowProposedApi: true,
      // No convertEol — shell/dtach already sends CRLF
    });

    const fitAddon = new FitAddon();
    const unicode11Addon = new Unicode11Addon();
    const serializeAddon = new SerializeAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(unicode11Addon);
    term.loadAddon(serializeAddon);
    term.unicode.activeVersion = "11";

    termRef.current = term;
    fitAddonRef.current = fitAddon;
    serializeAddonRef.current = serializeAddon;

    // Wait for container to have dimensions before opening xterm.
    let initAttempts = 0;
    let initPollTimer: ReturnType<typeof setTimeout> | null = null;

    const tryInit = () => {
      initAttempts++;
      if (container.offsetWidth && container.offsetHeight) {
        openTerminal();
      } else if (initAttempts < 20) {
        initPollTimer = setTimeout(tryInit, 50);
      } else {
        openTerminal(); // Last resort
      }
    };

    function openTerminal() {
      term.open(container);
      term.focus();

      // Try WebGL renderer, fall back to canvas
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        term.loadAddon(webglAddon);
      } catch {
        // WebGL not available — canvas renderer is fine
        console.warn("[TerminalV2] WebGL not available, using canvas renderer");
      }

      try { fitAddon.fit(); } catch {}
      emitResize();

      // Fetch existing terminal state after resize propagates.
      // For established sessions this provides instant restore; for brand-new
      // sessions the shell prompt appears via live output (click Refresh if needed
      // due to potential rendering timing).
      setTimeout(() => {
        if (!termRef.current) return;
        setRefreshing(true);
        apiFetch(`/api/sessions/${activeSessionId}/terminal/state?format=ansi`)
          .then((result) => {
            if (termRef.current && activeSessionId === result.sessionId && result.state) {
              termRef.current.reset();
              termRef.current.write(result.state);
            }
          })
          .catch(() => {
            // State fetch failed (e.g. archived session with no live PTY).
            // Fall back to replaying historical output from the DB.
            if (!termRef.current) return;
            apiFetch(`/api/sessions/${activeSessionId}/terminal/output?limit=5000`)
              .then((result) => {
                if (!termRef.current || activeSessionId !== result.sessionId) return;
                const events = result.events || [];
                if (events.length > 0) {
                  termRef.current.reset();
                  for (const evt of events) {
                    termRef.current.write(evt.data);
                  }
                }
              })
              .catch(() => {});
          })
          .finally(() => setRefreshing(false));
      }, 150);
    }

    const initTimer = requestAnimationFrame(tryInit);

    // Scroll: use xterm's onScroll API instead of manual viewport listener
    const scrollDisposable = term.onScroll(() => {
      const buffer = term.buffer.active;
      const isAtBottom = buffer.viewportY >= buffer.baseY;
      setShowScrollButton(!isAtBottom);
    });

    // Also track when user writes (output received), check scroll position
    const writeDisposable = term.onWriteParsed(() => {
      const buffer = term.buffer.active;
      // If user was at the bottom before write, they stay there (xterm auto-scrolls).
      // Only show button if viewport is away from bottom.
      const isAtBottom = buffer.viewportY >= buffer.baseY;
      if (!isAtBottom) {
        setShowScrollButton(true);
      }
    });

    function emitResize() {
      const { cols, rows } = term;
      // Only emit if dimensions actually changed
      if (cols === lastEmittedSizeRef.current.cols && rows === lastEmittedSizeRef.current.rows) return;
      lastEmittedSizeRef.current = { cols, rows };
      ts.emit("resize", { sid: activeSessionId, cols, rows });
    }

    // Join the terminal namespace room
    ts.emit("join", { sid: activeSessionId });

    // Send terminal input via terminal namespace (binary)
    const dataDisposable = term.onData((data) => {
      if (slowEditModeRef.current) return;
      if (TERM_RESPONSE_RE.test(data)) return;
      // Track whether a command is running (Enter → running, 2s quiet → idle)
      if (data.includes("\r") || data.includes("\n")) {
        setCommandRunning(true);
      }
      // Send as Uint8Array for binary transport
      const encoded = new TextEncoder().encode(data);
      ts.emit("in", { sid: activeSessionId, d: encoded });
    });

    // Receive terminal output via terminal namespace — adaptive flushing
    const handleOutput = ({
      sid,
      d,
    }: {
      sid: string;
      d: ArrayBuffer | Uint8Array | string;
    }) => {
      if (sid !== activeSessionId) return;
      // Decode binary payload to string for xterm.write()
      let data: string;
      if (typeof d === "string") {
        data = d;
      } else {
        data = new TextDecoder().decode(d);
      }
      outputBufferRef.current.push(data);
      outputBufferSizeRef.current += data.length;

      if (outputBufferSizeRef.current < MICROTASK_THRESHOLD) {
        // Small output (keystroke echo): flush via microtask for near-zero latency
        if (!outputMicrotaskScheduledRef.current) {
          outputMicrotaskScheduledRef.current = true;
          queueMicrotask(flushOutputBuffer);
        }
      } else {
        // Bulk output: coalesce for 2ms
        if (outputMicrotaskScheduledRef.current) {
          // Cancel pending microtask by marking it as handled
          outputMicrotaskScheduledRef.current = false;
        }
        if (outputFlushTimerRef.current === null) {
          outputFlushTimerRef.current = setTimeout(flushOutputBuffer, 2);
        }
      }

      // Reset the "command running" quiet timer on each output chunk
      if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
      quietTimerRef.current = setTimeout(() => {
        setCommandRunning(false);
      }, 2000);
    };

    ts.on("out", handleOutput);

    // Listen for command lifecycle events from the terminal namespace
    const handleCmdStart = ({ sid, command }: { sid: string; command: string }) => {
      if (sid !== activeSessionId) return;
      setCommandRunning(true);
    };
    const handleCmdEnd = ({ sid }: { sid: string; command: string; exitCode: number; durationMs: number }) => {
      if (sid !== activeSessionId) return;
      setCommandRunning(false);
    };
    ts.on("cmd_start", handleCmdStart);
    ts.on("cmd_end", handleCmdEnd);

    // Observe container size changes with resize guard
    let resizeDebounce: ReturnType<typeof setTimeout> | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (resizeDebounce) clearTimeout(resizeDebounce);
      resizeDebounce = setTimeout(() => {
        try { fitAddon.fit(); } catch {}
        emitResize();
      }, 50);
    });
    resizeObserver.observe(container);

    // Listen for CSS transition end (sidebar/split animations) to do a final fit
    const onTransitionEnd = (e: TransitionEvent) => {
      if (e.target === container || container.contains(e.target as Node)) {
        try { fitAddon.fit(); } catch {}
        emitResize();
      }
    };
    container.addEventListener("transitionend", onTransitionEnd);

    // Drag and drop support
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
    };

    const onDrop = async (e: DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      if (e.dataTransfer?.files?.length) {
        const files = Array.from(e.dataTransfer.files);
        for (const file of files) {
          if (file.type.startsWith("image/")) {
            try {
              const result = await uploadFile(file);
              const url = `${window.location.origin}${result.url}`;
              const encoded = new TextEncoder().encode(url);
              ts.emit("in", { sid: activeSessionId, d: encoded });
            } catch (err) {
              console.error("Failed to upload dropped file", err);
            }
          }
        }
      }
    };

    // Copy selected text on Ctrl+Shift+C / Cmd+Shift+C
    // Bridge shortcut: Cmd+Shift+S / Ctrl+Shift+S
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "C") {
        e.preventDefault();
        const selected = term.getSelection();
        if (selected) {
          navigator.clipboard.writeText(selected).then(() => {
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
            setCopied(true);
            copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
          }).catch(() => {});
        }
      }
      if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key === "S") {
        e.preventDefault();
        const selected = term.getSelection();
        if (selected) {
          setBridgeText(selected);
          setBridgeOpen(true);
        }
      }
    };
    container.addEventListener("keydown", onKeyDown);

    // Context menu for bridge
    const onContextMenu = (e: MouseEvent) => {
      const selected = term.getSelection();
      if (selected) {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY });
      }
    };
    container.addEventListener("contextmenu", onContextMenu);

    // Auto-copy: when mouse selection ends, copy to clipboard automatically
    const selectionDisposable = term.onSelectionChange(() => {
      const selected = term.getSelection();
      if (selected) {
        navigator.clipboard.writeText(selected).then(() => {
          if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current);
          setCopied(true);
          copiedTimerRef.current = setTimeout(() => setCopied(false), 1500);
        }).catch(() => {});
      }
    });

    container.addEventListener("dragover", onDragOver);
    container.addEventListener("drop", onDrop);

    return () => {
      cancelAnimationFrame(initTimer);
      if (initPollTimer) clearTimeout(initPollTimer);
      if (outputFlushTimerRef.current !== null) {
        clearTimeout(outputFlushTimerRef.current);
        outputFlushTimerRef.current = null;
      }
      outputMicrotaskScheduledRef.current = false;
      if (quietTimerRef.current) {
        clearTimeout(quietTimerRef.current);
        quietTimerRef.current = null;
      }
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("contextmenu", onContextMenu);
      container.removeEventListener("dragover", onDragOver);
      container.removeEventListener("drop", onDrop);
      container.removeEventListener("transitionend", onTransitionEnd);
      resizeObserver.disconnect();
      if (resizeDebounce) clearTimeout(resizeDebounce);
      ts.emit("leave", { sid: activeSessionId });
      ts.off("out", handleOutput);
      ts.off("cmd_start", handleCmdStart);
      ts.off("cmd_end", handleCmdEnd);
      scrollDisposable.dispose();
      writeDisposable.dispose();
      dataDisposable.dispose();
      selectionDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      serializeAddonRef.current = null;
      outputBufferRef.current = [];
      outputBufferSizeRef.current = 0;
      lastEmittedSizeRef.current = { cols: 0, rows: 0 };
      setShowScrollButton(false);
      setCommandRunning(false);
    };
  }, [activeSessionId, socket, uploadFile]);

  // Apply theme/font changes reactively without recreating terminal
  useEffect(() => {
    const term = termRef.current;
    if (!term?.options) return;
    term.options.theme = getTerminalTheme(terminalTheme);
    term.options.fontSize = terminalFontSize;
    try { fitAddonRef.current?.fit(); } catch {}
  }, [terminalTheme, terminalFontSize]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-end px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
        <div className="flex items-center gap-1.5 mr-2 text-[10px] uppercase tracking-widest text-white/40">
          {slowEditMode ? "Slow Edit ON" : commandRunning ? (
            <>
              <motion.span
                className="w-1.5 h-1.5 rounded-full bg-amber-400"
                animate={{ opacity: [1, 0.3, 1] }}
                transition={{ duration: 0.8, repeat: Infinity }}
              />
              Running
            </>
          ) : (
            <>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              Idle
            </>
          )}
        </div>
        <button
          onClick={() => setSlowEditMode((value) => !value)}
          className="flex items-center gap-1.5 px-2 py-1 text-white/40 hover:text-white/80 hover:bg-white/5 rounded transition-colors mr-2"
          title="Toggle Slow Edit mode"
        >
          <Edit3 className="w-3.5 h-3.5" />
          <span className="text-[10px] uppercase tracking-widest">Slow Edit</span>
        </button>
        <button
          onClick={() => setShowSearch((value) => !value)}
          className="flex items-center gap-1.5 px-2 py-1 text-white/40 hover:text-white/80 hover:bg-white/5 rounded transition-colors mr-2"
          title="Search terminal output"
        >
          <Search className="w-3.5 h-3.5" />
          <span className="text-[10px] uppercase tracking-widest">Search</span>
        </button>
        <button
          onClick={onCopySelection}
          className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors mr-2 ${copied ? "text-emerald-400" : "text-white/40 hover:text-white/80 hover:bg-white/5"}`}
          title="Copy selected terminal text (Ctrl+Shift+C)"
        >
          {copied ? <Check className="w-3.5 h-3.5" /> : <Clipboard className="w-3.5 h-3.5" />}
          <span className="text-[10px] uppercase tracking-widest">{copied ? "Copied" : "Copy"}</span>
        </button>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          title="Refresh terminal output"
          className="flex items-center gap-1.5 px-2 py-1 text-white/40 hover:text-white/80 hover:bg-white/5 rounded transition-colors disabled:opacity-40"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${refreshing ? "animate-spin" : ""}`} />
          <span className="text-[10px] uppercase tracking-widest">Refresh</span>
        </button>
        {activeSession?.type === "terminal" && (
          <div className="relative flex items-center ml-auto">
            <Clock className="w-3 h-3 text-white/30 absolute left-2 pointer-events-none" />
            <select
              value={activeSession.ttl_minutes === null ? "" : String(activeSession.ttl_minutes)}
              onChange={async (e) => {
                const val = e.target.value;
                const ttl = val === "" ? null : Number(val);
                await apiFetch(`/api/sessions/${activeSession.id}`, {
                  method: "PATCH",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify({ ttl_minutes: ttl }),
                });
                loadSessions();
              }}
              className="appearance-none pl-6 pr-6 py-1 rounded text-[10px] uppercase tracking-widest font-bold bg-white/5 text-white/50 hover:text-white/80 hover:bg-white/10 border border-white/10 cursor-pointer transition-colors"
              title="Session keep-alive duration"
            >
              <option value="">15m</option>
              <option value="5">5m</option>
              <option value="15">15m</option>
              <option value="30">30m</option>
              <option value="45">45m</option>
              <option value="60">1h</option>
              <option value="120">2h</option>
              <option value="0">AON</option>
            </select>
            <ChevronDown className="w-3 h-3 text-white/30 absolute right-1.5 pointer-events-none" />
          </div>
        )}
      </div>
      <div
        className="flex-1 overflow-hidden p-2 relative flex flex-col gap-2"
      >
        {activeSession?.archived ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs text-amber-300 flex items-center gap-2">
            <span>Archived — read-only view of historical output. Restore to interact.</span>
          </div>
        ) : null}

        {isSessionDead && (
          <div className="rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300 flex items-center justify-between">
            <span>Terminal session has ended.</span>
            <button
              onClick={restartSession}
              className="px-2 py-1 rounded bg-red-500/20 hover:bg-red-500/30 text-red-200 transition-colors"
            >
              Restart
            </button>
          </div>
        )}

        {showSearch && (
          <div className="rounded-lg border border-white/15 bg-[var(--color-surface)] p-2 text-xs text-white/80">
            <div className="flex items-center justify-between gap-2 mb-2">
              <div className="text-[10px] uppercase tracking-wider text-white/50">Terminal Search</div>
              <button
                onClick={clearSearch}
                className="inline-flex items-center gap-1 px-2 py-1 text-white/40 hover:text-white/70 hover:bg-white/5 rounded"
                title="Clear search"
              >
                <X className="w-3 h-3" />
                Clear
              </button>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-2 mb-2">
              <input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runTerminalSearch();
                }}
                placeholder="query"
                className="rounded border border-white/20 bg-[var(--color-bg)] px-2 py-1 text-sm text-white placeholder-white/40"
              />
              <input
                value={searchStart}
                onChange={(e) => setSearchStart(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runTerminalSearch();
                }}
                placeholder="start (HH, HH:mm, HH:mm:ss)"
                className="rounded border border-white/20 bg-[var(--color-bg)] px-2 py-1 text-sm text-white placeholder-white/40"
              />
              <input
                value={searchEnd}
                onChange={(e) => setSearchEnd(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") runTerminalSearch();
                }}
                placeholder="end (HH, HH:mm, HH:mm:ss)"
                className="rounded border border-white/20 bg-[var(--color-bg)] px-2 py-1 text-sm text-white placeholder-white/40"
              />
              <div className="flex items-center gap-2">
                <input
                  value={searchPad}
                  onChange={(e) => setSearchPad(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") runTerminalSearch();
                  }}
                  className="w-16 rounded border border-white/20 bg-[var(--color-bg)] px-2 py-1 text-sm text-white placeholder-white/40"
                  placeholder="pad"
                />
                <span className="text-[10px] text-white/50">±min</span>
                <button
                  onClick={runTerminalSearch}
                  disabled={searching}
                  className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30 disabled:opacity-40"
                >
                  {searching ? "Searching…" : "Run"}
                </button>
              </div>
            </div>
            {searchError && (
              <div className="text-[11px] text-red-400/90 mb-2">
                {searchError}
              </div>
            )}
            <div className="max-h-32 overflow-auto">
              {searchResults.length === 0 ? (
                <div className="text-white/40 text-[11px]">
                  No matches yet. Run a search to populate results.
                </div>
              ) : (
                <div className="space-y-2">
                  {searchResults.map((result) => (
                    <div
                      key={`${result.index}-${result.created_at ?? "no-ts"}`}
                      className="rounded border border-white/10 bg-black/20 p-2"
                    >
                      <div className="text-[10px] text-white/40 mb-1">
                        {result.created_at ? result.created_at : `chunk ${result.index}`}
                      </div>
                      <pre className="whitespace-pre-wrap text-[11px] leading-relaxed">
                        {result.data}
                      </pre>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        <div
          className="flex-1 min-h-0 relative"
          onClick={(e) => {
            if (termRef.current?.hasSelection()) return;
            if (slowEditMode) {
              slowEditInputRef.current?.focus();
            } else {
              termRef.current?.focus();
            }
          }}
        >
          <div
            ref={containerRef}
            className="w-full h-full terminal-container rounded-lg"
          />
        </div>

        <AnimatePresence>
          {copied && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              transition={{ duration: 0.15 }}
              className="absolute top-2 right-4 px-3 py-1.5 bg-emerald-500/20 text-emerald-300 text-xs rounded-lg backdrop-blur-sm shadow-lg pointer-events-none"
            >
              Copied to clipboard
            </motion.div>
          )}
        </AnimatePresence>

        <AnimatePresence>
          {showScrollButton && (
            <motion.button
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.15 }}
              onClick={scrollToBottom}
              className="absolute bottom-4 right-4 p-2 bg-emerald-500/20 text-emerald-400 rounded-full hover:bg-emerald-500/30 transition-colors shadow-lg backdrop-blur-sm"
              title="Scroll to bottom"
            >
              <ChevronDown className="w-5 h-5" />
            </motion.button>
          )}
        </AnimatePresence>

        {slowEditMode && (
          <div className="absolute inset-x-2 bottom-2 flex flex-col gap-2">
            <textarea
              ref={slowEditInputRef}
              value={slowEditInput}
              onChange={(e) => setSlowEditInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.shiftKey || e.metaKey)) {
                  e.preventDefault();
                  sendSlowEditInput();
                }
              }}
              rows={3}
              className="w-full rounded-lg border border-white/15 bg-[var(--color-bg)] px-3 py-2 text-sm text-white outline-none resize-y min-h-16"
              placeholder="Type command(s) here. Cmd+Enter or Shift+Enter sends to terminal."
            />
            <div className="flex items-center justify-end gap-2">
              <button
                onClick={sendSlowEditInput}
                disabled={!slowEditInput.trim()}
                className="inline-flex items-center gap-2 px-3 py-1.5 rounded-md text-xs text-emerald-300 bg-emerald-500/20 hover:bg-emerald-500/30 disabled:opacity-30 transition-colors"
              >
                <Send className="w-3.5 h-3.5" />
                Send
              </button>
            </div>
          </div>
        )}

        {/* Context menu for Send to Conversation */}
        {contextMenu && (
          <>
            <div
              className="fixed inset-0 z-40"
              onClick={() => setContextMenu(null)}
            />
            <div
              className="fixed z-50 bg-[#1a1a1a] border border-white/10 rounded-lg shadow-xl py-1 min-w-[180px]"
              style={{ left: contextMenu.x, top: contextMenu.y }}
            >
              <button
                onClick={() => {
                  const selected = termRef.current?.getSelection();
                  if (selected) {
                    setBridgeText(selected);
                    setBridgeOpen(true);
                  }
                  setContextMenu(null);
                }}
                className="w-full text-left px-3 py-2 text-sm text-white/80 hover:bg-white/10 transition-colors"
              >
                Send to Conversation
              </button>
            </div>
          </>
        )}

        {/* Bridge picker */}
        {bridgeOpen && activeSessionId && (
          <BridgePicker
            selectedText={bridgeText}
            sourceSessionId={activeSessionId}
            onClose={() => setBridgeOpen(false)}
          />
        )}
      </div>
    </div>
  );
}
