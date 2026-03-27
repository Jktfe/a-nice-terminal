import { HelpCircle, Radio } from "lucide-react";
import { useStore } from "../store.ts";
import { useState, useEffect } from "react";

export default function StatusBar() {
  const { sessions, activeSessionId, error, clearError, toggleDocs } = useStore();
  const activeSessions = sessions.filter((s) => !s.archived);
  const activeSession = sessions.find((s) => s.id === activeSessionId);
  const [bridgePlatforms, setBridgePlatforms] = useState<string[]>([]);

  useEffect(() => {
    if (!activeSessionId) { setBridgePlatforms([]); return; }
    fetch(`/api/bridge/mappings/by-session/${activeSessionId}`)
      .then((r) => r.ok ? r.json() : [])
      .then((mappings: Array<{ platform: string }>) => {
        setBridgePlatforms(mappings.map((m) => m.platform));
      })
      .catch(() => setBridgePlatforms([]));
  }, [activeSessionId]);

  const host = window.location.port
    ? `${window.location.hostname}:${window.location.port}`
    : window.location.hostname || "localhost";

  return (
    <div className="flex flex-col gap-1 px-4 py-1 bg-[var(--color-bg)] border-t border-[var(--color-border)] text-[10px] text-[var(--color-text-dim)] select-none">
      {error && (
        <div className="flex items-center justify-between rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-200">
          <span>{error}</span>
          <button
            onClick={clearError}
            className="text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span>
            {activeSessions.length} session{activeSessions.length !== 1 ? "s" : ""}
          </span>
          {activeSession && (
            <span className="uppercase tracking-widest">
              {activeSession.type}
            </span>
          )}
          {bridgePlatforms.length > 0 && (
            <span className="flex items-center gap-1 text-green-400" title={`Bridged: ${bridgePlatforms.join(", ")}`}>
              <Radio className="w-3 h-3" />
              {bridgePlatforms.join(", ")}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={toggleDocs}
            className="flex items-center gap-1 hover:text-[var(--color-text-muted)] transition-colors"
            title="Docs (Cmd+/)"
          >
            <HelpCircle className="w-3 h-3" />
            <span>Docs</span>
          </button>
          <span className="tracking-wide">{host}</span>
        </div>
      </div>
    </div>
  );
}
