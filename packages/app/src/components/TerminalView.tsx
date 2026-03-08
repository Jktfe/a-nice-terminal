import { useEffect, useRef, useState, useCallback } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { motion, AnimatePresence } from "motion/react";
import { RefreshCw, ChevronDown } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";

export default function TerminalView() {
  const { activeSessionId, socket } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [showScrollButton, setShowScrollButton] = useState(false);

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
    if (!containerRef.current || !socket || !activeSessionId) return;

    const container = containerRef.current;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 14,
      fontFamily: '"JetBrains Mono", monospace',
      theme: {
        background: "#0a0a0a",
        foreground: "#e5e5e5",
        cursor: "#10b981",
        selectionBackground: "rgba(16, 185, 129, 0.3)",
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
          try { fitAddon.fit(); } catch {}
          sendResize();
          attachViewportScroll();
        }, 100);
      } else {
        term.open(container);
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

    // Send terminal input to server
    term.onData((data) => {
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
        term.write(data);
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
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      socket.off("terminal_output", handleOutput);
      viewportScrollListener?.();
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
      setShowScrollButton(false);
    };
  }, [activeSessionId, socket]);

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center justify-end px-3 py-1 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
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
      <div className="flex-1 overflow-hidden p-2 relative">
        <div
          ref={containerRef}
          className="w-full h-full terminal-container rounded-lg"
        />

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
      </div>
    </div>
  );
}
