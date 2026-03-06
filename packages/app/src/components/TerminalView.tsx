import { useEffect, useRef } from "react";
import { Terminal } from "xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useStore } from "../store.ts";

export default function TerminalView() {
  const { activeSessionId, socket } = useStore();
  const containerRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

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
    // This prevents the xterm "dimensions" error
    const initTimer = requestAnimationFrame(() => {
      if (!container.offsetWidth || !container.offsetHeight) {
        // Container not sized yet, retry after a short delay
        setTimeout(() => {
          term.open(container);
          try { fitAddon.fit(); } catch {}
          sendResize();
        }, 100);
      } else {
        term.open(container);
        try { fitAddon.fit(); } catch {}
        sendResize();
      }
    });

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

    return () => {
      cancelAnimationFrame(initTimer);
      window.removeEventListener("resize", handleResize);
      resizeObserver.disconnect();
      socket.off("terminal_output", handleOutput);
      term.dispose();
      termRef.current = null;
      fitAddonRef.current = null;
    };
  }, [activeSessionId, socket]);

  return (
    <div className="flex-1 overflow-hidden p-2">
      <div
        ref={containerRef}
        className="w-full h-full terminal-container rounded-lg"
      />
    </div>
  );
}
