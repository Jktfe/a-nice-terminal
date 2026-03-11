import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, ChevronDown, Clipboard, Check, Edit3, Send, Search, X } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

interface SearchResult {
  index: number;
  data: string;
  created_at?: string;
}

export default function TerminalView() {
  const { activeSessionId, socket, uploadFile, connected, sessionHealth } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const outputBufferRef = useRef<string[]>([]);
  const outputFlushRafRef = useRef<number | null>(null);
  const slowEditModeRef = useRef(false);
  const slowEditInputRef = useRef<HTMLTextAreaElement>(null);
  const prevConnectedRef = useRef(connected);
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

  const handleRefresh = async () => {
    if (!activeSessionId || !termRef.current || refreshing) return;
    setRefreshing(true);
    try {
      const result = await apiFetch(
        `/api/sessions/${activeSessionId}/terminal/output?since=0`
      );
      termRef.current.reset();
      for (const event of result.events as { index: number; data: string }[]) {
        termRef.current.write(event.data);
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

  const flushOutputBuffer = useCallback(() => {
    outputFlushRafRef.current = null;
    const term = termRef.current;
    const chunk = outputBufferRef.current.join("");
    outputBufferRef.current = [];

    if (!term || !chunk) return;
    term.write(chunk);
  }, []);

  const sendSlowEditInput = useCallback(() => {
    if (!activeSessionId || !socket) return;
    const payload = slowEditInput.endsWith("\n") ? slowEditInput : `${slowEditInput}\n`;
    const hasText = payload.trim().length > 0;
    if (!hasText) return;

    socket.emit("terminal_input", {
      sessionId: activeSessionId,
      data: payload,
    });
    setSlowEditInput("");
  }, [activeSessionId, socket, slowEditInput]);

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
  }, [activeSessionId, apiFetch, searchPad, searchEnd, searchQuery, searchStart]);

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

  // Phase 1: Re-fetch terminal output on reconnect (false→true)
  useEffect(() => {
    const wasDisconnected = !prevConnectedRef.current;
    prevConnectedRef.current = connected;

    if (connected && wasDisconnected && activeSessionId && termRef.current) {
      apiFetch(`/api/sessions/${activeSessionId}/terminal/output?since=0&limit=1000`)
        .then((result) => {
          if (termRef.current && activeSessionId === result.sessionId) {
            termRef.current.reset();
            for (const event of result.events as { index: number; data: string }[]) {
              termRef.current.write(event.data);
            }
          }
        })
        .catch(() => {});
    }
  }, [connected, activeSessionId]);

  // Phase 4: Health check every 30 seconds
  useEffect(() => {
    if (!activeSessionId || !socket) return;
    const interval = setInterval(() => {
      socket.emit("check_health", { sessionId: activeSessionId });
    }, 30_000);
    return () => clearInterval(interval);
  }, [activeSessionId, socket]);

  const isSessionDead = activeSessionId ? sessionHealth[activeSessionId] === false : false;

  const restartSession = useCallback(async () => {
    if (!activeSessionId || !socket) return;
    // Re-joining will re-create the PTY via tmux
    socket.emit("leave_session", { sessionId: activeSessionId });
    socket.emit("join_session", { sessionId: activeSessionId });
    // Clear health state so the banner hides
    useStore.setState((s) => ({
      sessionHealth: { ...s.sessionHealth, [activeSessionId]: true },
    }));
  }, [activeSessionId, socket]);

  useEffect(() => {
    if (!containerRef.current || !socket || !activeSessionId) return;

    const container = containerRef.current;
    outputBufferRef.current = [];

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#10b981",
        selectionBackground: "rgba(255, 255, 255, 0.25)",
        black: "#171717",
        red: "#ef4444",
        green: "#22c55e",
        yellow: "#eab308",
        blue: "#3b82f6",
        magenta: "#a855f7",
        cyan: "#06b6d4",
        white: "#e5e5e5",
        brightBlack: "#525252",
        brightRed: "#f87171",
        brightGreen: "#4ade80",
        brightYellow: "#facc15",
        brightBlue: "#60a5fa",
        brightMagenta: "#c084fc",
        brightCyan: "#22d3ee",
        brightWhite: "#fafafa",
      },
      convertEol: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    termRef.current = term;
    fitAddonRef.current = fitAddon;

    // Delay open() until the container has actual dimensions
    const initTimer = requestAnimationFrame(() => {
      if (!container.offsetWidth || !container.offsetHeight) {
        setTimeout(() => {
          term.open(container);
          term.focus();
          try { fitAddon.fit(); } catch {}
          sendResize();
          attachViewportScroll();
        }, 100);
      } else {
        term.open(container);
        term.focus();
        try { fitAddon.fit(); } catch {}
        sendResize();
        attachViewportScroll();
      }
    });

    // Scroll detection on xterm viewport
    let viewportScrollListener: (() => void) | null = null;

    function attachViewportScroll() {
      const viewport = container.querySelector(".xterm-viewport") as HTMLElement | null;
      if (!viewport) return;

      const onScroll = () => {
        const distFromBottom = viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight;
        setShowScrollButton(distFromBottom > 100);
      };

      viewport.addEventListener("scroll", onScroll, { passive: true });
      viewportScrollListener = () => viewport.removeEventListener("scroll", onScroll);
    }

    function sendResize() {
      socket!.emit("terminal_resize", {
        sessionId: activeSessionId,
        cols: term.cols,
        rows: term.rows,
      });
    }

    // Filter xterm's auto-generated DA (Device Attributes) responses — these are
    // VT100 identification strings that xterm emits in reply to CSI c queries.
    // Without filtering, the PTY echoes them back to the screen as junk text
    // (e.g. "1;2c0;276;0c"). The ? is optional per spec, so we match both forms.
    const DA_RESPONSE_RE = /^\x1b\[\??[\d;]*c$/;

    // Send terminal input to server
    term.onData((data) => {
      if (slowEditModeRef.current) return;
      if (DA_RESPONSE_RE.test(data)) return;
      // Phase 6: Detect Enter key to track command lifecycle
      if (data.includes("\r") || data.includes("\n")) {
        setCommandRunning(true);
      }
      socket!.emit("terminal_input", {
        sessionId: activeSessionId,
        data,
      });
    });

    // Receive terminal output
    const handleOutput = ({
      sessionId,
      data,
    }: {
      sessionId: string;
      data: string;
    }) => {
      if (sessionId === activeSessionId) {
        outputBufferRef.current.push(data);
        if (outputFlushRafRef.current === null) {
          outputFlushRafRef.current = requestAnimationFrame(flushOutputBuffer);
        }
        // Phase 6: Reset quiet timer on each output chunk
        if (quietTimerRef.current) clearTimeout(quietTimerRef.current);
        quietTimerRef.current = setTimeout(() => {
          setCommandRunning(false);
        }, 2000);
      }
    };

    socket.on("terminal_output", handleOutput);

    // Handle resize
    const handleResize = () => {
      try { fitAddon.fit(); } catch {}
      sendResize();
    };

    window.addEventListener("resize", handleResize);

    // Also observe container size changes
    const resizeObserver = new ResizeObserver(() => {
      try { fitAddon.fit(); } catch {}
    });
    resizeObserver.observe(container);

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
              socket!.emit("terminal_input", {
                sessionId: activeSessionId,
                data: url,
              });
            } catch (err) {
              console.error("Failed to upload dropped file", err);
            }
          }
        }
      }
    };

    // Copy selected text on Ctrl+Shift+C / Cmd+Shift+C
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
    };
    container.addEventListener("keydown", onKeyDown);

    // Auto-copy: when mouse selection ends, copy to clipboard automatically
    term.onSelectionChange(() => {
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

    // Fetch existing output
    apiFetch(`/api/sessions/${activeSessionId}/terminal/output?since=0&limit=1000`)
      .then((result) => {
        if (termRef.current && activeSessionId === result.sessionId) {
          term.reset();
          for (const event of result.events as { index: number; data: string }[]) {
            term.write(event.data);
          }
        }
      })
      .catch(() => {
        // Silently ignore, live output will still work
      });

    return () => {
      cancelAnimationFrame(initTimer);
      if (outputFlushRafRef.current !== null) {
        cancelAnimationFrame(outputFlushRafRef.current);
        outputFlushRafRef.current = null;
      }
      if (quietTimerRef.current) {
        clearTimeout(quietTimerRef.current);
        quietTimerRef.current = null;
      }
      window.removeEventListener("resize", handleResize);
      container.removeEventListener("keydown", onKeyDown);
      container.removeEventListener("dragover", onDragOver);
      container.removeEventListener("drop", onDrop);
      resizeObserver.disconnect();
      socket.off("terminal_output", handleOutput);
      viewportScrollListener?.();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      outputBufferRef.current = [];
      setShowScrollButton(false);
      setCommandRunning(false);
    };
  }, [activeSessionId, socket, uploadFile]);

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
      </div>
      <div
        className="flex-1 overflow-hidden p-2 relative flex flex-col gap-2"
      >
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
                if (e.key === "Enter" && e.shiftKey) {
                  e.preventDefault();
                  sendSlowEditInput();
                }
              }}
              rows={3}
              className="w-full rounded-lg border border-white/15 bg-[var(--color-bg)] px-3 py-2 text-sm text-white outline-none resize-y min-h-16"
              placeholder="Type command(s) here. Shift+Enter sends to terminal."
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
      </div>
    </div>
  );
}
