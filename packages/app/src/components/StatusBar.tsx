import { useStore } from "../store.ts";

export default function StatusBar() {
  const { sessions, activeSessionId } = useStore();
  const activeSession = sessions.find((s) => s.id === activeSessionId);

  return (
    <div className="flex items-center justify-between px-4 py-1 bg-[#0a0a0a] border-t border-[var(--color-border)] text-[10px] text-white/30 select-none">
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
      <span className="tracking-wide">localhost:3000</span>
    </div>
  );
}
