import { useState, useEffect, useRef } from "react";
import { MessageSquare } from "lucide-react";
import { useStore } from "../store.ts";

interface BridgePickerProps {
  selectedText: string;
  sourceSessionId: string;
  onClose: () => void;
}

export default function BridgePicker({ selectedText, sourceSessionId, onClose }: BridgePickerProps) {
  const { sessions, sendMessageToSession } = useStore();
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  // Get the source session's workspace_id for prioritisation
  const sourceSession = sessions.find((s) => s.id === sourceSessionId);
  const sourceWorkspaceId = sourceSession?.workspace_id;

  // Only show conversation sessions (excluding the source terminal)
  const conversations = sessions.filter(
    (s) => s.type === "conversation" && s.id !== sourceSessionId
  );

  // Filter by query
  const filtered = conversations.filter((s) =>
    s.name.toLowerCase().includes(query.toLowerCase())
  );

  // Sort: same workspace first, then others
  const sorted = [...filtered].sort((a, b) => {
    if (sourceWorkspaceId) {
      const aMatch = a.workspace_id === sourceWorkspaceId ? 1 : 0;
      const bMatch = b.workspace_id === sourceWorkspaceId ? 1 : 0;
      if (aMatch !== bMatch) return bMatch - aMatch;
    }
    return 0;
  });

  // Find the separator index (first non-workspace session)
  const separatorIndex = sourceWorkspaceId
    ? sorted.findIndex((s) => s.workspace_id !== sourceWorkspaceId)
    : -1;

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  const handleSelect = async (sessionId: string) => {
    const sourceName = sourceSession?.name || "Terminal";
    const content = `> Bridged from **${sourceName}**\n\n\`\`\`\n${selectedText}\n\`\`\``;
    await sendMessageToSession(sessionId, content);
    onClose();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") {
      onClose();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelectedIndex((i) => Math.min(i + 1, sorted.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelectedIndex((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && sorted[selectedIndex]) {
      handleSelect(sorted[selectedIndex].id);
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
        <div className="px-4 py-2 border-b border-[var(--color-border)]">
          <div className="text-[10px] uppercase tracking-wider text-white/40 mb-1">
            Send selection to conversation
          </div>
        </div>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Search conversations..."
          className="w-full px-4 py-3 bg-transparent text-sm text-white outline-none border-b border-[var(--color-border)] placeholder:text-white/30"
        />
        <div className="max-h-64 overflow-y-auto py-1">
          {sorted.map((session, i) => (
            <div key={session.id}>
              {i === separatorIndex && separatorIndex > 0 && (
                <div className="px-4 py-1.5 text-[10px] uppercase tracking-wider text-white/25 border-t border-white/5 mt-1">
                  Other conversations
                </div>
              )}
              <button
                onClick={() => handleSelect(session.id)}
                className={`w-full flex items-center gap-3 px-4 py-2.5 text-left text-sm transition-colors ${
                  i === selectedIndex
                    ? "bg-white/10 text-white"
                    : "text-white/60 hover:bg-white/5"
                }`}
              >
                <MessageSquare className="w-3.5 h-3.5 flex-shrink-0 text-blue-400" />
                <span className="truncate">{session.name}</span>
                {session.workspace_id === sourceWorkspaceId && sourceWorkspaceId && (
                  <span className="ml-auto text-[10px] uppercase tracking-widest text-emerald-400/50">
                    same workspace
                  </span>
                )}
              </button>
            </div>
          ))}
          {sorted.length === 0 && (
            <div className="px-4 py-6 text-center text-xs text-white/25">
              No conversation sessions found.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
