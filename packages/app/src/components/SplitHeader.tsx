import { X } from "lucide-react";
import { useStore, type Session } from "../store.ts";
import { getSessionTheme } from "../utils/sessionTheme.ts";

export default function SplitHeader({
  session,
  onClose,
}: {
  session: Session;
  onClose: () => void;
}) {
  const { setActiveSession } = useStore();

  const { Icon, ...tone } = getSessionTheme(session.type);

  return (
    <header className="flex items-center justify-between px-4 py-2.5 border-b border-[var(--color-border)] bg-[var(--color-surface)]">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className={`p-1.5 rounded-md flex-shrink-0 ${tone.chip}`}>
          <Icon className={`w-4 h-4 ${tone.icon}`} />
        </div>
        <button
          onClick={() => setActiveSession(session.id)}
          className="group flex items-center gap-1.5 min-w-0"
          title="Switch to this session"
        >
          <h2 className="text-sm font-medium text-white truncate group-hover:text-emerald-400 transition-colors">
            {session.name}
          </h2>
        </button>
        <span className="text-[10px] uppercase tracking-widest text-white/30 bg-white/5 px-2 py-0.5 rounded flex-shrink-0 hidden sm:inline">
          split
        </span>
      </div>

      <button
        onClick={onClose}
        className="p-1.5 text-white/40 hover:text-white/80 transition-colors"
        title="Close split view (Cmd+\\)"
      >
        <X className="w-4 h-4" />
      </button>
    </header>
  );
}
