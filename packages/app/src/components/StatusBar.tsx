import { useStore } from "../store.ts";

export default function StatusBar() {
  const { sessions, activeSessionId, error, clearError } = useStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  const host = window.location.port
    ? `${window.location.hostname}:${window.location.port}`
    : window.location.hostname || "localhost";

  return (
    <div className="flex flex-col gap-1 px-4 py-1 bg-[#0a0a0a] border-t border-[var(--color-border)] text-[10px] text-white/30 select-none">
      {error && (
        <div className="flex items-center justify-between rounded-sm border border-red-500/30 bg-red-500/10 px-2 py-1 text-red-200">
          <span>{error}</span>
          <button
            onClick={clearError}
            className="text-white/70 hover:text-white"
          >
            Dismiss
          </button>
        </div>
      )}

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <span>
            {sessions.length} session{sessions.length !== 1 ? "s" : ""}
          </span>
          {activeSession && (
            <span className="uppercase tracking-widest">
              {activeSession.type}
            </span>
          )}
        </div>
        <span className="tracking-wide">{host}</span>
      </div>
    </div>
  );
}
