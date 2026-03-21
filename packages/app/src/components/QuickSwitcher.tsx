import { useState, useEffect, useRef } from "react";
import { useStore } from "../store.ts";
import { getSessionTheme } from "../utils/sessionTheme.ts";

export default function QuickSwitcher({ onClose, onSelect }: { onClose: () => void; onSelect?: (id: string) => void }) {
  const { sessions, setActiveSession, uiTheme } = useStore();
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
      if (onSelect) {
        onSelect(filtered[selectedIndex].id);
      } else {
        setActiveSession(filtered[selectedIndex].id);
      }
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[20vh]"
      onClick={onClose}
    >
      <div className="absolute inset-0 bg-[var(--color-overlay)] backdrop-blur-sm" />
      <div
        className="relative w-full max-w-md bg-[var(--color-surface)] border border-[var(--color-border)] rounded-xl shadow-2xl overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Switch session..."
          className="w-full px-4 py-3 bg-transparent text-sm text-[var(--color-text)] outline-none border-b border-[var(--color-border)] placeholder:text-[var(--color-text-dim)]"
        />
        <div className="max-h-64 overflow-y-auto py-1">
          {filtered.map((session, i) => {
            const { Icon, icon: iconColor } = getSessionTheme(session.type, uiTheme);
            return (
              <button
                key={session.id}
                onClick={() => {
                  if (onSelect) {
                    onSelect(session.id);
                  } else {
                    setActiveSession(session.id);
                  }
                  onClose();
                }}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-[var(--color-active)] text-[var(--color-text)]"
                    : "text-[var(--color-text-muted)] hover:bg-[var(--color-hover)]"
                }`}
              >
                <Icon
                  className={`w-3.5 h-3.5 flex-shrink-0 ${iconColor}`}
                />
                <span className="truncate">{session.name}</span>
                <span className="ml-auto text-[10px] uppercase tracking-widest text-[var(--color-text-dim)]">
                  {session.type}
                </span>
              </button>
            );
          })}
          {filtered.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-[var(--color-text-dim)]">
              No sessions found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
