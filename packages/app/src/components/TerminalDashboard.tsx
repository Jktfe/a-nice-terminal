/**
 * TerminalDashboard — default terminal view for ANT v2+.
 *
 * Renders captured command events as structured CommandBlocks instead of
 * driving a raw ANSI state machine. No xterm.js in this path — the output
 * is plain text served from the capture pipeline.
 *
 * Smooth view toggle: clicking the toggle lazy-loads TerminalViewV2 (xterm.js)
 * so the user can watch live PTY output when needed (e.g. npm install).
 */

import { useState, useEffect, useCallback, lazy, Suspense } from "react";
import { RefreshCw, Activity, Terminal as TerminalIcon } from "lucide-react";
import { useStore, apiFetch } from "../store.ts";
import CommandBlock, { type CommandEvent } from "./CommandBlock.tsx";

// xterm.js is lazy-loaded only when the user enables smooth view.
// This keeps it out of the main bundle for all regular sessions.
const TerminalViewV2 = lazy(() => import("./TerminalViewV2.tsx"));

const POLL_INTERVAL_MS = 3000;

interface TerminalDashboardProps {
  sessionId?: string;
}

export default function TerminalDashboard({ sessionId: sessionIdProp }: TerminalDashboardProps) {
  const { activeSessionId, sessions, uiTheme, setSessionCwd } = useStore();
  const sessionId = sessionIdProp ?? activeSessionId;
  const session = sessions.find((s) => s.id === sessionId);

  const [commands, setCommands] = useState<CommandEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [smoothView, setSmoothView] = useState(true);

  // Fetch command events from the capture pipeline.
  const fetchCommands = useCallback(async () => {
    if (!sessionId) return;
    try {
      const data = await apiFetch(`/api/sessions/${sessionId}/commands?limit=200`) as CommandEvent[];
      setCommands(data);
      setError(null);
      // Update the live cwd breadcrumb with the most recent command that recorded a cwd.
      // findLast avoids copying the array just to scan backwards.
      const lastCwd = data.findLast((c) => c.cwd)?.cwd;
      if (lastCwd && lastCwd !== useStore.getState().sessionCwds[sessionId]) {
        setSessionCwd(sessionId, lastCwd);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load commands");
    } finally {
      setLoading(false);
    }
  }, [sessionId, setSessionCwd]);

  useEffect(() => {
    // Don't reset or poll when the live view is active — the history view isn't visible.
    if (smoothView) return;
    setLoading(true);
    setCommands([]);
    fetchCommands();
  }, [fetchCommands, smoothView]);

  // Poll for new commands every few seconds (capture pipeline writes async).
  // Paused while the live xterm.js view is active — no need to poll hidden state.
  useEffect(() => {
    if (smoothView) return;
    const timer = setInterval(fetchCommands, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [fetchCommands, smoothView]);

  const isDark = uiTheme !== "light";

  if (!sessionId || !session) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        No terminal selected
      </div>
    );
  }

  if (smoothView) {
    return (
      <div className="flex flex-col h-full">
        <SmoothViewHeader sessionName={session.name} onExit={() => setSmoothView(false)} />
        <div className="flex-1 min-h-0">
          <Suspense fallback={<LoadingState text="Loading terminal…" />}>
            <TerminalViewV2 sessionId={sessionId} />
          </Suspense>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex flex-col h-full ${isDark ? "bg-zinc-950" : "bg-white"}`}>
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 shrink-0">
        <TerminalIcon className="w-4 h-4 text-zinc-400 shrink-0" />
        <span className="text-sm text-zinc-300 font-mono flex-1 truncate">
          {session.name}
          {session.cwd && (
            <span className="text-zinc-500 ml-2 text-xs">{session.cwd}</span>
          )}
        </span>

        {/* Command count badge */}
        {commands.length > 0 && (
          <span className="text-xs text-zinc-500 shrink-0">
            {commands.length} cmd{commands.length !== 1 ? "s" : ""}
          </span>
        )}

        {/* Refresh */}
        <button
          onClick={fetchCommands}
          title="Refresh"
          className="p-1 rounded text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
        </button>

        {/* Smooth view toggle */}
        <button
          onClick={() => setSmoothView(true)}
          title="Switch to live terminal view (loads xterm.js)"
          className="flex items-center gap-1.5 px-2 py-1 rounded text-xs text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 border border-zinc-700/50 transition-colors"
        >
          <Activity className="w-3 h-3" />
          <span className="hidden sm:inline">Live view</span>
        </button>
      </div>

      {/* Command list */}
      <div className="flex-1 min-h-0 overflow-y-auto p-3 space-y-0">
        {loading && <LoadingState text="Loading command history…" />}

        {!loading && error && (
          <div className="text-sm text-red-400 p-4 text-center">
            {error}
          </div>
        )}

        {!loading && !error && commands.length === 0 && (
          <EmptyState sessionName={session.name} />
        )}

        {commands.map((cmd) => (
          <CommandBlock key={cmd.id} event={cmd} />
        ))}
      </div>
    </div>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function SmoothViewHeader({ sessionName, onExit }: { sessionName: string; onExit: () => void }) {
  return (
    <div className="flex items-center gap-2 px-3 py-2 border-b border-zinc-800 bg-blue-950/30 shrink-0">
      <Activity className="w-4 h-4 text-blue-400 shrink-0" />
      <span className="text-sm text-blue-300 flex-1 truncate font-mono">
        {sessionName} — live view
      </span>
      <button
        onClick={onExit}
        className="text-xs text-zinc-400 hover:text-zinc-200 px-2 py-1 rounded hover:bg-zinc-800 transition-colors border border-zinc-700/40"
      >
        ← History
      </button>
    </div>
  );
}

function LoadingState({ text }: { text: string }) {
  return (
    <div className="flex items-center justify-center h-full text-zinc-500 text-sm gap-2 py-12">
      <RefreshCw className="w-4 h-4 animate-spin" />
      {text}
    </div>
  );
}

function EmptyState({ sessionName }: { sessionName: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center gap-3">
      <TerminalIcon className="w-8 h-8 text-zinc-600" />
      <p className="text-zinc-500 text-sm">No commands captured yet for <code className="text-zinc-400">{sessionName}</code></p>
      <p className="text-zinc-600 text-xs max-w-xs">
        Commands run in this session will appear here once ant-capture is active.
        Use <code className="text-zinc-500">ant read {sessionName}</code> to see raw output.
      </p>
    </div>
  );
}
