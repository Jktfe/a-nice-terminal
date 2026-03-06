import { useState, useEffect, useRef } from "react";
import { Terminal, MessageSquare } from "lucide-react";
import { useStore } from "../store.ts";

export default function QuickSwitcher({ onClose }: { onClose: () => void }) {
  const { sessions, setActiveSession } = useStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const filtered = sessions.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i: number) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i: number) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && filtered[selectedIndex]) {
      setActiveSession(filtered[selectedIndex].id);
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-[#141414] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Switch session..."
          className="w-full px-4 py-3 bg-transparent text-sm text-white outline-none border-b border-[var(--color-border)] placeholder:text-white/30"
        />
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.map((session, i) => {
            const Icon =
              session.type === "terminal" ? Terminal : MessageSquare;
            const iconColor = session.type === "terminal"
              ? "text-emerald-400"
              : "text-blue-400";
            return (
              <button
                key={session.id}
                onClick={() => {
                  setActiveSession(session.id);
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`}
                />
                <span className="truncate">{session.name}</span>
                <span className="ml-auto text-[10px] uppercase tracking-widest text-white/25">
                  {session.type}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-white/25">
              No sessions found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
